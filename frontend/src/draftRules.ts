// draftRules.ts — Client-side mirror of the draft family (simultaneous pick-and-pass),
// over the PUBLIC wire data (the deck catalog + rules) and MY projected view (my hand,
// everyone's tables/desserts/scores). Every card in hand is always a legal pick — the
// genre has no refusals — so this module's job is the SPOKEN story: the status line the
// S key and the players panel share, the table summary, and the per-card help.
//
// Pure: no DOM, no i18n (texts come through the caller's tSync).

import type { DraftCardDef, DraftSeatState, DraftTableSlot, GameState } from './models.js';

/** Index the public deck catalog by card id. */
export function draftCatalog(gs: GameState): Map<string, DraftCardDef> {
	return new Map((gs.draftDeck ?? []).map(c => [c.id, c]));
}

export function draftSeat(gs: GameState, playerId: string): DraftSeatState | null {
	return gs.draft?.seats.find(s => s.playerId === playerId) ?? null;
}

/** Opening hand size for this table (the classic base-minus-players curve). */
export function draftHandSize(gs: GameState): number {
	return (gs.draftRules?.handSizeBase ?? 12) - (gs.draft?.seats.length ?? 0);
}

/** Whether an unspent "extra" waits on this player's table (it pays a double pick). */
export function hasUnspentExtra(gs: GameState, playerId: string): boolean {
	const seat = draftSeat(gs, playerId);
	if (!seat) return false;
	const catalog = draftCatalog(gs);
	return seat.table.some(slot => catalog.get(slot.card.cardId)?.type === 'extra');
}

/**
 * One seat's table, summarized for speech and for the visual chips: distinct cards with
 * their copy counts, a boosted points card naming its multiplier. Order follows the
 * first appearance on the table, so the story is stable while cards accumulate.
 */
export function tableSummary(
	seat: DraftSeatState,
	catalog: Map<string, DraftCardDef>,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string[] {
	const nameOf = (slot: DraftTableSlot) => {
		const def = catalog.get(slot.card.cardId);
		return def ? tSync(def.nameKey) : slot.card.cardId;
	};

	// First pass: count plain copies per card, keeping first-appearance order (boosted
	// slots stay individual — each names its multiplier).
	const items: Array<{ boosted?: string; cardId?: string; name?: string }> = [];
	const counts = new Map<string, number>();
	for (const slot of seat.table) {
		if (slot.onMultiplier) {
			const boost = catalog.get(slot.onMultiplier.cardId);
			items.push({
				boosted: tSync('game.draft_table_boosted', {
					card: nameOf(slot),
					multiplier: boost ? tSync(boost.nameKey) : slot.onMultiplier.cardId,
					factor: boost?.factor ?? 1,
				}),
			});
			continue;
		}
		if (!counts.has(slot.card.cardId)) items.push({ cardId: slot.card.cardId, name: nameOf(slot) });
		counts.set(slot.card.cardId, (counts.get(slot.card.cardId) ?? 0) + 1);
	}
	return items.map(item => item.boosted
		?? ((counts.get(item.cardId!) ?? 1) > 1
			? tSync('game.draft_table_copies', { card: item.name, count: counts.get(item.cardId!) })
			: item.name!));
}

/**
 * One seat's spoken status: round, running score, the table's contents, the dessert
 * stash and whether the pick is already in. The players-panel identity line and the
 * S / Shift+S keys all speak through this, so every surface tells the same story.
 */
export function draftStatusText(
	gs: GameState,
	playerId: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
	const seat = draftSeat(gs, playerId);
	if (!seat || !gs.draft) return null;
	const catalog = draftCatalog(gs);

	// A retired seat's whole story is its exit and its banked score.
	if (seat.retired) {
		return [
			tSync('game.status_retired'),
			tSync('game.draft_status_score', { total: seat.score }),
		].join(', ');
	}

	const parts: string[] = [
		tSync('game.draft_status_round', { round: gs.draft.round, rounds: gs.draftRules?.rounds ?? 3 }),
		tSync('game.draft_status_score', { total: seat.score }),
	];
	const items = tableSummary(seat, catalog, tSync);
	if (items.length > 0)
		parts.push(tSync('game.draft_status_table', { items: items.join(', ') }));
	if (seat.desserts.length === 1)
		parts.push(tSync('game.draft_status_dessert_one'));
	else if (seat.desserts.length > 1)
		parts.push(tSync('game.draft_status_desserts', { count: seat.desserts.length }));
	if (seat.hasPicked && seat.handCount > 0)
		parts.push(tSync('game.draft_status_picked'));
	return parts.join(', ');
}

/**
 * "What does this card do?" — the hand's per-card Help text. A package may write its
 * own via a `<nameKey>_help` i18n key; otherwise the engine composes one from the
 * card's scoring data.
 */
export function draftCardHelp(
	gs: GameState,
	cardId: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
	const def = draftCatalog(gs).get(cardId);
	if (!def) return null;

	const overrideKey = `${def.nameKey}_help`;
	const override = tSync(overrideKey);
	if (override && override !== overrideKey) return override;

	switch (def.type) {
		case 'points':
			return tSync('game.draft_help_points', { value: def.value ?? 0 });
		case 'multiplier':
			return tSync('game.draft_help_multiplier', { factor: def.factor ?? 1 });
		case 'set':
			return tSync('game.draft_help_set', { size: def.setSize ?? 0, points: def.setPoints ?? 0 });
		case 'scale':
			return tSync('game.draft_help_scale', { steps: (def.scale ?? []).join(', ') });
		case 'majority': {
			const first = gs.draftRules?.majorityFirst ?? 6;
			const second = gs.draftRules?.majoritySecond ?? 3;
			return tSync('game.draft_help_majority', { icons: def.icons ?? 1, first, second });
		}
		case 'dessert': {
			const bonus = gs.draftRules?.dessertBonus ?? 6;
			const penalty = gs.draftRules?.dessertPenalty ?? 6;
			return tSync('game.draft_help_dessert', { bonus, penalty });
		}
		default:
			return null;
	}
}
