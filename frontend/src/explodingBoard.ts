// explodingBoard.ts — The exploding family's surface. Like the other
// card families: NO spatial board — the HAND PANEL is the home surface. Enter plays an action
// card (or a Nope, off-turn), Space draws (which ends the turn and may detonate). When you draw
// a bomb you hold a defuse for, a depth picker opens to tuck it back secretly. The "n" reaction
// key jumps focus to a Nope so you can Enter it fast during the suspense window. Everything
// visual (the discard top, the draw-pile count, the alive rivals) is an aria-hidden echo; the
// same story speaks through explodingStatusText (S / Shift+S / the players panel).

import { HandPanel, type HandCard } from './handPanel.js';
import {
	explodingCardArtHtml, explodingCardBackHtml, explodingEmptyCardHtml,
} from './explodingCardArt.js';
import { popupMenu } from './popupMenu.js';
import { escapeHtml } from './escapeHtml.js';
import { contrastingTextColor } from './colorContrast.js';
import {
	canPlayCard, catPairPartner, explodingCardHelp, explodingCatalog, explodingSeat,
	explodingStatusText, topDef,
} from './explodingRules.js';
import { soundEvents } from './soundEvents.js';
import { cardBoardHelpShortcuts, playerName, registerStatusKeys, resetCardBoard } from './cardBoardShell.js';
import { showGameRulesDialog } from './gameRulesDialog.js';
import type { GameState } from './models.js';
import type { HelpShortcut } from './shortcuts.js';

export interface ExplodingBoardDeps {
	getGameState(): GameState | null;
	getMyPlayerId(): string | null;
	announce(text: string): void;
	tSync(key: string, vars?: Record<string, unknown>): string;
	onIdle(): void;
	motionDisabled(): boolean;
	commands: {
		/** Play an action card. `targetId` names a Favor / cat-steal victim; `secondInstanceId`
		 *  is the matching cat of a pair. */
		play(instanceId: string, targetId?: string, secondInstanceId?: string): void;
		/** Draw the top card — ends the turn; may detonate. */
		draw(): void;
		/** Play a Nope on the pending action (off-turn). */
		nope(instanceId: string): void;
		/** Tuck the just-drawn (defused) bomb back at `depth` cards from the top. */
		defuse(depth: number): void;
		/** As a Favor's target, give the requester the chosen card. */
		give(instanceId: string): void;
	};
}

export class ExplodingBoard {
	private built = false;
	private readonly hand = new HandPanel();
	private table!: HTMLElement;
	/** The bomb instance whose depth picker is already open (so update() doesn't reopen it). */
	private bombPickerFor: string | null = null;

	constructor(
		private readonly element: HTMLElement,
		private readonly deps: ExplodingBoardDeps,
	) {}

	update(gs: GameState): void {
		const firstBuild = !this.built;
		if (firstBuild) this.build();
		this.renderTable(gs);
		this.hand.update();
		if (firstBuild && document.activeElement === this.element) this.hand.focus();
		this.maybeOpenDefusePicker(gs);
	}

	focusHand(): void {
		this.hand.focus();
	}

	helpShortcuts(): HelpShortcut[] {
		const shortcuts = cardBoardHelpShortcuts(this.hand);
		shortcuts.push({ keys: 'c', descKey: 'game.help_cmd_exploding_top' });
		shortcuts.push({ keys: 'n', descKey: 'game.help_cmd_exploding_nope' });
		return shortcuts;
	}

	isAnimating(): boolean {
		return false;
	}

	/** Every RIVAL's status (Shift+S), each led by their name; mine is the plain S. */
	private allSeatsStatus(gs: GameState, myId: string): string | null {
		const lines = (gs.exploding?.seats ?? []).filter(seat => seat.playerId !== myId).map(seat => {
			const name = playerName(gs, seat.playerId);
			if (seat.retired) return `${name}: ${this.deps.tSync('game.status_retired')}`;
			const cards = seat.handCount === 1
				? this.deps.tSync('game.exploding_status_cards_one')
				: this.deps.tSync('game.exploding_status_cards', { count: seat.handCount });
			return `${name}: ${cards}`;
		});
		return lines.length > 0 ? lines.join('. ') : null;
	}

	// ── Construction ──────────────────────────────────────────────────────────

	private build(): void {
		resetCardBoard(this.element, 'exploding-mode');

		const bar = document.createElement('div');
		bar.className = 'exploding-toolbar';
		const rulesBtn = document.createElement('button');
		rulesBtn.type = 'button';
		rulesBtn.className = 'secondary-button exploding-rules-button';
		rulesBtn.textContent = this.deps.tSync('game.exploding_rules_button');
		rulesBtn.addEventListener('click', () => showGameRulesDialog(this.rulesSummary()));
		bar.appendChild(rulesBtn);
		this.element.appendChild(bar);

		const visual = document.createElement('div');
		visual.className = 'exploding-visual';
		visual.setAttribute('aria-hidden', 'true');
		this.table = document.createElement('div');
		this.table.className = 'exploding-table';
		visual.appendChild(this.table);
		this.element.appendChild(visual);

		const handMount = document.createElement('div');
		handMount.className = 'exploding-hand';
		this.element.appendChild(handMount);

		this.hand.init(handMount, {
			getCards: () => this.myHandCards(),
			canDraw: () => this.canDrawNow(),
			onDraw: () => this.deps.commands.draw(),
			onPlay: card => this.playCard(card),
			infoRows: () => this.infoRows(),
			playSound: event => soundEvents.playEvent(event),
			announce: text => this.deps.announce(text),
			t: (key, vars) => this.deps.tSync(key, vars),
			shortcutText: {
				play: 'game.help_cmd_exploding_play',
				draw: 'game.help_cmd_exploding_draw',
			},
		});

		registerStatusKeys(this.element, {
			getGameState: this.deps.getGameState,
			getMyPlayerId: this.deps.getMyPlayerId,
			announce: this.deps.announce,
			mine: (gs, myId) => explodingStatusText(gs, myId, this.deps.tSync),
			rivals: (gs, myId) => this.allSeatsStatus(gs, myId),
		});

		// C — the deck count and the discard top, on demand (shadows the engine's spatial key,
		// dead weight in a card game). Consumed so it never reaches the global keymap.
		this.element.addEventListener('keydown', (e) => {
			if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
			if (e.key.toLowerCase() !== 'c') return;
			e.preventDefault();
			e.stopPropagation();
			this.announceTop();
		});

		// N — the REACTION key: jump hand focus to a Nope card so I can Enter it during the
		// suspense window. Announces the miss when I hold none.
		this.element.addEventListener('keydown', (e) => {
			if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
			if (e.key.toLowerCase() !== 'n') return;
			e.preventDefault();
			e.stopPropagation();
			this.jumpToNope();
		});

		this.built = true;
	}

	private announceTop(): void {
		const gs = this.deps.getGameState();
		const ex = gs?.exploding;
		if (!ex) return;
		const top = topDef(gs!);
		this.deps.announce(this.deps.tSync('game.exploding_status_deck', {
			count: ex.drawCount,
			card: top ? this.deps.tSync(top.nameKey) : this.deps.tSync('game.exploding_no_top'),
		}));
	}

	/** Reaction key (N): move hand focus to a Nope card so the player can Enter it. */
	private jumpToNope(): void {
		const found = this.hand.focusNextMatching(c => c.typeKey === 'nope');
		if (!found) this.deps.announce(this.deps.tSync('game.exploding_no_nope'));
	}

	rulesSummary(): string[] {
		const r = this.deps.getGameState()?.explodingRules;
		if (!r) return [];
		return [
			this.deps.tSync('game.exploding_rules_hand', { count: r.handSize }),
			this.deps.tSync('game.exploding_rules_future', { count: r.seeFutureCount }),
			this.deps.tSync('game.exploding_rules_attack', { count: r.attackDraws }),
		];
	}

	// ── The hand ────────────────────────────────────────────────────────────────

	private myHandCards(): HandCard[] {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return [];
		const seat = explodingSeat(gs, myId);
		if (!seat) return [];
		const catalog = explodingCatalog(gs);

		return seat.hand.map(instance => {
			const def = catalog.get(instance.cardId);
			const play = canPlayCard(gs, myId, instance.instanceId);
			const label = def ? this.deps.tSync(def.nameKey) : instance.cardId;
			return {
				id: instance.instanceId,
				label,
				typeKey: def?.type ?? 'unknown',
				value: 0,
				playable: play.playable,
				unplayableReason: this.deps.tSync(play.reasonKey ?? 'game.hand_not_playable'),
				art: def ? explodingCardArtHtml(def, label) : undefined,
				help: explodingCardHelp(gs, instance.cardId, this.deps.tSync) ?? undefined,
			};
		});
	}

	private infoRows() {
		const gs = this.deps.getGameState();
		if (!gs?.exploding) return [];
		const top = topDef(gs);
		return [{
			id: '__table',
			label: this.deps.tSync('game.exploding_table_row', {
				draw: gs.exploding.drawCount ?? 0,
				card: top?.nameKey ?? 'game.exploding_no_top',
			}),
			art: explodingCardBackHtml(String(gs.exploding.drawCount ?? 0)),
		}];
	}

	private canDrawNow(): { ok: true } | { ok: false; reason: string } {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return { ok: false, reason: '' };
		const ex = gs.exploding;
		if (gs.isGameOver) return { ok: false, reason: this.deps.tSync('game.exploding_game_over') };
		if (gs.currentTurn !== myId) return { ok: false, reason: this.deps.tSync('game.exploding_not_your_turn') };
		if (ex?.pendingAction) return { ok: false, reason: this.deps.tSync('game.exploding_window_open') };
		if (ex?.pendingBomb) return { ok: false, reason: this.deps.tSync('game.exploding_resolve_bomb_first') };
		return { ok: true };
	}

	/** Enter on a card: give it (as a Favor's target), react with a Nope (off-turn), pick a
	 *  target for a Favor or a cat pair, or a plain on-turn action play. Only playable cards
	 *  reach here (the panel gates the rest). */
	private playCard(card: HandCard): void {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return;

		// As a Favor's target: Enter GIVES the focused card to the requester.
		if (gs.exploding?.pendingFavor?.targetId === myId) {
			this.deps.commands.give(card.id);
			return;
		}
		if (card.typeKey === 'nope') {
			this.deps.commands.nope(card.id);
			return;
		}
		if (card.typeKey === 'favor') {
			this.openTargetPicker(card, null);
			return;
		}
		if (card.typeKey === 'cat') {
			const partner = catPairPartner(gs, myId, card.id);
			if (partner) this.openTargetPicker(card, partner);
			return;
		}
		this.deps.commands.play(card.id);
	}

	/** Pick the victim of a Favor or a cat steal: a popupMenu of the seats still in play. */
	private openTargetPicker(card: HandCard, second: string | null): void {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return;
		const rivals = (gs.exploding?.seats ?? []).filter(s => s.playerId !== myId && !s.retired);
		if (rivals.length === 0) return;
		const prompt = this.deps.tSync(
			second ? 'game.exploding_pick_target_pair' : 'game.exploding_pick_target',
			{ card: card.label },
		);
		popupMenu.open({
			ariaLabel: prompt,
			openAnnouncement: prompt,
			anchor: document.activeElement instanceof HTMLElement ? document.activeElement : null,
			items: rivals.map(seat => ({
				label: playerName(gs, seat.playerId),
				onSelect: () => this.deps.commands.play(card.id, seat.playerId, second ?? undefined),
			})),
			announce: text => this.deps.announce(text),
			onClose: () => this.hand.focus(),
			onCancel: () => this.deps.announce(this.deps.tSync('game.pick_cancelled')),
		});
	}

	/** When I have just drawn a bomb (and hold a defuse), open the depth picker: where does it
	 *  go back? Top, middle, bottom. Opened once per pending bomb. */
	private maybeOpenDefusePicker(gs: GameState): void {
		const myId = this.deps.getMyPlayerId();
		const bomb = gs.exploding?.pendingBomb;
		if (!myId || !bomb || bomb.playerId !== myId) {
			this.bombPickerFor = null;
			return;
		}
		if (this.bombPickerFor === bomb.instanceId) return; // already asking
		this.bombPickerFor = bomb.instanceId;

		const drawCount = gs.exploding?.drawCount ?? 0;
		const middle = Math.floor(drawCount / 2);
		popupMenu.open({
			ariaLabel: this.deps.tSync('game.exploding_pick_depth'),
			openAnnouncement: this.deps.tSync('game.exploding_pick_depth'),
			anchor: document.activeElement instanceof HTMLElement ? document.activeElement : null,
			items: [
				{ label: this.deps.tSync('game.exploding_depth_top'), onSelect: () => this.deps.commands.defuse(0) },
				{ label: this.deps.tSync('game.exploding_depth_middle'), onSelect: () => this.deps.commands.defuse(middle) },
				{ label: this.deps.tSync('game.exploding_depth_bottom'), onSelect: () => this.deps.commands.defuse(drawCount) },
			],
			announce: text => this.deps.announce(text),
			onClose: () => this.hand.focus(),
			// A cancelled pick defaults to the top (the bomb must go somewhere — the turn is mid-resolve).
			onCancel: () => this.deps.commands.defuse(0),
		});
	}

	// ── Visual echoes (aria-hidden) ───────────────────────────────────────────

	private renderTable(gs: GameState): void {
		const exploding = gs.exploding;
		if (!exploding) return;
		const top = topDef(gs);
		const topFace = top
			? explodingCardArtHtml(top, this.deps.tSync(top.nameKey))
			: explodingEmptyCardHtml();
		const catalog = explodingCatalog(gs);
		const revealedBomb = exploding.pendingBomb
			? catalog.get(exploding.pendingBomb.cardId) ?? null
			: null;
		const bombFace = revealedBomb
			? `<div class="exploding-reveal">${explodingCardArtHtml(
				revealedBomb, this.deps.tSync(revealedBomb.nameKey),
			)}</div>`
			: '';
		const pending = exploding.pendingAction ? ' exploding-discard--pending' : '';

		const rivals = exploding.seats.map(seat => {
			const player = gs.players.find(p => p.id === seat.playerId);
			const rawColor = player?.color ?? '#888';
			const color = escapeHtml(rawColor);
			const ink = contrastingTextColor(rawColor);
			const name = escapeHtml(player?.name ?? seat.playerId);
			const turn = gs.currentTurn === seat.playerId ? ' exploding-seat--turn' : '';
			const dead = seat.retired ? ' exploding-seat--exploded' : '';
			const cards = seat.retired ? '💥' : `🂠 ${seat.handCount}`;
			return `<div class="exploding-seat${turn}${dead}" style="--seat-color:${color};--seat-ink:${ink}">`
				+ `<span class="exploding-seat__name">${name}</span>`
				+ `<span class="exploding-seat__cards">${cards}</span>`
				+ `</div>`;
		}).join('');

		// The table centre: the discard's top card as a card face, beside the draw pile — the
		// tense heart of the game (a bomb lurks in it) — as a danger-tinged card-back stack. All
		// aria-hidden; the C key, the panel and the announcer speak the same.
		this.table.innerHTML =
			`<div class="exploding-piles">`
			+ `<div class="exploding-discard${pending}">${topFace}</div>`
			+ `<div class="exploding-draw">${explodingCardBackHtml(String(exploding.drawCount))}</div>`
			+ bombFace
			+ `</div>`
			+ `<div class="exploding-seats">${rivals}</div>`;
	}
}
