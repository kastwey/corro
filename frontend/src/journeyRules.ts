// journeyRules.ts — Client-side mirror of the server's journey legality, over the PUBLIC
// wire data (the deck catalog + rules) and MY projected view (my hand, everyone's table
// state). It feeds the hand panel (playable / spoken refusal reason) and the victim picker
// (which rivals can take an attack). The server re-checks everything on play — this only
// exists so the UI can refuse locally with the same words the server would use.
//
// Pure: no DOM, no i18n (reasons are game.journey_* KEYS, translated by the caller).

import type { GameState, JourneyCardDef, JourneyMemberState, JourneySeatState } from './models.js';

export interface JourneyPlayability {
	playable: boolean;
	/** i18n key of the refusal, when not playable. */
	reasonKey?: string;
}

/** Index the public deck catalog by card id. */
export function journeyCatalog(gs: GameState): Map<string, JourneyCardDef> {
	return new Map((gs.journeyDeck ?? []).map(c => [c.id, c]));
}

/** The seat a player occupies — alone, or shared with their team. */
export function journeySeat(gs: GameState, playerId: string): JourneySeatState | null {
	return gs.journey?.seats.find(s => s.members.some(m => m.playerId === playerId)) ?? null;
}

/** A player's own member slot (their private hand) inside their seat. */
export function journeyMember(gs: GameState, playerId: string): JourneyMemberState | null {
	return journeySeat(gs, playerId)?.members.find(m => m.playerId === playerId) ?? null;
}

function shieldsOf(def: JourneyCardDef): string[] {
	return def.shieldsKinds?.length ? def.shieldsKinds : (def.kind ? [def.kind] : []);
}

function shieldedKinds(seat: JourneySeatState, catalog: Map<string, JourneyCardDef>): Set<string> {
	const kinds = new Set<string>();
	for (const id of seat.immunities) {
		const def = catalog.get(id);
		if (def) for (const k of shieldsOf(def)) kinds.add(k);
	}
	return kinds;
}

function hazardClassOf(kind: string, catalog: Map<string, JourneyCardDef>): string | null {
	for (const def of catalog.values()) {
		if (def.type === 'attack' && def.kind === kind) return def.hazardClass ?? null;
	}
	return null;
}

/** A stopper hazard blocks all distance play. */
export function isStopped(seat: JourneySeatState, catalog: Map<string, JourneyCardDef>): boolean {
	return seat.hazards.some(kind => hazardClassOf(kind, catalog) === 'stopper');
}

/** A limiter hazard caps the distance value the seat may play. */
export function isLimited(seat: JourneySeatState, catalog: Map<string, JourneyCardDef>): boolean {
	return seat.hazards.some(kind => hazardClassOf(kind, catalog) === 'limiter');
}

/** May `attacker` land this attack on `target`? Mirrors the server's target checks. */
export function canAttackTarget(
	card: JourneyCardDef,
	target: JourneySeatState,
	gs: GameState,
	catalog: Map<string, JourneyCardDef>,
): boolean {
	if (target.retired) return false; // nobody is driving that car any more
	const kind = card.kind ?? '';
	if (shieldedKinds(target, catalog).has(kind)) return false;
	if (target.hazards.includes(kind)) return false;
	if (card.hazardClass === 'stopper' && isStopped(target, catalog) && !gs.journeyRules?.stackHazards) return false;
	return true;
}

/** The rival SEATS this attack can land on right now (empty = the card is unplayable).
 *  My own seat — my partner included — is never a target. */
export function attackableRivals(
	gs: GameState,
	myId: string,
	card: JourneyCardDef,
): JourneySeatState[] {
	const catalog = journeyCatalog(gs);
	return (gs.journey?.seats ?? [])
		.filter(s => !s.members.some(m => m.playerId === myId))
		.filter(s => canAttackTarget(card, s, gs, catalog));
}

/**
 * May I play this card (by catalog id) right now? For attacks, "playable" means at least one
 * rival can take it — the picker (or auto-target with a single rival) chooses whom.
 */
export function canPlayCard(gs: GameState, myId: string, cardId: string): JourneyPlayability {
	const catalog = journeyCatalog(gs);
	const card = catalog.get(cardId);
	const seat = journeySeat(gs, myId);
	const rules = gs.journeyRules;
	if (!card || !seat || !rules) return { playable: false, reasonKey: 'game.journey_unknown_card' };

	const plays = seat.playsByCard?.[card.id] ?? 0;
	if (card.maxPlaysPerHand != null && plays >= card.maxPlaysPerHand) {
		return { playable: false, reasonKey: 'game.journey_card_limit' };
	}

	switch (card.type) {
		case 'distance':
			if (isStopped(seat, catalog)) return { playable: false, reasonKey: 'game.journey_stopped' };
			if (isLimited(seat, catalog) && card.value > rules.limitCap) {
				return { playable: false, reasonKey: 'game.journey_over_limit' };
			}
			if (seat.km + card.value > rules.goalKm) return { playable: false, reasonKey: 'game.journey_overshoot' };
			return { playable: true };

		case 'attack':
			return attackableRivals(gs, myId, card).length > 0
				? { playable: true }
				: { playable: false, reasonKey: 'game.journey_no_attackable' };

		case 'remedy':
			return seat.hazards.includes(card.kind ?? '')
				? { playable: true }
				: { playable: false, reasonKey: 'game.journey_nothing_to_cure' };

		case 'immunity':
			return { playable: true };

		default:
			return { playable: false, reasonKey: 'game.journey_unknown_card' };
	}
}

/** May I draw right now? (My turn, not yet drawn, cards left — the panel's Space gate.) */
export function canDraw(gs: GameState, myId: string): JourneyPlayability {
	if (gs.currentTurn !== myId) return { playable: false, reasonKey: 'game.journey_not_your_turn' };
	if (gs.journey?.pendingCoup) return { playable: false, reasonKey: 'game.journey_coup_pending' };
	if (gs.journey?.hasDrawn) return { playable: false, reasonKey: 'game.journey_already_drew' };
	if ((gs.journey?.drawCount ?? 0) === 0) return { playable: false, reasonKey: 'game.journey_deck_empty' };
	return { playable: true };
}

/**
 * Whether the player may DISCARD right now. A turn is draw → (play | discard), so discarding
 * before drawing is illegal — the server rejects it (MustDrawFirst), and the hand must not even
 * OFFER it (no "do you want to discard?" prompt before a draw). Mirrors the server gate: you
 * must have drawn UNLESS the deck is empty (then hands only shrink and no draw is required).
 */
export function canDiscard(gs: GameState, myId: string): JourneyPlayability {
	if (gs.currentTurn !== myId) return { playable: false, reasonKey: 'game.journey_not_your_turn' };
	if (gs.journey?.pendingCoup) return { playable: false, reasonKey: 'game.journey_coup_pending' };
	if (!gs.journey?.hasDrawn && (gs.journey?.drawCount ?? 0) > 0)
		return { playable: false, reasonKey: 'game.journey_draw_first' };
	return { playable: true };
}

/**
 * "What does this card do?" — the hand's per-card Help text (live-play request). A package
 * may write its own via a `<nameKey>_help` i18n key; otherwise the engine composes one from
 * the card's data and the game's EFFECTIVE rules, naming the exact counter-cards.
 */
export function journeyCardHelp(
	gs: GameState,
	cardId: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
	const catalog = journeyCatalog(gs);
	const def = catalog.get(cardId);
	const rules = gs.journeyRules;
	if (!def || !rules) return null;

	// The package's own words win, when it wrote any.
	const overrideKey = `${def.nameKey}_help`;
	const override = tSync(overrideKey);
	if (override && override !== overrideKey) return override;

	const nameOf = (d: JourneyCardDef | undefined) => (d ? tSync(d.nameKey) : '');
	const remedyFor = (kind: string | null | undefined) =>
		nameOf([...catalog.values()].find(c => c.type === 'remedy' && c.kind === kind));

	switch (def.type) {
		case 'distance': {
			const parts = [tSync('game.journey_help_distance', { km: def.value, goal: rules.goalKm })];
			if (def.maxPlaysPerHand != null) {
				parts.push(tSync('game.journey_help_distance_limit', { max: def.maxPlaysPerHand }));
			}
			if (def.value > rules.limitCap) {
				parts.push(tSync('game.journey_help_distance_over_cap', { cap: rules.limitCap }));
			}
			return parts.join(' ');
		}

		case 'attack': {
			const remedy = remedyFor(def.kind);
			return def.hazardClass === 'limiter'
				? tSync('game.journey_help_attack_limiter', { cap: rules.limitCap, remedy })
				: tSync('game.journey_help_attack_stopper', { remedy });
		}

		case 'remedy': {
			if (def.kind === rules.initialHazard) return tSync('game.journey_help_remedy_go');
			const attack = nameOf([...catalog.values()].find(c => c.type === 'attack' && c.kind === def.kind));
			const goName = remedyFor(rules.initialHazard);
			const attackDef = [...catalog.values()].find(c => c.type === 'attack' && c.kind === def.kind);
			return attackDef?.hazardClass === 'limiter'
				? tSync('game.journey_help_remedy_limiter', { attack })
				: tSync('game.journey_help_remedy_stopper', { attack, go: goName });
		}

		case 'immunity': {
			const kinds = def.shieldsKinds?.length ? def.shieldsKinds : (def.kind ? [def.kind] : []);
			const list = kinds
				.map(k => nameOf([...catalog.values()].find(c => c.type === 'attack' && c.kind === k))
					|| (k === rules.initialHazard ? remedyFor(k) : k))
				.filter(Boolean)
				.join(', ');
			return tSync('game.journey_help_immunity', { list });
		}

		default:
			return null;
	}
}
