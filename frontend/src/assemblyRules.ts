// assemblyRules.ts — Client-side mirror of the server's assembly legality,
// over the PUBLIC wire data (the deck catalog + rules) and MY projected view (my hand,
// everyone's racks). It feeds the hand panel (playable / spoken refusal reason) and the
// target pickers (victim → slot chains). The server re-checks everything on play — this
// only exists so the UI can refuse locally with the same words the server would use.
//
// Pure: no DOM, no i18n (reasons are game.assembly_* KEYS, translated by the caller).

import type { AssemblyCardDef, AssemblySeatState, AssemblySlot, GameState } from './models.js';

export const WILD = 'wild';

export interface AssemblyPlayability {
	playable: boolean;
	/** i18n key of the refusal, when not playable. */
	reasonKey?: string;
}

/** Index the public deck catalog by card id. */
export function assemblyCatalog(gs: GameState): Map<string, AssemblyCardDef> {
	return new Map((gs.assemblyDeck ?? []).map(c => [c.id, c]));
}

export function assemblySeat(gs: GameState, playerId: string): AssemblySeatState | null {
	return gs.assembly?.seats.find(s => s.playerId === playerId) ?? null;
}

/** The distinct system colours the deck plays in (wilds excluded), in deck order — the
 *  canonical rank the hand's "sort by colour" groups by. */
export function deckColors(gs: GameState): string[] {
	const seen: string[] = [];
	for (const def of gs.assemblyDeck ?? []) {
		if (def.color && def.color !== WILD && !seen.includes(def.color)) seen.push(def.color);
	}
	return seen;
}

/** Locked (two shields): untouchable forever. */
export function isLocked(slot: AssemblySlot): boolean { return slot.shields.length >= 2; }

/** Functional = not afflicted: counts toward the winning rack. */
export function isFunctional(slot: AssemblySlot): boolean { return slot.afflictions.length === 0; }

/** Completely clean (no afflictions, no shields): the plague's only landing spot. */
export function isClean(slot: AssemblySlot): boolean {
	return slot.afflictions.length === 0 && slot.shields.length === 0;
}

/** A card colour matches a slot colour when either is wild or they are equal. */
export function colorMatches(cardColor: string | null | undefined, slotColor: string): boolean {
	return cardColor === WILD || slotColor === WILD || cardColor === slotColor;
}

/** Distinct functional colours on a rack, wild jokers each filling one missing colour. */
export function functionalColors(seat: AssemblySeatState): number {
	const functional = seat.slots.filter(isFunctional).map(s => s.color);
	return new Set(functional.filter(c => c !== WILD)).size + functional.filter(c => c === WILD).length;
}

/** The slots of `target` this attack could hit right now. */
export function attackableSlots(card: AssemblyCardDef, target: AssemblySeatState): AssemblySlot[] {
	return target.slots.filter(s => !isLocked(s) && colorMatches(card.color, s.color));
}

/** Rivals holding at least one hittable slot, with those slots (empty = unplayable). */
export function attackTargets(
	gs: GameState, myId: string, card: AssemblyCardDef,
): Array<{ seat: AssemblySeatState; slots: AssemblySlot[] }> {
	return (gs.assembly?.seats ?? [])
		.filter(s => s.playerId !== myId)
		.map(seat => ({ seat, slots: attackableSlots(card, seat) }))
		.filter(t => t.slots.length > 0);
}

/** My own slots this remedy could touch (cure, shield or lock — locked ones are done). */
export function remedySlots(card: AssemblyCardDef, seat: AssemblySeatState): AssemblySlot[] {
	return seat.slots.filter(s => !isLocked(s) && colorMatches(card.color, s.color));
}

/** May this my-slot ↔ their-slot pair swap without duplicating a colour on either rack? */
export function canSwapPair(
	mine: AssemblySeatState, mySlot: AssemblySlot,
	theirs: AssemblySeatState, theirSlot: AssemblySlot,
): boolean {
	if (isLocked(mySlot) || isLocked(theirSlot)) return false;
	if (mySlot.color === theirSlot.color) return true;
	if (mine.slots.some(s => s !== mySlot && s.color === theirSlot.color)) return false;
	if (theirs.slots.some(s => s !== theirSlot && s.color === mySlot.color)) return false;
	return true;
}

/** Rivals with at least one stealable slot (non-locked, of a colour my rack lacks). */
export function stealTargets(
	gs: GameState, myId: string,
): Array<{ seat: AssemblySeatState; slots: AssemblySlot[] }> {
	const mine = assemblySeat(gs, myId);
	if (!mine) return [];
	const myColors = new Set(mine.slots.map(s => s.color));
	return (gs.assembly?.seats ?? [])
		.filter(s => s.playerId !== myId)
		.map(seat => ({ seat, slots: seat.slots.filter(s => !isLocked(s) && !myColors.has(s.color)) }))
		.filter(t => t.slots.length > 0);
}

/** Rival pairs the swap special could reach: every rival with a non-locked slot such that
 *  SOME of my non-locked slots forms a legal pair with it. */
export function swapTargets(
	gs: GameState, myId: string,
): Array<{ seat: AssemblySeatState; slots: AssemblySlot[] }> {
	const mine = assemblySeat(gs, myId);
	if (!mine || mine.slots.length === 0) return [];
	return (gs.assembly?.seats ?? [])
		.filter(s => s.playerId !== myId)
		.map(seat => ({
			seat,
			slots: seat.slots.filter(theirSlot =>
				mine.slots.some(mySlot => canSwapPair(mine, mySlot, seat, theirSlot))),
		}))
		.filter(t => t.slots.length > 0);
}

/** Would the plague move at least one of my afflictions right now? Mirrors the server's
 *  deterministic pairing (clean, colour-compatible rival slots). */
export function plagueHasMoves(gs: GameState, myId: string): boolean {
	const mine = assemblySeat(gs, myId);
	if (!mine) return false;
	const catalog = assemblyCatalog(gs);
	const rivals = (gs.assembly?.seats ?? []).filter(s => s.playerId !== myId);
	return mine.slots.some(slot => {
		if (slot.afflictions.length === 0) return false;
		const color = catalog.get(slot.afflictions[0].cardId)?.color ?? WILD;
		return rivals.some(r => r.slots.some(s => isClean(s) && colorMatches(color, s.color)));
	});
}

/**
 * May I play this card (by catalog id) right now? For targeted cards, "playable" means at
 * least one legal target exists — the picker (or auto-target) chooses which.
 */
export function canPlayCard(gs: GameState, myId: string, cardId: string): AssemblyPlayability {
	const catalog = assemblyCatalog(gs);
	const card = catalog.get(cardId);
	const seat = assemblySeat(gs, myId);
	if (!card || !seat) return { playable: false, reasonKey: 'game.assembly_unknown_card' };

	switch (card.type) {
		case 'piece':
			return seat.slots.some(s => s.color === (card.color ?? WILD))
				? { playable: false, reasonKey: 'game.assembly_color_taken' }
				: { playable: true };

		case 'attack':
			return attackTargets(gs, myId, card).length > 0
				? { playable: true }
				: { playable: false, reasonKey: 'game.assembly_no_attackable' };

		case 'remedy':
			return remedySlots(card, seat).length > 0
				? { playable: true }
				: { playable: false, reasonKey: 'game.assembly_nothing_to_fix' };

		case 'special':
			switch (card.specialKind) {
				case 'swapPiece':
					return swapTargets(gs, myId).length > 0
						? { playable: true }
						: { playable: false, reasonKey: 'game.assembly_nothing_to_swap' };
				case 'stealPiece':
					return stealTargets(gs, myId).length > 0
						? { playable: true }
						: { playable: false, reasonKey: 'game.assembly_nothing_to_steal' };
				case 'plague':
					return plagueHasMoves(gs, myId)
						? { playable: true }
						: { playable: false, reasonKey: 'game.assembly_nothing_to_spread' };
				case 'scrapHands':
					return (gs.assembly?.seats ?? []).some(s => s.playerId !== myId && s.handCount > 0)
						? { playable: true }
						: { playable: false, reasonKey: 'game.assembly_no_hands_to_scrap' };
				case 'fullSwap':
					// Retired seats are not targets (swapping with an empty ghost).
					return (gs.assembly?.seats ?? []).some(s => s.playerId !== myId && !s.retired)
						? { playable: true }
						: { playable: false, reasonKey: 'game.assembly_needs_target' };
				default:
					return { playable: false, reasonKey: 'game.assembly_unknown_card' };
			}

		default:
			return { playable: false, reasonKey: 'game.assembly_unknown_card' };
	}
}

/**
 * "What does this card do?" — the hand's per-card Help text (live-play request). A package
 * may write its own via a `<nameKey>_help` i18n key; otherwise the engine composes one from
 * the card's data, naming the SYSTEM the colour belongs to (its piece's own name).
 */
export function assemblyCardHelp(
	gs: GameState,
	cardId: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
	const catalog = assemblyCatalog(gs);
	const def = catalog.get(cardId);
	if (!def) return null;

	const overrideKey = `${def.nameKey}_help`;
	const override = tSync(overrideKey);
	if (override && override !== overrideKey) return override;

	const goal = gs.assemblyRules?.slotsToWin ?? 4;
	const systemOf = (color: string | null | undefined) => color === WILD || !color
		? tSync('game.assembly_help_any_system')
		: tSync([...catalog.values()].find(c => c.type === 'piece' && c.color === color)?.nameKey ?? color);

	switch (def.type) {
		case 'piece':
			return def.color === WILD
				? tSync('game.assembly_help_piece_wild', { goal })
				: tSync('game.assembly_help_piece', { goal });

		case 'attack':
			return tSync('game.assembly_help_attack', { system: systemOf(def.color) });

		case 'remedy':
			return tSync('game.assembly_help_remedy', { system: systemOf(def.color) });

		case 'special':
			switch (def.specialKind) {
				case 'swapPiece': return tSync('game.assembly_help_swap');
				case 'stealPiece': return tSync('game.assembly_help_steal');
				case 'plague': return tSync('game.assembly_help_plague');
				case 'scrapHands': return tSync('game.assembly_help_scrap');
				case 'fullSwap': return tSync('game.assembly_help_fullswap');
				default: return null;
			}

		default:
			return null;
	}
}

/**
 * One seat's spoken status: operational count toward the goal, each slot's piece and state,
 * and the hand size ONLY when it deviates from the norm. The players-panel identity line
 * and the S/C keys all speak through this, so every surface tells the same story.
 */
export function assemblyStatusText(
	gs: GameState,
	playerId: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
	const seat = assemblySeat(gs, playerId);
	if (!seat) return null;
	const catalog = assemblyCatalog(gs);
	const goal = gs.assemblyRules?.slotsToWin ?? 4;

	// A retired seat's whole story is its exit (rack and hand left the game).
	if (seat.retired) return tSync('game.status_retired');

	const parts: string[] = [
		tSync('game.assembly_status_progress', { count: functionalColors(seat), goal }),
	];
	for (const slot of seat.slots) {
		const def = catalog.get(slot.piece.cardId);
		const name = def ? tSync(def.nameKey) : slot.piece.cardId;
		const stateKey = isLocked(slot) ? 'game.assembly_state_locked'
			: slot.shields.length === 1 ? 'game.assembly_state_shielded'
			: slot.afflictions.length > 0 ? 'game.assembly_state_afflicted'
			: 'game.assembly_state_ok';
		parts.push(`${name} (${tSync(stateKey)})`);
	}
	// The refill brings everyone back to handSize each turn, so the count is only NEWS
	// when it deviates — empty-handed after a scrap, or short because the deck dried.
	// Speaking "3 cartas" on every status was noise (live-play: the exception, not the rule).
	const handSize = gs.assemblyRules?.handSize ?? 3;
	if (seat.handCount === 0) {
		parts.push(tSync('game.assembly_status_no_cards'));
	} else if (seat.handCount !== handSize) {
		parts.push(tSync('game.assembly_status_cards', { count: seat.handCount }));
	}
	return parts.join(', ');
}
