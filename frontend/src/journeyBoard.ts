// journeyBoard.ts — The journey family's surface inside the shared #board container. There
// is no spatial board in this family: the interactive centre is the HAND (an accessible
// list — see handPanel.ts); everything else is a visual echo of information that is already
// spoken elsewhere (players panel, S/C status, server announcements), so it stays
// aria-hidden by design:
//
//   - the 0→goal progress STRIP, one car per seat in the player's colour — and the family's
//     ANIMATOR: distance plays slide the car in steps, holding the announcement gate exactly
//     like the other families' token animators. The slide itself is SILENT: each distance
//     card already carries its own per-value sound (25 km, 100 km…), which IS the move's
//     audio — a hop earcon on top would double it;
//   - per-seat DASHBOARDS (km, battle state, immunities) and the table CENTRE (deck count,
//     top discard, hand number, match scores).
//
// It also owns the journey dialogs: the state-driven coup fourré decision (non-modal,
// reconnect-safe — it re-opens from PendingCoup) and the victim picker for attacks with
// more than one legal target.

import { teamDisplayName } from './enginePalette.js';
import { vehicleKeyFor, vehicleSvgFor } from './journeyVehicles.js';
import { HandPanel, type HandCard } from './handPanel.js';
import {
	journeyCardArtHtml, journeyCardBackHtml, journeyKindIconSvg, journeyShieldIconSvg,
} from './journeyCardArt.js';
import { popupMenu } from './popupMenu.js';
import { dialogManager } from './dialogManager.js';
import { escapeHtml } from './escapeHtml.js';
import {
	attackableRivals, canDraw, canDiscard, canPlayCard, isLimited, isStopped, journeyCardHelp,
	journeyCatalog, journeyMember, journeySeat,
} from './journeyRules.js';
import { cardBoardHelpShortcuts, playerName, registerStatusKeys, resetCardBoard } from './cardBoardShell.js';
import { buildJourneyRulesLines } from './rulesSummaries.js';
import type { GameState, JourneyCardDef, JourneySeatState } from './models.js';
import type { HelpShortcut } from './shortcuts.js';

export interface JourneyBoardDeps {
	getGameState(): GameState | null;
	getMyPlayerId(): string | null;
	/** Instant, assertive raw-text announcement. */
	announce(text: string): void;
	tSync(key: string, vars?: Record<string, unknown>): string;
	/** Animation went idle: release gated announcements + advance the turn sequencer. */
	onIdle(): void;
	motionDisabled(): boolean;
	commands: {
		draw(): void;
		play(instanceId: string, targetId?: string | null): void;
		discard(instanceId: string): void;
		coup(accept: boolean): void;
	};
}

/** Kilometres each car slides per animation step. */
const KM_PER_STEP = 25;
const STEP_DELAY_MS = 200;
const FIRST_STEP_DELAY_MS = 600;

/**
 * The hazard kind that just LANDED on a seat: the one whose count grew between renders
 * (stacked hazards repeat kinds, so plain membership isn't enough), falling back to the
 * newest entry. Pure — exported for tests; null when nothing new landed.
 */
export function addedHazard(previous: string[], current: string[]): string | null {
	if (current.length <= previous.length) return null;
	const count = (list: string[], kind: string) => list.filter(k => k === kind).length;
	return current.find(k => count(current, k) > count(previous, k))
		?? current[current.length - 1]
		?? null;
}

/** The attack card that inflicts `kind`, for speaking a hazard by its card's name. */
function hazardCardOf(kind: string, catalog: Map<string, JourneyCardDef>): JourneyCardDef | null {
	for (const def of catalog.values()) {
		if (def.type === 'attack' && def.kind === kind) return def;
	}
	return null;
}

/** A SHARED seat's spoken identity («Equipo Rojo» — its palette colour word, the same
 *  colour as its car); null for a one-member seat (the player's name does the job). */
export function journeyTeamName(
	gs: GameState,
	seat: JourneySeatState,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
	if (seat.members.length < 2) return null;
	const index = gs.journey?.seats.indexOf(seat) ?? -1;
	return index >= 0 ? teamDisplayName(index, tSync) : null;
}

/**
 * One seat's spoken status: kilometres, battle state (rolling / stopped by X, limit), the
 * immunities played and the match score. The players-panel identity line and the S/C keys
 * all speak through this, so every surface tells the same story.
 */
export function journeyStatusText(
	gs: GameState,
	playerId: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
	const seat = journeySeat(gs, playerId);
	if (!seat) return null;
	const catalog = journeyCatalog(gs);

	// A retired seat's whole story is its exit and its banked score.
	if (seat.retired) {
		return [
			tSync('game.status_retired'),
			tSync('game.journey_status_score', { score: seat.score }),
		].join(', ');
	}

	const parts: string[] = [];
	// A shared seat leads with the TEAM's name: both partners' identity lines read as the
	// team's single story («Equipo Rojo, 200 kilómetros, en marcha…»).
	const team = journeyTeamName(gs, seat, tSync);
	if (team) parts.push(team);
	parts.push(tSync('game.journey_status_km', { km: seat.km }));

	// The INITIAL-HAZARD kind (the classic "stop") is never named: at game start nobody
	// threw you a red light, and after a repair the wait for the green light is the same
	// state — «parado» says it all, the remedy is identical either way. Real breakdowns
	// (pinchazo, sin gasolina…) keep their name: each needs its own cure.
	const initialKind = gs.journeyRules?.initialHazard ?? '';
	const stoppers = seat.hazards
		.filter(kind => kind !== initialKind)
		.map(kind => hazardCardOf(kind, catalog))
		.filter((d): d is JourneyCardDef => d?.hazardClass === 'stopper')
		.map(d => tSync(d.nameKey));
	if (stoppers.length > 0) {
		parts.push(tSync('game.journey_status_stopped', { hazard: stoppers.join(', ') }));
	} else if (isStopped(seat, catalog)) {
		parts.push(tSync('game.journey_status_stopped_plain'));
	} else {
		parts.push(tSync('game.journey_status_rolling'));
	}

	if (isLimited(seat, catalog)) {
		const limiter = seat.hazards.map(k => hazardCardOf(k, catalog)).find(d => d?.hazardClass === 'limiter');
		if (limiter) parts.push(tSync(limiter.nameKey));
	}

	if (seat.immunities.length > 0) {
		const names = seat.immunities
			.map(id => catalog.get(id))
			.filter((d): d is JourneyCardDef => !!d)
			.map(d => tSync(d.nameKey));
		parts.push(tSync('game.journey_status_immunities', { list: names.join(', ') }));
	}

	// The score is the LIVE total: match points from finished hands PLUS what this hand
	// has already banked (km, immunities, coups fourrés) — hearing «0 puntos» while the
	// car advances reads as broken. Completion bonuses arrive at hand end, as always.
	parts.push(tSync('game.journey_status_score', { score: liveScore(gs, seat, catalog) }));
	return parts.join(', ');
}

/**
 * A seat's battle state as ONE readable flag for the dashboard chip (live-play request:
 * the tiny hazard icons alone didn't tell a sighted player their own state). Stopped wins
 * over limited; the label follows the same naming rules as {@link journeyStatusText}
 * (the initial "waiting for the green light" hazard stays unnamed — plain «parado»).
 * Pure — exported for tests.
 */
export function journeyDashFlag(
	gs: GameState,
	seat: JourneySeatState,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): { kind: 'stopped' | 'limited' | 'rolling'; label: string } {
	const catalog = journeyCatalog(gs);
	if (isStopped(seat, catalog)) {
		const initialKind = gs.journeyRules?.initialHazard ?? '';
		const named = seat.hazards
			.filter(kind => kind !== initialKind)
			.map(kind => hazardCardOf(kind, catalog))
			.filter((d): d is JourneyCardDef => d?.hazardClass === 'stopper')
			.map(d => tSync(d.nameKey));
		return {
			kind: 'stopped',
			label: named.length > 0 ? named.join(', ') : tSync('game.journey_status_stopped_plain'),
		};
	}
	if (isLimited(seat, catalog)) {
		const limiter = seat.hazards.map(k => hazardCardOf(k, catalog)).find(d => d?.hazardClass === 'limiter');
		if (limiter) return { kind: 'limited', label: tSync(limiter.nameKey) };
	}
	return { kind: 'rolling', label: tSync('game.journey_status_rolling') };
}

/** Match score + the current hand's banked points (the official per-play values). */
function liveScore(
	gs: GameState,
	seat: JourneySeatState,
	catalog: Map<string, JourneyCardDef>,
): number {
	const rules = gs.journeyRules;
	let score = seat.score
		+ seat.km * (rules?.pointsPerKm ?? 1)
		+ seat.immunities.length * (rules?.immunityPoints ?? 100)
		+ seat.coupFourres * (rules?.coupFourreBonus ?? 300);
	const immunityDefs = [...catalog.values()].filter(d => d.type === 'immunity').length;
	if (immunityDefs > 0 && new Set(seat.immunities).size === immunityDefs) {
		score += rules?.allImmunitiesBonus ?? 300;
	}
	return score;
}

export class JourneyBoard {
	private built = false;
	private readonly hand = new HandPanel();
	private strip!: HTMLElement;
	private dashboards!: HTMLElement;
	private centre!: HTMLElement;

	/** The km each car currently SHOWS (may lag the state while sliding). */
	private readonly displayedKm = new Map<string, number>();
	private readonly animating = new Set<string>();
	private readonly generation = new Map<string, number>();
	/** Hazards per seat at the LAST paint — a growth means "just hit" (the shake). */
	/** Each seat's hazards at the previous render, to spot the exact attack that landed. */
	private readonly lastHazards = new Map<string, string[]>();
	/** Which pending coup the open dialog belongs to (null = none shown). */
	private coupShownFor: string | null = null;

	constructor(
		private readonly element: HTMLElement,
		private readonly deps: JourneyBoardDeps,
	) {}

	/** Repaint everything from a fresh state (builds the surface on first call). */
	update(gs: GameState): void {
		const firstBuild = !this.built;
		if (firstBuild) this.build();
		this.renderDashboards(gs);
		this.renderCentre(gs);
		this.syncCars(gs);
		this.applyHitEffects(gs);
		this.hand.update();
		this.reconcileCoupDialog(gs);
		// The page's initial focus may have landed on the container BEFORE this family
		// built (announcing "Tablero"): dive into the hand now that it exists.
		if (firstBuild && document.activeElement === this.element) this.hand.focus();
	}

	/** The hand is this family's home surface: board focus lands here. */
	focusHand(): void {
		this.hand.focus();
	}

	/** The hand keys (Enter/Space/Delete) + the shared S / Shift+S status keys, for the help. */
	helpShortcuts(): HelpShortcut[] {
		return cardBoardHelpShortcuts(this.hand);
	}

	/** The active rules for the rules dialog (Ctrl+Shift+F1). */
	rulesSummary(): string[] {
		return buildJourneyRulesLines(this.deps.getGameState()?.journeyRules, this.deps.tSync);
	}

	/** Every RIVAL seat's status (Shift+S), each led by its identity — a shared seat's
	 *  line already starts with the team word, a lone player gets named. My own seat is
	 *  deliberately left out ("esa ya me la sé con la S"); in team play "mine" is the
	 *  whole shared seat, partner included. */
	private allSeatsStatus(gs: GameState, myId: string): string | null {
		const lines = (gs.journey?.seats ?? []).filter(seat => !seat.members.some(m => m.playerId === myId)).map(seat => {
			const status = journeyStatusText(gs, seat.playerId, this.deps.tSync);
			if (!status) return null;
			if (seat.members.length > 1) return status; // the team name leads it already
			return `${playerName(gs, seat.playerId)}: ${status}`;
		}).filter((s): s is string => !!s);
		return lines.length > 0 ? lines.join('. ') : null;
	}

	/** True while any car is sliding (paces the announcement gate). */
	isAnimating(): boolean {
		return this.animating.size > 0;
	}

	// ── Construction ──────────────────────────────────────────────────────────

	private build(): void {
		resetCardBoard(this.element, 'journey-mode');

		// Visual-only region: everything here is spoken elsewhere (panel, S/C, announcer).
		const visual = document.createElement('div');
		visual.className = 'journey-visual';
		visual.setAttribute('aria-hidden', 'true');

		this.strip = document.createElement('div');
		this.strip.className = 'journey-strip';
		visual.appendChild(this.strip);

		this.dashboards = document.createElement('div');
		this.dashboards.className = 'journey-dashboards';
		visual.appendChild(this.dashboards);

		this.centre = document.createElement('div');
		this.centre.className = 'journey-centre';
		visual.appendChild(this.centre);

		this.element.appendChild(visual);

		const handMount = document.createElement('div');
		handMount.className = 'journey-hand';
		this.element.appendChild(handMount);

		this.hand.init(handMount, {
			getCards: () => this.myHandCards(),
			// The draw pile rides the hand as a read-only row: how many cards are left is
			// table state every player plans around (the exhausted-deck endgame).
			infoRows: () => {
				const gs = this.deps.getGameState();
				if (!gs?.journey) return [];
				const count = gs.journey.drawCount ?? 0;
				return [{
					id: '__deck',
					label: this.deps.tSync('game.journey_deck_row', { count }),
					// Visually: a face-down card at the end of the hand wearing the count.
					art: journeyCardBackHtml(String(count)),
				}];
			},
			canDraw: () => {
				const gs = this.deps.getGameState();
				const myId = this.deps.getMyPlayerId();
				if (!gs || !myId) return { ok: false, reason: this.deps.tSync('game.journey_not_your_turn') };
				const gate = canDraw(gs, myId);
				return gate.playable
					? { ok: true }
					: { ok: false, reason: this.deps.tSync(gate.reasonKey!) };
			},
			onDraw: () => this.deps.commands.draw(),
			onPlay: card => this.playCard(card),
			canDiscard: () => {
				const gs = this.deps.getGameState();
				const myId = this.deps.getMyPlayerId();
				if (!gs || !myId) return { ok: false, reason: this.deps.tSync('game.journey_not_your_turn') };
				const gate = canDiscard(gs, myId);
				return gate.playable
					? { ok: true }
					: { ok: false, reason: this.deps.tSync(gate.reasonKey!) };
			},
			onDiscard: card => {
				const gs = this.deps.getGameState();
				const myId = this.deps.getMyPlayerId();
				if (!gs || !myId || !this.canActNow(gs, myId)) return;
				this.flyCardToCentre(card.id);
				this.deps.commands.discard(card.id);
			},
			announce: text => this.deps.announce(text),
			t: (key, vars) => this.deps.tSync(key, vars),
			// Enter plays, Space draws, Delete discards.
			shortcutText: {
				play: 'game.help_cmd_play_card',
				draw: 'game.help_cmd_draw_card',
				discard: 'game.help_cmd_discard_card',
			},
		});

		// S — "how am I doing?" — works anywhere on the journey surface; Shift+S answers
		// "how are the OTHERS doing?" (live-play request). The race keymap's own "s" is
		// family-tagged and inert here; this surface-local key is documented in the board
		// guide (F1) like the hand's Space/Enter/Delete.
		registerStatusKeys(this.element, {
			getGameState: this.deps.getGameState,
			getMyPlayerId: this.deps.getMyPlayerId,
			announce: this.deps.announce,
			mine: (gs, myId) => journeyStatusText(gs, myId, this.deps.tSync),
			rivals: (gs, myId) => this.allSeatsStatus(gs, myId),
		});

		this.built = true;
	}

	// ── The hand ──────────────────────────────────────────────────────────────

	private myHandCards(): HandCard[] {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return [];
		// MY member slot: in team play the seat is shared but the hand is mine alone.
		const member = journeyMember(gs, myId);
		if (!member) return [];
		const catalog = journeyCatalog(gs);

		return member.hand.map(instance => {
			const def = catalog.get(instance.cardId);
			const play = canPlayCard(gs, myId, instance.cardId);
			const label = def ? this.deps.tSync(def.nameKey) : instance.cardId;
			// Playability is the CARD's legality only — never the turn. Rows would otherwise
			// rewrite their labels on every turn change (a screen reader re-reads the focused
			// row and the whole list "feels rebuilt"); whose turn it is stays an ACT-time
			// check (see playCard/discard gates), spoken when you actually try.
			return {
				id: instance.instanceId,
				label,
				typeKey: def?.type ?? 'unknown',
				value: def?.value ?? 0,
				playable: play.playable,
				unplayableReason: this.deps.tSync(play.reasonKey ?? 'game.hand_not_playable'),
				// The engine-rendered face (aria-hidden): the sighted player's card.
				art: def ? journeyCardArtHtml(def, label, { limitCap: gs.journeyRules?.limitCap }) : undefined,
				help: journeyCardHelp(gs, instance.cardId, this.deps.tSync) ?? undefined,
			};
		});
	}

	/** Turn/interrupt gate shared by play and discard: spoken, never silently swallowed. */
	private canActNow(gs: GameState, myId: string): boolean {
		if (gs.currentTurn !== myId) {
			this.deps.announce(this.deps.tSync('game.journey_not_your_turn'));
			return false;
		}
		if (gs.journey?.pendingCoup) {
			this.deps.announce(this.deps.tSync('game.journey_coup_pending'));
			return false;
		}
		return true;
	}

	/** Enter on a card: attacks pick their victim (auto with one, picker with several). */
	private playCard(card: HandCard): void {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId || !this.canActNow(gs, myId)) return;
		const instance = journeyMember(gs, myId)?.hand.find(c => c.instanceId === card.id);
		const def = instance ? journeyCatalog(gs).get(instance.cardId) : null;
		if (!def) return;

		if (def.type !== 'attack') {
			this.flyCardToCentre(card.id);
			this.deps.commands.play(card.id);
			return;
		}

		const rivals = attackableRivals(gs, myId, def);
		if (rivals.length === 0) {
			this.deps.announce(this.deps.tSync('game.journey_no_attackable'));
			return;
		}
		if (rivals.length === 1) {
			this.flyCardToCentre(card.id);
			this.deps.commands.play(card.id, rivals[0].playerId);
			return;
		}

		// A rival SEAT is picked by its identity: the team word when shared, the name alone.
		const nameOf = (seat: JourneySeatState) =>
			journeyTeamName(gs, seat, this.deps.tSync)
				?? gs.players.find(p => p.id === seat.playerId)?.name ?? seat.playerId;
		popupMenu.open({
			ariaLabel: this.deps.tSync('game.journey_pick_victim', { card: card.label }),
			openAnnouncement: this.deps.tSync('game.journey_pick_victim', { card: card.label }),
			// Anchor to the focused hand row (unanchored it popped at the viewport corner).
			anchor: document.activeElement instanceof HTMLElement ? document.activeElement : null,
			items: rivals.map(seat => ({
				label: nameOf(seat),
				onSelect: () => {
					this.flyCardToCentre(card.id);
					this.deps.commands.play(card.id, seat.playerId);
				},
			})),
			announce: text => this.deps.announce(text),
			onClose: () => this.hand.focus(),
			// Escape/Tab aborts the attack (the card stays in hand): say so.
			onCancel: () => this.deps.announce(this.deps.tSync('game.pick_cancelled')),
		});
	}

	// ── The coup fourré decision (state-driven, reconnect-safe) ───────────────

	private reconcileCoupDialog(gs: GameState): void {
		const coup = gs.journey?.pendingCoup;
		const myId = this.deps.getMyPlayerId();
		const key = coup && coup.victimId === myId ? `${coup.attackerId}:${coup.hazardKind}` : null;
		if (key === this.coupShownFor) return;

		if (key === null) {
			if (this.coupShownFor !== null) dialogManager.closeNonModal();
			this.coupShownFor = null;
			return;
		}

		this.coupShownFor = key;
		const hazard = hazardCardOf(coup!.hazardKind, journeyCatalog(gs));
		const hazardName = hazard ? this.deps.tSync(hazard.nameKey) : coup!.hazardKind;
		const closeAnd = (accept: boolean) => () => {
			this.coupShownFor = null;
			dialogManager.closeNonModal();
			document.getElementById('board')?.focus();
			this.deps.commands.coup(accept);
		};
		dialogManager.show({
			title: this.deps.tSync('game.journey_coup_title'),
			content: `<p>${escapeHtml(this.deps.tSync('game.journey_coup_body', { card: hazardName }))}</p>`,
			className: 'dialog-journey-coup',
			// Non-modal like the race choice: the decision is state-driven and must be
			// answered, but the player may go check the table first and come back.
			modal: false,
			buttons: [
				{
					label: this.deps.tSync('game.journey_coup_accept'),
					variant: 'primary',
					action: closeAnd(true),
				},
				{
					label: this.deps.tSync('game.journey_coup_decline'),
					variant: 'secondary',
					action: closeAnd(false),
				},
			],
		});
	}

	// ── Visual echoes (aria-hidden) ───────────────────────────────────────────

	private renderDashboards(gs: GameState): void {
		const catalog = journeyCatalog(gs);
		const cap = gs.journeyRules?.limitCap ?? 50;
		const rows = (gs.journey?.seats ?? []).map(seat => {
			const player = gs.players.find(p => p.id === seat.playerId);
			const color = escapeHtml(player?.color ?? '#888');
			// One dashboard per SEAT: a lone player by name, a team by all its members'.
			const names = seat.members
				.map(m => gs.players.find(p => p.id === m.playerId)?.name ?? m.playerId)
				.join(' + ');
			const cards = seat.members.reduce((n, m) => n + m.handCount, 0);
			// The odometer: km as rolling-counter digits; dim while the car is stopped.
			const digits = [...String(seat.km).padStart(4, '0')]
				.map(d => `<span class="journey-dash__digit">${d}</span>`).join('');
			const hazardIcons = seat.hazards
				.map(kind => journeyKindIconSvg(kind, 'attack', cap))
				.filter((s): s is string => !!s)
				.map(s => `<span class="journey-dash__icon">${s}</span>`).join('');
			const immunityIcons = seat.immunities
				.map(() => `<span class="journey-dash__icon journey-dash__icon--shield">${journeyShieldIconSvg()}</span>`)
				.join('');
			const score = this.deps.tSync('game.journey_status_score', {
				score: liveScore(gs, seat, catalog),
			});
			// The seat's battle state as one readable, colour-coded chip (red stopped /
			// amber limited / green rolling): the icons alone were too small to answer
			// "can I move right now, and why not?" at a glance (live-play request).
			const flag = journeyDashFlag(gs, seat, this.deps.tSync);
			const flagChip = `<span class="journey-dash__flag journey-dash__flag--${flag.kind}">${escapeHtml(flag.label)}</span>`;
			const stopped = isStopped(seat, catalog) ? ' journey-dash--stopped' : '';
			return `<div class="journey-dash${stopped}" style="--seat-color:${color}">`
				+ `<span class="journey-dash__name">${escapeHtml(names)}</span>`
				+ `<span class="journey-dash__odo">${digits}<span class="journey-dash__odo-unit">km</span></span>`
				+ flagChip
				+ `<span class="journey-dash__state">${hazardIcons}${immunityIcons}</span>`
				+ `<span class="journey-dash__score">${escapeHtml(score)}</span>`
				+ `<span class="journey-dash__cards">🂠 ${cards}</span>`
				+ `</div>`;
		});
		this.dashboards.innerHTML = rows.join('');
	}

	private renderCentre(gs: GameState): void {
		const t = this.deps.tSync;
		const catalog = journeyCatalog(gs);
		const pile = gs.journey?.discardPile ?? [];
		const top = pile.length > 0 ? pile[pile.length - 1] : undefined;
		const topDef = top ? catalog.get(top.cardId) : null;
		const count = gs.journey?.drawCount ?? 0;

		// The TABLE centre: the draw pile as a stack of card backs wearing its count, the
		// top discard as a real face, the hand number as a small chip. All aria-hidden.
		const deck = `<span class="journey-centre__pile">`
			+ `<span class="journey-centre__stack">${journeyCardBackHtml(String(count))}</span>`
			+ `<span class="journey-centre__pile-label">${escapeHtml(t('game.journey_pile_deck'))}</span>`
			+ `</span>`;
		const discard = `<span class="journey-centre__pile">`
			+ `<span class="journey-centre__discard">`
			+ (topDef
				? journeyCardArtHtml(topDef, t(topDef.nameKey), { limitCap: gs.journeyRules?.limitCap })
				: `<span class="jcard jcard--empty"></span>`)
			+ `</span>`
			+ `<span class="journey-centre__pile-label">${escapeHtml(t('game.journey_pile_discard'))}</span>`
			+ `</span>`;
		const round = `<span class="journey-centre__round">${escapeHtml(t('game.journey_round', { round: gs.journey?.round ?? 1 }))}</span>`;
		this.centre.innerHTML = deck + discard + round;
	}

	/** Quarter-km milestones and the chequered finish, rebuilt only when the goal changes. */
	private ensureRoad(goal: number): void {
		if (this.strip.dataset.goal === String(goal)) return;
		this.strip.dataset.goal = String(goal);
		for (const el of Array.from(this.strip.querySelectorAll('.journey-road__mark, .journey-road__finish'))) el.remove();
		for (let quarter = 1; quarter <= 3; quarter++) {
			const mark = document.createElement('span');
			mark.className = 'journey-road__mark';
			mark.style.left = `${quarter * 25}%`;
			mark.textContent = String(Math.round((goal * quarter) / 4));
			this.strip.appendChild(mark);
		}
		const finish = document.createElement('span');
		finish.className = 'journey-road__finish';
		this.strip.appendChild(finish);
	}

	/** Reconcile the strip's cars: new seats snap in place, grown kilometres slide. */
	private syncCars(gs: GameState): void {
		const goal = gs.journeyRules?.goalKm ?? 1000;
		this.ensureRoad(goal);
		const seats = gs.journey?.seats ?? [];
		// One lane per seat so cars never sit on top of each other (worst at km 0, all at the
		// start): the strip grows and each car rides its own lane (--lane), set below.
		this.strip.style.setProperty('--journey-lanes', String(Math.max(1, seats.length)));

		// Rebuild markers if the seat set changed (start/new hand), else move the existing.
		const wanted = new Set(seats.map(s => s.playerId));
		for (const id of [...this.displayedKm.keys()]) {
			if (!wanted.has(id)) { this.displayedKm.delete(id); this.animating.delete(id); }
		}
		for (const el of Array.from(this.strip.querySelectorAll<HTMLElement>('.journey-car'))) {
			if (!wanted.has(el.dataset.playerId ?? '')) el.remove();
		}

		for (const seat of seats) {
			// Matched by dataset (not a CSS selector) so arbitrary player ids never need escaping.
			let car = Array.from(this.strip.querySelectorAll<HTMLElement>('.journey-car'))
				.find(el => el.dataset.playerId === seat.playerId) ?? null;
			const player = gs.players.find(p => p.id === seat.playerId);
			if (!car) {
				// The marker is the VEHICLE this seat picked in the lobby (live-play bug: a
				// player chose the motorbike and still saw a car). data-vehicle exposes what
				// was actually drawn, for tests and debugging.
				car = document.createElement('span');
				car.className = 'journey-car';
				car.dataset.playerId = seat.playerId;
				car.dataset.vehicle = vehicleKeyFor(player?.token);
				car.innerHTML = `${vehicleSvgFor(player?.token)}<span class="journey-car__badges"></span>`;
				this.strip.appendChild(car);
			}
			if (player?.color) car.style.color = player.color;
			car.style.setProperty('--lane', String(seats.indexOf(seat))); // its own lane on the road
			// The car wears its troubles: one mini-sign per active hazard, at a glance.
			const badges = seat.hazards
				.map(kind => journeyKindIconSvg(kind, 'attack', gs.journeyRules?.limitCap ?? 50))
				.filter((s): s is string => !!s)
				.join('');
			const badgeHost = car.querySelector<HTMLElement>('.journey-car__badges');
			if (badgeHost && badgeHost.dataset.rendered !== badges) {
				badgeHost.innerHTML = badges;
				badgeHost.dataset.rendered = badges;
			}

			const shown = this.displayedKm.get(seat.playerId);
			if (shown === undefined || seat.km < shown || this.deps.motionDisabled()) {
				// First paint, a fresh hand (km dropped) or reduced motion: snap.
				this.placeCar(car, seat.playerId, seat.km, goal);
				continue;
			}
			if (seat.km > shown && !this.animating.has(seat.playerId)) {
				this.slideCar(car, seat.playerId, shown, seat.km, goal);
			} else if (seat.km === shown) {
				this.positionCar(car, seat.km, goal);
			}
		}
	}

	/** JUICE: the played/discarded card flies from the hand to the table centre. A pure
	 *  visual clone — the real row repaints from the next state; reduced motion skips it. */
	private flyCardToCentre(cardInstanceId: string): void {
		if (this.deps.motionDisabled()) return;
		const row = Array.from(this.element.querySelectorAll<HTMLElement>('.hand-card'))
			.find(el => el.dataset.focusId === cardInstanceId);
		const face = row?.querySelector<HTMLElement>('.hand-card__art .jcard');
		const target = this.centre?.querySelector<HTMLElement>('.journey-centre__discard') ?? this.centre;
		if (!face || !target) return;
		const from = face.getBoundingClientRect();
		const to = target.getBoundingClientRect();
		if (from.width === 0 || to.width === 0) return; // headless layouts: nothing to show

		const clone = face.cloneNode(true) as HTMLElement;
		clone.classList.add('jcard-flight');
		clone.style.left = `${from.left}px`;
		clone.style.top = `${from.top}px`;
		clone.style.width = `${from.width}px`;
		clone.style.height = `${from.height}px`;
		document.body.appendChild(clone);
		requestAnimationFrame(() => {
			clone.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px)`
				+ ` scale(${Math.max(0.3, to.width / from.width)}) rotate(354deg)`;
			clone.style.opacity = '0.3';
		});
		window.setTimeout(() => clone.remove(), 600);
	}

	/** JUICE + INFO: a seat whose hazards just GREW takes a visible hit. The dashboard and
	 *  car shake (motion-gated), and a transient banner on the victim's dashboard NAMES the
	 *  attack with its traffic sign — live-play bug: the victim saw nothing identifiable
	 *  and asked "what happened?". The banner shows even under reduced motion (it is
	 *  information, not motion) and stays aria-hidden: the server's _victim line is the
	 *  spoken channel. */
	private applyHitEffects(gs: GameState): void {
		const seats = gs.journey?.seats ?? [];
		const catalog = journeyCatalog(gs);
		seats.forEach((seat, index) => {
			const previous = this.lastHazards.get(seat.playerId);
			this.lastHazards.set(seat.playerId, [...seat.hazards]);
			if (previous === undefined) return;
			const added = addedHazard(previous, seat.hazards);
			if (!added) return;

			const dash = this.dashboards.children[index] as HTMLElement | undefined;
			const car = Array.from(this.strip.querySelectorAll<HTMLElement>('.journey-car'))
				.find(el => el.dataset.playerId === seat.playerId);
			if (!this.deps.motionDisabled()) {
				dash?.classList.add('journey-dash--hit');
				car?.classList.add('journey-car--hit');
				window.setTimeout(() => {
					dash?.classList.remove('journey-dash--hit');
					car?.classList.remove('journey-car--hit');
				}, 700);
			}
			if (dash) {
				dash.querySelector('.journey-dash__hitflash')?.remove();
				const def = hazardCardOf(added, catalog);
				const flash = document.createElement('span');
				flash.className = 'journey-dash__hitflash';
				flash.setAttribute('aria-hidden', 'true');
				flash.innerHTML =
					(journeyKindIconSvg(added, 'attack', gs.journeyRules?.limitCap ?? 50) ?? '')
					+ `<span class="journey-dash__hitflash-name">${escapeHtml(def ? this.deps.tSync(def.nameKey) : added)}</span>`;
				dash.appendChild(flash);
				window.setTimeout(() => flash.remove(), 2600);
			}
		});
	}

	private placeCar(car: HTMLElement, playerId: string, km: number, goal: number): void {
		const wasAnimating = this.animating.delete(playerId);
		this.generation.set(playerId, (this.generation.get(playerId) ?? 0) + 1);
		this.displayedKm.set(playerId, km);
		this.positionCar(car, km, goal);
		if (wasAnimating) this.deps.onIdle();
	}

	private positionCar(car: HTMLElement, km: number, goal: number): void {
		car.style.left = `${Math.min(100, (km / goal) * 100)}%`;
	}

	/** Slide in KM_PER_STEP chunks — silently: the distance card's own sound is the audio. */
	private slideCar(car: HTMLElement, playerId: string, from: number, to: number, goal: number): void {
		const gen = (this.generation.get(playerId) ?? 0) + 1;
		this.generation.set(playerId, gen);
		this.animating.add(playerId);

		const step = () => {
			if (this.generation.get(playerId) !== gen) return; // superseded
			const shown = this.displayedKm.get(playerId) ?? from;
			const next = Math.min(to, shown + KM_PER_STEP);
			this.displayedKm.set(playerId, next);
			this.positionCar(car, next, goal);
			if (next < to) {
				setTimeout(step, STEP_DELAY_MS);
			} else {
				this.animating.delete(playerId);
				this.deps.onIdle();
			}
		};
		setTimeout(step, FIRST_STEP_DELAY_MS);
	}
}
