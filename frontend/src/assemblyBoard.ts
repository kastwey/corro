// assemblyBoard.ts — The assembly family's surface. Like the journey board:
// NO spatial board — the HAND PANEL is the home surface (play with Enter, discard with
// Delete), and everything visual (the racks) is an aria-hidden echo for sighted players.
// The public game state a blind player needs — every rack's contents and states — speaks
// through assemblyStatusText: the players-panel identity line per player, and the S key for
// my own. Targeted cards walk short picker chains (victim → slot) through popupMenu.

import { HandPanel, type HandCard } from './handPanel.js';
import { cardArtSvg, genericCardArtHtml, genericCardBackHtml } from './cardArt.js';
import { popupMenu } from './popupMenu.js';
import { escapeHtml } from './escapeHtml.js';
import {
	assemblyCardHelp, assemblyCatalog, assemblySeat, assemblyStatusText, attackTargets,
	canPlayCard, canSwapPair, deckColors, isFunctional, isLocked, remedySlots, stealTargets, swapTargets,
} from './assemblyRules.js';
import { cardBoardHelpShortcuts, playerName, registerStatusKeys, resetCardBoard } from './cardBoardShell.js';
import { buildAssemblyRulesLines } from './rulesSummaries.js';
import type { AssemblyCardDef, AssemblySeatState, AssemblySlot, GameState } from './models.js';
import type { HelpShortcut } from './shortcuts.js';

export interface AssemblyBoardDeps {
	getGameState(): GameState | null;
	getMyPlayerId(): string | null;
	announce(text: string): void;
	tSync(key: string, vars?: Record<string, unknown>): string;
	onIdle(): void;
	motionDisabled(): boolean;
	commands: {
		play(instanceId: string, targeting?: { targetPlayerId?: string | null; targetColor?: string | null; giveColor?: string | null }): void;
		discard(instanceIds: string[]): void;
	};
}

/** Engine colour hexes for the slot bands (mirror of the server palette idea: the four
 *  classic piece colours plus the wild's neutral). Package colours beyond these fall back
 *  to gray — the piece NAME carries the meaning either way. */
const SLOT_COLORS: Record<string, string> = {
	red: '#e53935', green: '#43a047', blue: '#1e88e5', yellow: '#fdd835', wild: '#8e24aa',
};

export class AssemblyBoard {
	private built = false;
	private readonly hand = new HandPanel();
	private racks!: HTMLElement;
	/** Afflictions per seat at the previous render, to flash the victim's rack on a hit. */
	private readonly lastAfflictions = new Map<string, number>();

	constructor(
		private readonly element: HTMLElement,
		private readonly deps: AssemblyBoardDeps,
	) {}

	/** Repaint everything from a fresh state (builds the surface on first call). */
	update(gs: GameState): void {
		const firstBuild = !this.built;
		if (firstBuild) this.build();
		this.renderRacks(gs);
		this.hand.update();
		if (firstBuild && document.activeElement === this.element) this.hand.focus();
	}

	/** The hand is this family's home surface: board focus lands here. */
	focusHand(): void {
		this.hand.focus();
	}

	/** The hand keys (Enter/Delete) + the shared S / Shift+S status keys, for the help. */
	helpShortcuts(): HelpShortcut[] {
		return cardBoardHelpShortcuts(this.hand);
	}

	/** The active rules for the rules dialog (Ctrl+Shift+F1). */
	rulesSummary(): string[] {
		return buildAssemblyRulesLines(this.deps.getGameState()?.assemblyRules, this.deps.tSync);
	}

	/** Every RIVAL's rack status (Shift+S), each led by their name. My own rack is
	 *  deliberately left out — S already reads it ("esa ya me la sé con la S"). */
	private allSeatsStatus(gs: GameState, myId: string): string | null {
		const lines = (gs.assembly?.seats ?? []).filter(seat => seat.playerId !== myId).map(seat => {
			const status = assemblyStatusText(gs, seat.playerId, this.deps.tSync);
			if (!status) return null;
			return `${playerName(gs, seat.playerId)}: ${status}`;
		}).filter((s): s is string => !!s);
		return lines.length > 0 ? lines.join('. ') : null;
	}

	/** No piece animation in this family (plays land instantly). */
	isAnimating(): boolean {
		return false;
	}

	// ── Construction ──────────────────────────────────────────────────────────

	private build(): void {
		resetCardBoard(this.element, 'assembly-mode');

		// Visual-only region: the racks. Everything here is spoken elsewhere (the panel's
		// per-player status lines, the S key, the announcer).
		const visual = document.createElement('div');
		visual.className = 'assembly-visual';
		visual.setAttribute('aria-hidden', 'true');
		this.racks = document.createElement('div');
		this.racks.className = 'assembly-racks';
		visual.appendChild(this.racks);
		this.element.appendChild(visual);

		const handMount = document.createElement('div');
		handMount.className = 'assembly-hand';
		this.element.appendChild(handMount);

		this.hand.init(handMount, {
			getCards: () => this.myHandCards(),
			// The two face-down piles ride the hand as read-only rows: the table plans
			// around how many cards remain (and how fat the reshuffle pool is).
			infoRows: () => {
				const gs = this.deps.getGameState();
				if (!gs?.assembly) return [];
				return [{
					id: '__piles',
					label: this.deps.tSync('game.assembly_piles_row', {
						draw: gs.assembly.drawCount ?? 0,
						discard: gs.assembly.discardCount ?? 0,
					}),
					art: genericCardBackHtml(`${gs.assembly.drawCount ?? 0}/${gs.assembly.discardCount ?? 0}`),
				}];
			},
			onPlay: card => this.playCard(card),
			onDiscard: card => {
				const gs = this.deps.getGameState();
				const myId = this.deps.getMyPlayerId();
				if (!gs || !myId || !this.canActNow(gs, myId)) return;
				this.deps.commands.discard([card.id]);
			},
			announce: text => this.deps.announce(text),
			t: (key, vars) => this.deps.tSync(key, vars),
			// Enter plays; Delete discards (no draw — the rack refills automatically).
			shortcutText: { play: 'game.help_cmd_play_card', discard: 'game.help_cmd_discard_card' },
		});

		// S — "how am I doing?" — anywhere on the assembly surface; Shift+S answers
		// "how are the OTHERS doing?" (live-play request). Same as journey.
		registerStatusKeys(this.element, {
			getGameState: this.deps.getGameState,
			getMyPlayerId: this.deps.getMyPlayerId,
			announce: this.deps.announce,
			mine: (gs, myId) => assemblyStatusText(gs, myId, this.deps.tSync),
			rivals: (gs, myId) => this.allSeatsStatus(gs, myId),
		});

		this.built = true;
	}

	// ── The hand ──────────────────────────────────────────────────────────────

	/** The deck's systems ranked by their organ NAME in the current language — so "sort by
	 *  colour" groups them the way the player reads them (alphabetical: Bone, Brain, Heart…),
	 *  not in raw deck order. The colour's name is its piece card's name (as the help uses). */
	private orderedColours(gs: GameState): string[] {
		const catalog = assemblyCatalog(gs);
		const nameOf = (colour: string): string => {
			const piece = [...catalog.values()].find(c => c.type === 'piece' && c.color === colour);
			return piece ? this.deps.tSync(piece.nameKey) : colour;
		};
		return deckColors(gs).slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
	}

	private myHandCards(): HandCard[] {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return [];
		const seat = assemblySeat(gs, myId);
		if (!seat) return [];
		const catalog = assemblyCatalog(gs);
		// Colour rank for "sort by colour" = the card's place in the systems ranked by their
		// NAME in the current language (wilds match anything → no colour → they pool last).
		const colourRank = this.orderedColours(gs);

		return seat.hand.map(instance => {
			const def = catalog.get(instance.cardId);
			const play = canPlayCard(gs, myId, instance.cardId);
			const label = def ? this.deps.tSync(def.nameKey) : instance.cardId;
			const ci = def?.color && def.color !== 'wild' ? colourRank.indexOf(def.color) : -1;
			return {
				id: instance.instanceId,
				label,
				typeKey: def?.type ?? 'unknown',
				value: 0,
				colourOrder: ci >= 0 ? ci : undefined,
				playable: play.playable,
				unplayableReason: this.deps.tSync(play.reasonKey ?? 'game.hand_not_playable'),
				art: def ? genericCardArtHtml(def, label) : undefined,
				help: assemblyCardHelp(gs, instance.cardId, this.deps.tSync) ?? undefined,
			};
		});
	}

	/** Turn gate shared by play and discard: spoken, never silently swallowed. */
	private canActNow(gs: GameState, myId: string): boolean {
		if (gs.currentTurn !== myId) {
			this.deps.announce(this.deps.tSync('game.assembly_not_your_turn'));
			return false;
		}
		return true;
	}

	/** A slot's pick-list label: its piece's name plus its state, so choosing a target
	 *  reads like the table talk ("Reactor (averiado)"). */
	private slotLabel(slot: AssemblySlot, catalog: Map<string, AssemblyCardDef>): string {
		const def = catalog.get(slot.piece.cardId);
		const name = def ? this.deps.tSync(def.nameKey) : slot.piece.cardId;
		const stateKey = isLocked(slot) ? 'game.assembly_state_locked'
			: slot.shields.length === 1 ? 'game.assembly_state_shielded'
			: slot.afflictions.length > 0 ? 'game.assembly_state_afflicted'
			: 'game.assembly_state_ok';
		return `${name} (${this.deps.tSync(stateKey)})`;
	}

	/** One picker step: auto-select a lone option, otherwise open the popup. */
	private pick<T>(
		items: T[],
		labelOf: (item: T) => string,
		title: string,
		onPick: (item: T) => void,
	): void {
		if (items.length === 1) { onPick(items[0]); return; }
		popupMenu.open({
			ariaLabel: title,
			openAnnouncement: title,
			// Anchor to the focused hand row (unanchored it popped at the viewport's
			// top-left corner, visually disconnected from the play that opened it).
			anchor: document.activeElement instanceof HTMLElement ? document.activeElement : null,
			items: items.map(item => ({ label: labelOf(item), onSelect: () => onPick(item) })),
			announce: text => this.deps.announce(text),
			onClose: () => this.hand.focus(),
			// Escape/Tab aborts the WHOLE pending play (the card stays in hand): say so,
			// or the player is left wondering whether the card was played.
			onCancel: () => this.deps.announce(this.deps.tSync('game.pick_cancelled')),
		});
	}

	/** Enter on a card: route by type through the shortest picker chain that fully
	 *  specifies the play (victim, their slot, my slot for swaps). */
	private playCard(card: HandCard): void {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId || !this.canActNow(gs, myId)) return;
		const seat = assemblySeat(gs, myId);
		const instance = seat?.hand.find(c => c.instanceId === card.id);
		const catalog = assemblyCatalog(gs);
		const def = instance ? catalog.get(instance.cardId) : null;
		if (!def || !seat) return;

		const gate = canPlayCard(gs, myId, def.id);
		if (!gate.playable) {
			this.deps.announce(this.deps.tSync(gate.reasonKey ?? 'game.hand_not_playable'));
			return;
		}

		const nameOf = (s: AssemblySeatState) =>
			gs.players.find(p => p.id === s.playerId)?.name ?? s.playerId;
		const play = (targeting?: { targetPlayerId?: string | null; targetColor?: string | null; giveColor?: string | null }) =>
			this.deps.commands.play(card.id, targeting);

		switch (def.type) {
			case 'piece':
				play();
				return;

			case 'attack': {
				const targets = attackTargets(gs, myId, def);
				this.pick(targets, t => nameOf(t.seat),
					this.deps.tSync('game.assembly_pick_victim', { card: card.label }),
					t => this.pick(t.slots, s => this.slotLabel(s, catalog),
						this.deps.tSync('game.assembly_pick_slot', { player: nameOf(t.seat) }),
						s => play({ targetPlayerId: t.seat.playerId, targetColor: s.color })));
				return;
			}

			case 'remedy': {
				const slots = remedySlots(def, seat);
				this.pick(slots, s => this.slotLabel(s, catalog),
					this.deps.tSync('game.assembly_pick_own_slot', { card: card.label }),
					s => play({ targetColor: s.color }));
				return;
			}

			case 'special':
				switch (def.specialKind) {
					case 'stealPiece': {
						const targets = stealTargets(gs, myId);
						this.pick(targets, t => nameOf(t.seat),
							this.deps.tSync('game.assembly_pick_victim', { card: card.label }),
							t => this.pick(t.slots, s => this.slotLabel(s, catalog),
								this.deps.tSync('game.assembly_pick_slot', { player: nameOf(t.seat) }),
								s => play({ targetPlayerId: t.seat.playerId, targetColor: s.color })));
						return;
					}
					case 'swapPiece': {
						const targets = swapTargets(gs, myId);
						this.pick(targets, t => nameOf(t.seat),
							this.deps.tSync('game.assembly_pick_victim', { card: card.label }),
							t => this.pick(t.slots, s => this.slotLabel(s, catalog),
								this.deps.tSync('game.assembly_pick_slot', { player: nameOf(t.seat) }),
								theirSlot => {
									const mySlots = seat.slots.filter(mySlot =>
										canSwapPair(seat, mySlot, t.seat, theirSlot));
									this.pick(mySlots, s => this.slotLabel(s, catalog),
										this.deps.tSync('game.assembly_pick_give_slot'),
										mySlot => play({
											targetPlayerId: t.seat.playerId,
											targetColor: theirSlot.color,
											giveColor: mySlot.color,
										}));
								}));
						return;
					}
					case 'fullSwap': {
						const rivals = (gs.assembly?.seats ?? []).filter(s => s.playerId !== myId && !s.retired);
						this.pick(rivals, nameOf,
							this.deps.tSync('game.assembly_pick_victim', { card: card.label }),
							rival => play({ targetPlayerId: rival.playerId }));
						return;
					}
					default:
						// plague / scrapHands: no targeting — the effect is deterministic.
						play();
						return;
				}
		}
	}

	// ── Visual echoes (aria-hidden) ───────────────────────────────────────────

	private renderRacks(gs: GameState): void {
		const catalog = assemblyCatalog(gs);
		const goal = gs.assemblyRules?.slotsToWin ?? 4;
		const rows = (gs.assembly?.seats ?? []).map(seat => {
			const player = gs.players.find(p => p.id === seat.playerId);
			const color = escapeHtml(player?.color ?? '#888');
			const name = escapeHtml(player?.name ?? seat.playerId);
			// Each installed system is a MODULE card (system colour + name + a clear state); the
			// remaining bays to the goal are dashed placeholders, so "assemble 4 systems" reads at
			// a glance. All aria-hidden: the panel + S key speak the same for a blind player.
			const badgeOf: Record<string, string> = { locked: '🔒', shielded: '🛡', afflicted: '⚠', ok: '' };
			const modules = seat.slots.map(slot => {
				const def = catalog.get(slot.piece.cardId);
				const label = escapeHtml(def ? this.deps.tSync(def.nameKey) : slot.piece.cardId);
				const state = isLocked(slot) ? 'locked'
					: slot.shields.length === 1 ? 'shielded'
					: !isFunctional(slot) ? 'afflicted'
					: 'ok';
				const word = escapeHtml(this.deps.tSync(`game.assembly_state_${state}`));
				const band = SLOT_COLORS[slot.color] ?? '#9e9e9e';
				const tag = state === 'ok' ? ''
					: `<span class="assembly-module__tag">${badgeOf[state]} ${word}</span>`;
				const attachments = [...slot.afflictions, ...slot.shields]
					.map(instance => catalog.get(instance.cardId))
					.filter((card): card is AssemblyCardDef => !!card)
					.map(card => cardArtSvg(card, 'assembly-module__attachment-art'))
					.join('');
				return `<span class="assembly-module assembly-module--${state}" style="--slot-color:${band}" title="${label} (${word})">`
					+ (def ? cardArtSvg(def, 'assembly-module__art card-art-thumb') : '')
					+ (attachments ? `<span class="assembly-module__attachments">${attachments}</span>` : '')
					+ `<span class="assembly-module__name">${label}</span>`
					+ tag
					+ `</span>`;
			}).join('');
			const emptyBays = seat.retired ? 0 : Math.max(0, goal - seat.slots.length);
			const bays = '<span class="assembly-bay"></span>'.repeat(emptyBays);
			const slots = modules + bays;
			const done = seat.slots.filter(isFunctional).length;
			const cards = seat.retired ? '' : `<span class="assembly-rack__cards">🂠 ${seat.handCount}</span>`;
			const progress = seat.retired ? '' : `<span class="assembly-rack__progress">${done}/${goal}</span>`;
			return `<div class="assembly-rack${seat.retired ? ' assembly-rack--retired' : ''}" style="--seat-color:${color}">`
				+ `<span class="assembly-rack__name">${name}</span>`
				+ `<span class="assembly-rack__slots">${slots || `<span class="assembly-rack__empty">—</span>`}</span>`
				+ progress
				+ cards
				+ `</div>`;
		});
		this.racks.innerHTML = rows.join('');
		this.applyHitFlash(gs);
	}

	/** A rack whose afflictions just GREW flashes (same visual language as journey). */
	private applyHitFlash(gs: GameState): void {
		(gs.assembly?.seats ?? []).forEach((seat, index) => {
			const count = seat.slots.reduce((n, s) => n + s.afflictions.length, 0);
			const previous = this.lastAfflictions.get(seat.playerId);
			this.lastAfflictions.set(seat.playerId, count);
			if (previous === undefined || count <= previous) return;
			if (this.deps.motionDisabled()) return;
			const rack = this.racks.children[index] as HTMLElement | undefined;
			rack?.classList.add('assembly-rack--hit');
			window.setTimeout(() => rack?.classList.remove('assembly-rack--hit'), 700);
		});
	}
}
