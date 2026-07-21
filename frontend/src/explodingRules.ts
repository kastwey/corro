// explodingRules.ts — Client-side mirror of the exploding family,
// over the PUBLIC wire data (deck catalog + rules, the discard top, the pending action) and MY
// projected view (my hand). It feeds the hand panel (playable / spoken refusal reason with the
// SERVER'S own keys) and the shared status line. The server re-checks everything.
//
// Pure: no DOM, no i18n (texts come through the caller's tSync).

import type { ExplodingCardDef, ExplodingSeatState, GameState } from './models.js';

export interface ExplodingPlayability {
	playable: boolean;
	/** i18n key of the refusal, when not playable. */
	reasonKey?: string;
}

/** Index the public deck catalog by card id. */
export function explodingCatalog(gs: GameState): Map<string, ExplodingCardDef> {
	return new Map((gs.explodingDeck ?? []).map(c => [c.id, c]));
}

export function explodingSeat(gs: GameState, playerId: string): ExplodingSeatState | null {
	return gs.exploding?.seats.find(s => s.playerId === playerId) ?? null;
}

/** The definition of the top of the discards (the last resolved card). */
export function topDef(gs: GameState): ExplodingCardDef | null {
	const pile = gs.exploding?.discardPile;
	const top = pile?.[pile.length - 1];
	return top ? explodingCatalog(gs).get(top.cardId) ?? null : null;
}

/** Does this seat hold a defuse? (Used for the status line.) */
export function holdsDefuse(gs: GameState, playerId: string): boolean {
	const seat = explodingSeat(gs, playerId);
	const catalog = explodingCatalog(gs);
	return !!seat?.hand.some(c => catalog.get(c.cardId)?.type === 'defuse');
}

/**
 * Is this card legal by its own rules and the current table state? As in the other card
 * families, global turn/interrupt gates do NOT rewrite card playability: otherwise every
 * filtered hand vanishes when the turn passes and a screen reader reports a needless empty
 * list. ExplodingBoard checks those gates when the player actually activates a card.
 *
 * A Nope is the exception whose CARD legality really is reactive — it appears while an action
 * is pending, on or off turn. A bomb and a defuse (auto-consumed on a bomb draw) are never
 * hand-played.
 */
/** The instanceId of a DIFFERENT card in my hand that pairs with `instanceId` (the same cat),
 *  or null. A cat is playable only when it has a pair partner. */
export function catPairPartner(gs: GameState, myId: string, instanceId: string): string | null {
	const seat = explodingSeat(gs, myId);
	const instance = seat?.hand.find(c => c.instanceId === instanceId);
	if (!seat || !instance) return null;
	if (explodingCatalog(gs).get(instance.cardId)?.type !== 'cat') return null;
	const partner = seat.hand.find(c => c.instanceId !== instanceId && c.cardId === instance.cardId);
	return partner?.instanceId ?? null;
}

export function canPlayCard(gs: GameState, myId: string, instanceId: string): ExplodingPlayability {
	const seat = explodingSeat(gs, myId);
	const exploding = gs.exploding;
	if (!seat || !exploding) return { playable: false, reasonKey: 'game.exploding_not_seated' };
	const instance = seat.hand.find(c => c.instanceId === instanceId);
	const card = instance ? explodingCatalog(gs).get(instance.cardId) : null;
	if (!instance || !card) return { playable: false, reasonKey: 'game.exploding_unknown_card' };

	// As the target of a pending Favor, ANY card is "playable" — Enter gives it to the requester.
	if (exploding.pendingFavor?.targetId === myId) return { playable: true };

	if (card.type === 'nope') {
		return exploding.pendingAction
			? { playable: true }
			: { playable: false, reasonKey: 'game.exploding_nothing_to_nope' };
	}

	if (card.type === 'skip' || card.type === 'attack' || card.type === 'shuffle'
		|| card.type === 'seeFuture' || card.type === 'favor') {
		return { playable: true };
	}
	if (card.type === 'cat') {
		return catPairPartner(gs, myId, instanceId)
			? { playable: true }
			: { playable: false, reasonKey: 'game.exploding_cat_needs_pair' };
	}
	return { playable: false, reasonKey: 'game.exploding_not_playable' };
}

/**
 * One seat's spoken status (the players-panel line, S and Shift+S all read this): the card
 * count, or "eliminated" for a fallen seat. Deliberately per-player and terse; the deck count
 * and the discard top are the on-demand D readout instead.
 */
export function explodingStatusText(
	gs: GameState,
	playerId: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
	const seat = explodingSeat(gs, playerId);
	if (!seat || !gs.exploding) return null;
	if (seat.retired) return tSync('game.status_retired');
	return seat.handCount === 1
		? tSync('game.exploding_status_cards_one')
		: tSync('game.exploding_status_cards', { count: seat.handCount });
}

/**
 * "What does this card do?" — the hand's per-card Help text. A package may write its own via a
 * `<nameKey>_help` i18n key; otherwise the engine composes one per type.
 */
export function explodingCardHelp(
	gs: GameState,
	cardId: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
	const def = explodingCatalog(gs).get(cardId);
	if (!def) return null;

	const overrideKey = `${def.nameKey}_help`;
	const override = tSync(overrideKey);
	if (override && override !== overrideKey) return override;

	switch (def.type) {
		case 'bomb': return tSync('game.exploding_help_bomb');
		case 'defuse': return tSync('game.exploding_help_defuse');
		case 'skip': return tSync('game.exploding_help_skip');
		case 'attack': return tSync('game.exploding_help_attack');
		case 'seeFuture': return tSync('game.exploding_help_see_future');
		case 'shuffle': return tSync('game.exploding_help_shuffle');
		case 'favor': return tSync('game.exploding_help_favor');
		case 'nope': return tSync('game.exploding_help_nope');
		case 'cat': return tSync('game.exploding_help_cat');
		default: return null;
	}
}
