// sheddingRules.ts — Client-side mirror of the shedding family, over the
// PUBLIC wire data (deck catalog + rules, the top of the discards, the colour in force)
// and MY projected view (my hand, my drawn-card pause). It feeds the hand panel
// (playable / spoken refusal reason with the SERVER'S own keys), the wild colour picker
// and the shared status line. The server re-checks everything on play.
//
// Pure: no DOM, no i18n (texts come through the caller's tSync).

import type { GameState, SheddingCardDef, SheddingSeatState } from './models.js';

export interface SheddingPlayability {
	playable: boolean;
	/** i18n key of the refusal, when not playable. */
	reasonKey?: string;
}

/** Index the public deck catalog by card id. */
export function sheddingCatalog(gs: GameState): Map<string, SheddingCardDef> {
	return new Map((gs.sheddingDeck ?? []).map(c => [c.id, c]));
}

export function sheddingSeat(gs: GameState, playerId: string): SheddingSeatState | null {
	return gs.shedding?.seats.find(s => s.playerId === playerId) ?? null;
}

/** The distinct colours the deck plays in (wilds excluded), in deck order. */
export function deckColors(gs: GameState): string[] {
	const seen: string[] = [];
	for (const def of gs.sheddingDeck ?? []) {
		if (def.color && !seen.includes(def.color)) seen.push(def.color);
	}
	return seen;
}

/** The definition of the top of the discards (all the wire carries of the pile). */
export function topDef(gs: GameState): SheddingCardDef | null {
	const top = gs.shedding?.discardPile?.[gs.shedding.discardPile.length - 1];
	return top ? sheddingCatalog(gs).get(top.cardId) ?? null : null;
}

/** The cards a draw card inflicts (2 / 4); 0 = not a draw card. */
function penaltyDrawOf(type: string): number {
	return type === 'drawTwo' ? 2 : type === 'wildDrawFour' ? 4 : 0;
}

/** May a card of this type pile onto the pending penalty, per the stacking mode? Mirrors
 *  the server: "sameType" needs the same kind, "cross" takes any draw card, "none" nothing. */
export function canStackOn(cardType: string, lastType: string, mode: string | undefined): boolean {
	if (penaltyDrawOf(cardType) === 0) return false;
	if (mode === 'cross') return true;
	if (mode === 'sameType') return cardType === lastType;
	return false;
}

/**
 * May I play this card (by catalog id) right now? Mirrors the server: the colour in
 * force, an equal number value or the same action type; wilds always, the wild-draw
 * only with no card of the colour in force; mid-pause only the drawn card.
 */
export function canPlayCard(gs: GameState, myId: string, instanceId: string): SheddingPlayability {
	const seat = sheddingSeat(gs, myId);
	const shedding = gs.shedding;
	if (!seat || !shedding) return { playable: false, reasonKey: 'game.shedding_not_seated' };
	const instance = seat.hand.find(c => c.instanceId === instanceId);
	const card = instance ? sheddingCatalog(gs).get(instance.cardId) : null;
	if (!instance || !card) return { playable: false, reasonKey: 'game.shedding_unknown_card' };

	if (shedding.pendingDrawnPlay && shedding.pendingDrawnPlay.playerId === myId
		&& shedding.pendingDrawnPlay.instanceId !== instanceId) {
		return { playable: false, reasonKey: 'game.shedding_only_drawn' };
	}

	// A penalty is piling up (stacking rule): only a stacking draw card may answer it —
	// colour/number matching is bypassed, mirroring the server.
	if (shedding.pendingPenalty) {
		return canStackOn(card.type, shedding.pendingPenalty.lastType, gs.sheddingRules?.stacking)
			? { playable: true }
			: { playable: false, reasonKey: 'game.shedding_must_stack' };
	}

	switch (card.type) {
		case 'wild':
			return { playable: true };
		case 'wildDrawFour': {
			const catalog = sheddingCatalog(gs);
			const holdsColor = (gs.sheddingRules?.wildDrawRequiresNoMatch ?? true)
				&& seat.hand.some(i => catalog.get(i.cardId)?.color === shedding.currentColor);
			return holdsColor
				? { playable: false, reasonKey: 'game.shedding_wild_needs_no_match' }
				: { playable: true };
		}
		default: {
			if (card.color === shedding.currentColor) return { playable: true };
			const top = topDef(gs);
			if (top && card.type === 'number' && top.type === 'number' && card.value === top.value)
				return { playable: true };
			if (top && card.type !== 'number' && card.type === top.type)
				return { playable: true };
			return { playable: false, reasonKey: 'game.shedding_not_playable' };
		}
	}
}

/**
 * One seat's spoken status. Mine: round, hand size, the colour in force and the top
 * card, the direction only when it is REVERSED (the exception speaks, the norm stays
 * silent) and the match score. A rival's: their card count and score — the on-demand
 * answer to "who is running short?" (this family deliberately has no automatic
 * one-card-left shout). Every surface (S, Shift+S, the players panel) speaks this.
 */
export function sheddingStatusText(
	gs: GameState,
	playerId: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
	const seat = sheddingSeat(gs, playerId);
	const shedding = gs.shedding;
	if (!seat || !shedding) return null;

	if (seat.retired) {
		return [
			tSync('game.status_retired'),
			tSync('game.shedding_status_score', { total: seat.score }),
		].join(', ');
	}

	const parts: string[] = [
		seat.handCount === 1
			? tSync('game.shedding_status_cards_one')
			: tSync('game.shedding_status_cards', { count: seat.handCount }),
	];
	const top = topDef(gs);
	if (top) {
		parts.push(tSync('game.shedding_status_top', {
			card: top.nameKey, color: `colors.${shedding.currentColor}`,
		}));
	}
	if (shedding.direction === -1) parts.push(tSync('game.shedding_status_reversed'));
	parts.push(tSync('game.shedding_status_score', { total: seat.score }));
	return parts.join(', ');
}

/**
 * The watch list: rivals down to one or two cards — the ones about
 * to win, whom you must be ready to catch. The exposed player (dropped to one, undeclared)
 * is flagged so you can pounce. "Nobody is close" when none. On-demand, like S / Shift+S —
 * the accessible answer to a sighted player's glance at the table.
 */
export function sheddingWatchText(
	gs: GameState,
	myId: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string {
	const shedding = gs.shedding;
	if (!shedding) return '';
	const lines = shedding.seats
		.filter(s => s.playerId !== myId && !s.retired && s.handCount > 0 && s.handCount <= 2)
		.map(s => {
			const name = gs.players.find(p => p.id === s.playerId)?.name ?? s.playerId;
			if (shedding.pendingLastCardCall === s.playerId)
				return tSync('game.shedding_watch_undeclared', { name });
			return s.handCount === 1
				? tSync('game.shedding_watch_one', { name })
				: tSync('game.shedding_watch_cards', { name, count: s.handCount });
		});
	return lines.length ? lines.join('. ') : tSync('game.shedding_watch_none');
}

/**
 * "What does this card do?" — the hand's per-card Help text. A package may write its
 * own via a `<nameKey>_help` i18n key; otherwise the engine composes one per type.
 */
export function sheddingCardHelp(
	gs: GameState,
	cardId: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
	const def = sheddingCatalog(gs).get(cardId);
	if (!def) return null;

	const overrideKey = `${def.nameKey}_help`;
	const override = tSync(overrideKey);
	if (override && override !== overrideKey) return override;

	switch (def.type) {
		case 'number':
			return tSync('game.shedding_help_number', { value: def.value ?? 0 });
		case 'skip':
			return tSync('game.shedding_help_skip');
		case 'reverse':
			return tSync('game.shedding_help_reverse');
		case 'drawTwo':
			return tSync('game.shedding_help_draw_two');
		case 'wild':
			return tSync('game.shedding_help_wild');
		case 'wildDrawFour':
			return tSync('game.shedding_help_wild_draw_four');
		default:
			return null;
	}
}
