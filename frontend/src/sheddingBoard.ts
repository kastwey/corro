// sheddingBoard.ts — The shedding family's surface. Like the other card
// families: NO spatial board — the HAND PANEL is the home surface. Enter plays (wilds
// walk a colour picker), Space draws — and, mid drawn-card pause, Space KEEPS the card
// while Enter plays it. Everything visual (the top of the discards with its colour
// band, the direction arrow, the rival counters) is an aria-hidden echo for sighted
// players; the same story speaks through sheddingStatusText (S / Shift+S / the players
// panel). There is deliberately NO one-card-left shout: counts are on-demand.

import { HandPanel, type HandCard, type HandSorting } from './handPanel.js';
import { genericCardArtHtml, genericCardBackHtml, genericEmptyCardHtml } from './cardArt.js';
import { popupMenu } from './popupMenu.js';
import { escapeHtml } from './escapeHtml.js';
import { contrastingTextColor } from './colorContrast.js';
import {
	canPlayCard, deckColors, sheddingCardHelp, sheddingCatalog, sheddingScoreText, sheddingSeat,
	sheddingStatusText, sheddingWatchText, topDef,
} from './sheddingRules.js';
import { soundEvents } from './soundEvents.js';
import {
	cardBoardHelpShortcuts, playerName, registerPileStatusKey, registerStatusKeys, resetCardBoard,
} from './cardBoardShell.js';
import { showGameRulesDialog } from './gameRulesDialog.js';
import { buildSheddingRulesLines } from './rulesSummaries.js';
import type { GameState } from './models.js';
import type { HelpShortcut } from './shortcuts.js';

/** Where each action card sits once the numbers run out. The family's own types (models.ts),
 *  never a package's cards, so themed decks inherit the order for free.
 *  Reported from play: with every action weighing the same, a hand held two draw-twos that
 *  never met — they landed wherever the deal had left them, and no sort could bring them
 *  together. Ordering them by their bite (lose a turn < turn around < draw two) puts the
 *  colourless pair last, where the hand ends. */
const SHEDDING_ACTION_RANK: Readonly<Record<string, number>> = {
	skip: 1, reverse: 2, drawTwo: 3, wild: 4, wildDrawFour: 5,
};

/** One learnable figure per card: its own number, or ten-and-up by action rank. The panel's
 *  generic weight calls every action a 10, which is why they used to tie. */
const sheddingWeight = (card: HandCard): number =>
	card.typeKey === 'number' ? card.value : 10 + (SHEDDING_ACTION_RANK[card.typeKey] ?? 0);

/** Shift+<letter> → the ordering it selects. C for colour and O for the original deal order
 *  read the same in both languages; Shift+N is not here because it alternates rather than
 *  selecting (see the keydown handler). */
const SORT_KEYS: Readonly<Record<string, string>> = { c: 'colour', o: 'hand' };

/** Cuatro Colores answers two questions, so it offers two axes and drops the generic
 *  "by type": with actions ranked, ordering by value ALREADY groups every draw two with
 *  every draw two, whatever their colours. Ids match the generic ones so the wording and a
 *  player's saved choice both carry over. */
const SHEDDING_HAND_SORTING: HandSorting = {
	preferenceScope: 'shedding',
	defaultId: 'value',
	options: [
		{
			id: 'value',
			labelKey: 'game.hand_sort_by_value',
			announcementKey: 'game.hand_sorted_value',
			compare: (a, b) => sheddingWeight(b) - sheddingWeight(a),
		},
		{
			id: 'valueAsc',
			labelKey: 'game.hand_sort_by_value_asc',
			announcementKey: 'game.hand_sorted_valueAsc',
			compare: (a, b) => sheddingWeight(a) - sheddingWeight(b),
		},
		{
			// Numbers first and in order, then the actions — a colour reads as a small hand of
			// its own. Wilds carry no colour, so they pool at the end.
			id: 'colour',
			labelKey: 'game.hand_sort_by_colour',
			announcementKey: 'game.hand_sorted_colour',
			compare: (a, b) => (a.colourOrder ?? Number.MAX_SAFE_INTEGER) - (b.colourOrder ?? Number.MAX_SAFE_INTEGER)
				|| sheddingWeight(a) - sheddingWeight(b),
		},
		{
			id: 'hand',
			labelKey: 'game.hand_sort_hand',
			announcementKey: 'game.hand_sorted_hand',
			compare: () => 0,
		},
	],
};

export interface SheddingBoardDeps {
	getGameState: () => GameState | null;
	getMyPlayerId: () => string | null;
	announce: (text: string) => void;
	tSync: (key: string, vars?: Record<string, unknown>) => string;
	onIdle: () => void;
	motionDisabled: () => boolean;
	commands: {
		play: (instanceId: string, chosenColor?: string | null, extraInstanceIds?: string[] | null) => void;
		draw: () => void;
		keep: () => void;
		/** Declare the last card (optional house rule). */
		declareLastCard: () => void;
		/** Catch a rival who forgot the last-card declaration. */
		catchLastCard: () => void;
	};
}

/** Visual band hexes for the classic colour ids (packages beyond them fall back to
 *  gray — the spoken colour name carries the meaning either way). */
const COLOR_BANDS: Record<string, string> = {
	red: '#e53935', rojo: '#e53935',
	yellow: '#fdd835', amarillo: '#fdd835',
	green: '#43a047', verde: '#43a047',
	blue: '#1e88e5', azul: '#1e88e5',
};

/** Colour-jump keys: the four classic colours by SIGHT → their band hex. The letters are the
 *  ENGLISH colour names (r/g/b/y) even when the deck's colour ids are localized (rojo/verde/…),
 *  because we match through COLOR_BANDS, which canonicalizes both languages to the same hex. */
const COLOUR_JUMP_KEYS: Record<string, string> = {
	r: '#e53935', g: '#43a047', b: '#1e88e5', y: '#fdd835',
};

export class SheddingBoard {
	private built = false;
	private readonly hand = new HandPanel();
	private table!: HTMLElement;

	constructor(
		private readonly element: HTMLElement,
		private readonly deps: SheddingBoardDeps,
	) {}

	/** Repaint everything from a fresh state (builds the surface on first call). */
	update(gs: GameState): void {
		const firstBuild = !this.built;
		if (firstBuild) this.build();
		this.renderTable(gs);
		this.hand.update();
		if (firstBuild && document.activeElement === this.element) this.hand.focus();
	}

	/** The hand is this family's home surface: board focus lands here. */
	focusHand(): void {
		this.hand.focus();
	}

	/** The hand keys (Enter/Space, + Ctrl+Space when doubles are on) and the shared S /
	 *  Shift+S status keys, plus the last-card keys (U/P/V) when that rule is on. (The
	 *  active-rules dialog is the global Ctrl+Shift+F1 command.) */
	helpShortcuts(): HelpShortcut[] {
		const shortcuts = cardBoardHelpShortcuts(this.hand, 'game.help_cmd_shedding_piles');
		shortcuts.push({ keys: 'c', descKey: 'game.help_cmd_shedding_top' });
		shortcuts.push({ keys: 'r / g / b / y', descKey: 'game.help_cmd_shedding_colour_jump' });
		shortcuts.push({ keys: 'shift + r / g / b / y', descKey: 'game.help_cmd_shedding_colour_jump_back' });
		shortcuts.push({ keys: '0 – 9', descKey: 'game.help_cmd_shedding_number_jump' });
		shortcuts.push({ keys: 'shift + 0 – 9', descKey: 'game.help_cmd_shedding_number_jump_back' });
		shortcuts.push({ keys: 'i', descKey: 'game.help_cmd_shedding_special_jump' });
		shortcuts.push({ keys: 'shift + i', descKey: 'game.help_cmd_shedding_special_jump_back' });
		shortcuts.push({ keys: 'shift + n', descKey: 'game.help_cmd_shedding_sort_flip' });
		shortcuts.push({ keys: 'shift + c', descKey: 'game.help_cmd_shedding_sort_colour' });
		shortcuts.push({ keys: 'shift + o', descKey: 'game.help_cmd_shedding_sort_hand' });
		if (this.deps.getGameState()?.sheddingRules?.lastCardCall) {
			shortcuts.push(
				{ keys: 'u', descKey: 'game.help_cmd_last_card_declare' },
				{ keys: 'p', descKey: 'game.help_cmd_last_card_catch' },
				{ keys: 'v', descKey: 'game.help_cmd_last_card_watch' },
			);
		}
		return shortcuts;
	}

	/** No piece animation in this family (plays land instantly). */
	isAnimating(): boolean {
		return false;
	}

	/** Every RIVAL's status (Shift+S), each led by their name — the on-demand "who is
	 *  running short?" that replaces the classic shout. Mine is the plain S. */
	private allSeatsStatus(gs: GameState, myId: string): string | null {
		const lines = (gs.shedding?.seats ?? []).filter(seat => seat.playerId !== myId).map(seat => {
			const name = playerName(gs, seat.playerId);
			if (seat.retired) return `${name}: ${this.deps.tSync('game.status_retired')}`;
			const cards = seat.handCount === 1
				? this.deps.tSync('game.shedding_status_cards_one')
				: this.deps.tSync('game.shedding_status_cards', { count: seat.handCount });
			const score = sheddingScoreText(gs, seat.score, this.deps.tSync);
			return `${name}: ${cards}, ${score}`;
		});
		return lines.length > 0 ? lines.join('. ') : null;
	}

	// ── Construction ──────────────────────────────────────────────────────────

	private build(): void {
		resetCardBoard(this.element, 'shedding-mode');

		// A visible "active rules" button — the pointer twin of the Ctrl+Shift+F1 command:
		// both open the same reading dialog, so a sighted player can glance at the rules.
		const bar = document.createElement('div');
		bar.className = 'shedding-toolbar';
		const rulesBtn = document.createElement('button');
		rulesBtn.type = 'button';
		rulesBtn.className = 'secondary-button shedding-rules-button';
		rulesBtn.textContent = this.deps.tSync('game.shedding_rules_button');
		rulesBtn.addEventListener('click', () => showGameRulesDialog(this.rulesSummary()));
		bar.appendChild(rulesBtn);

		// Last-card house rule: visible twins of the U / P / V keys — declare, catch a
		// rival who forgot, and read the "watch list" of rivals about to win. The pointer twin
		// for a sighted player; the keyboard does the same. Only when the rule is on.
		const lastCardCall = this.deps.getGameState()?.sheddingRules?.lastCardCall ?? false;
		if (lastCardCall) {
			const addBtn = (cls: string, labelKey: string, run: () => void) => {
				const b = document.createElement('button');
				b.type = 'button';
				b.className = `secondary-button ${cls}`;
				b.textContent = this.deps.tSync(labelKey);
				b.addEventListener('click', run);
				bar.appendChild(b);
			};
			addBtn('shedding-last-card-button', 'game.shedding_last_card_button', () => this.deps.commands.declareLastCard());
			addBtn('shedding-catch-button', 'game.shedding_catch_button', () => this.deps.commands.catchLastCard());
			addBtn('shedding-watch-button', 'game.shedding_watch_button', () => this.announceWatch());
		}
		this.element.appendChild(bar);

		// Visual-only region: the table (top card, colour, direction, rival counters).
		const visual = document.createElement('div');
		visual.className = 'shedding-visual';
		visual.setAttribute('aria-hidden', 'true');
		this.table = document.createElement('div');
		this.table.className = 'shedding-table';
		visual.appendChild(this.table);
		this.element.appendChild(visual);

		const handMount = document.createElement('div');
		handMount.className = 'shedding-hand';
		this.element.appendChild(handMount);

		// Doubles (house rule): the hand opts into multi-select so identical number cards can
		// be marked (Ctrl+Space) and played together. Off = the plain one-card hand.
		const doubles = this.deps.getGameState()?.sheddingRules?.allowDoubles ?? false;

		this.hand.init(handMount, {
			getCards: () => this.myHandCards(),
			sorting: SHEDDING_HAND_SORTING,
			// Space: draw — or, mid drawn-card pause, KEEP the card and pass. The gate
			// words the refusal; the panel never disables anything.
			canDraw: () => this.canDrawNow(),
			onDraw: () => this.drawOrKeep(),
			onPlay: card => this.playCard(card),
			// No discards in this genre (no onDiscard: the affordance disappears).
			playSound: event => soundEvents.playEvent(event),
			announce: text => this.deps.announce(text),
			t: (key, vars) => this.deps.tSync(key, vars),
			...(doubles ? {
				multiSelect: {
					validate: cards => this.validateDoubles(cards),
					submit: cards => this.submitDoubles(cards),
				},
			} : {}),
			// Enter plays; Space draws — or, mid drawn-card pause, keeps and passes;
			// Ctrl+Space marks identical cards to play them together (doubles).
			shortcutText: {
				play: 'game.help_cmd_play_card',
				draw: 'game.help_cmd_shedding_draw',
				...(doubles ? { multiSelect: 'game.help_cmd_doubles' } : {}),
			},
		});

		// S — "how am I doing?"; Shift+S — the rivals' counts and scores, on demand.
		registerStatusKeys(this.element, {
			getGameState: this.deps.getGameState,
			getMyPlayerId: this.deps.getMyPlayerId,
			announce: this.deps.announce,
			mine: (gs, myId) => sheddingStatusText(gs, myId, this.deps.tSync),
			rivals: (gs, myId) => this.allSeatsStatus(gs, myId),
		});
		registerPileStatusKey(this.element, {
			announce: this.deps.announce,
			read: () => this.pileStatusText(),
		});
		// C — just the card on the table and the colour in force. D says the same plus the deck
		// count, and in a game this fast the count is a preamble you sit through on every check.
		// C is free here: the engine's own "how am I doing?" (AnnounceMyStatus) repeated S word
		// for word in a card family, so it is hidden from the shortcuts help AND inert in this
		// family (keys.ts) — the letter means one thing, wherever focus happens to be.
		registerPileStatusKey(this.element, {
			key: 'c',
			announce: this.deps.announce,
			read: () => this.topCardText(),
		});

		// R / G / B / Y — jump the hand focus to the NEXT card of that colour (wrapping);
		// Shift+ the same walks to the PREVIOUS one (like S / Shift+S). The classic-colour
		// navigation of a spatial board, brought to the hand: find your reds without arrowing
		// past everything. Consumed so they never reach the global keymap.
		this.element.addEventListener('keydown', (e) => {
			if (e.ctrlKey || e.altKey || e.metaKey) return;
			const hex = COLOUR_JUMP_KEYS[e.key.toLowerCase()];
			if (!hex) return;
			e.preventDefault();
			e.stopPropagation();
			this.jumpToColour(hex, e.shiftKey);
		});

		// 0–9 — jump to the NEXT card with that number; I — the next SPECIAL (non-number)
		// card. Shift+ the same walks BACKWARD. Digits read from e.code (Digit5/Numpad5), not
		// e.key, so Shift+5 doesn't arrive as "%" on some layouts. I is the engine's spatial
		// key (WhoIsOnSquare) — dead in a card game, so we shadow it here. Consumed either way.
		this.element.addEventListener('keydown', (e) => {
			if (e.ctrlKey || e.altKey || e.metaKey) return;
			const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
			if (digit) {
				const n = Number(digit[1]);
				e.preventDefault();
				e.stopPropagation();
				this.jumpBy(c => c.typeKey === 'number' && c.value === n, e.shiftKey,
					'game.shedding_no_number_cards', { number: n });
			} else if (e.key.toLowerCase() === 'i') {
				e.preventDefault();
				e.stopPropagation();
				this.jumpBy(c => c.typeKey !== 'number', e.shiftKey, 'game.shedding_no_special_cards');
			}
		});

		// Reordering the hand without walking into the Shift+F10 menu: Shift+N flips the two
		// value ends (which one you want changes with the hand you hold), Shift+C groups by
		// colour, Shift+O returns to the order the cards arrived in. The engine binds all three
		// chords to its property/board commands, which a card family has no board for — they are
		// inert here and already hidden from this family's help, so the letters are free
		// (exploding shadows plain N the same way).
		this.element.addEventListener('keydown', (e) => {
			if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
			// Shift+N alternates rather than picking a side: from colour or deal order it enters
			// at the default end, so one more press always walks back out.
			const wanted = e.key.toLowerCase() === 'n'
				? (this.hand.currentSort() === 'value' ? 'valueAsc' : 'value')
				: SORT_KEYS[e.key.toLowerCase()];
			if (!wanted) return;
			e.preventDefault();
			e.stopPropagation();
			this.hand.applySort(wanted);
		});

		// Last-card keys (house rule): U declares, P catches a rival who forgot, V reads the
		// watch list. Plain letters, no modifiers, consumed so they never reach the board layer.
		if (lastCardCall) {
			this.element.addEventListener('keydown', (e) => {
				if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
				const k = e.key.toLowerCase();
				if (k !== 'u' && k !== 'p' && k !== 'v') return;
				e.preventDefault();
				e.stopPropagation();
				if (k === 'u') this.deps.commands.declareLastCard();
				else if (k === 'p') this.deps.commands.catchLastCard();
				else this.announceWatch();
			});
		}

		this.built = true;
	}

	/** Speak the watch list (V / the Watch button): rivals about to win, exposed ones flagged. */
	private announceWatch(): void {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return;
		this.deps.announce(sheddingWatchText(gs, myId, this.deps.tSync));
	}

	/**
	 * The C readout: what is on the table, and — only when it differs — what colour is in force.
	 * The two can only disagree after a wild, so naming the colour every time would repeat the
	 * card's own colour on almost every check, dozens of times a game. When they disagree the
	 * colour is the ONLY thing that says what may be played, so it is never dropped there.
	 */
	private topCardText(): string | null {
		const gs = this.deps.getGameState();
		if (!gs?.shedding) return null;
		const top = topDef(gs);
		const inForce = gs.shedding.currentColor;
		if (top && top.color === inForce) {
			return this.deps.tSync('game.shedding_top_readout_plain', { card: top.nameKey });
		}
		return this.deps.tSync('game.shedding_top_readout', {
			card: top?.nameKey ?? 'game.shedding_no_top',
			color: `colors.${inForce}`,
		});
	}

	/** D reads the table state that is visual but deliberately absent from the hand. */
	private pileStatusText(): string | null {
		const gs = this.deps.getGameState();
		if (!gs?.shedding) return null;
		const top = topDef(gs);
		return this.deps.tSync('game.shedding_status_piles', {
			draw: gs.shedding.drawCount ?? 0,
			card: top?.nameKey ?? 'game.shedding_no_top',
			color: `colors.${gs.shedding.currentColor}`,
		});
	}

	/** The deck's colours ranked by their NAME in the current language — so "sort by colour"
	 *  groups them the way the player reads/hears them (alphabetical), not in raw deck order.
	 *  Shared by the hand's colourOrder and the R/G/B/Y jump so the two can never disagree. */
	private orderedColours(gs: GameState): string[] {
		return deckColors(gs).slice().sort((a, b) =>
			this.deps.tSync(`colors.${a}`).localeCompare(this.deps.tSync(`colors.${b}`)));
	}

	/** Move hand focus to the next card whose colour band is `hex` (R/G/B/Y), or the PREVIOUS
	 *  one when `backward` (Shift+). Cards carry a colourOrder = their rank in orderedColours,
	 *  so we resolve the hex to those ranks (both languages' ids canonicalize to the same band)
	 *  and hand the panel a predicate. Landing reads the card; an empty search says so, named
	 *  by the colour. */
	private jumpToColour(hex: string, backward = false): void {
		const gs = this.deps.getGameState();
		if (!gs) return;
		const order = this.orderedColours(gs); // same ranking that produced each card's colourOrder
		const wanted = new Set(order.map((id, i) => ({ id, i })).filter(x => COLOR_BANDS[x.id] === hex).map(x => x.i));
		if (wanted.size === 0) return; // this deck has no such colour — the key is simply inert
		const found = this.hand.focusNextMatching(c => c.colourOrder !== undefined && wanted.has(c.colourOrder), backward);
		if (!found) {
			const id = order.find(cid => COLOR_BANDS[cid] === hex)!;
			this.deps.announce(this.deps.tSync('game.shedding_no_colour_cards', { color: `colors.${id}` }));
		}
	}

	/** Move hand focus to the next (or PREVIOUS, when `backward`) card matching `pred`; an empty
	 *  search speaks `missKey`. Backs the number keys (0–9) and I (specials). */
	private jumpBy(pred: (c: HandCard) => boolean, backward: boolean,
		missKey: string, vars?: Record<string, unknown>): void {
		if (!this.hand.focusNextMatching(pred, backward)) this.deps.announce(this.deps.tSync(missKey, vars));
	}

	/** Doubles: the marked set must be identical number cards, the lead one playable. */
	private validateDoubles(cards: HandCard[]): { ok: true } | { ok: false; reason: string } {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return { ok: false, reason: '' };
		if (gs.currentTurn !== myId) return { ok: false, reason: this.deps.tSync('game.shedding_not_your_turn') };
		const seat = sheddingSeat(gs, myId);
		const catalog = sheddingCatalog(gs);
		const defs = cards.map(c => {
			const inst = seat?.hand.find(h => h.instanceId === c.id);
			return inst ? catalog.get(inst.cardId) : null;
		});
		if (defs.some(d => d?.type !== 'number'))
			return { ok: false, reason: this.deps.tSync('game.shedding_doubles_numbers_only') };
		const leadInst = seat?.hand.find(h => h.instanceId === cards[0].id);
		if (defs.some(d => d?.id !== defs[0]?.id))
			return { ok: false, reason: this.deps.tSync('game.shedding_doubles_not_identical') };
		const lead = leadInst ? canPlayCard(gs, myId, leadInst.instanceId) : { playable: false };
		if (!lead.playable)
			return { ok: false, reason: this.deps.tSync(lead.reasonKey ?? 'game.shedding_not_playable') };
		return { ok: true };
	}

	/** Doubles: play the lead card carrying the rest as identical copies. */
	private submitDoubles(cards: HandCard[]): void {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId || !this.canActNow(gs, myId) || cards.length === 0) return;
		const [lead, ...rest] = cards;
		this.deps.commands.play(lead.id, null, rest.map(c => c.id));
	}

	/** The active rules as readable lines, for the rules dialog (Ctrl+Shift+F1 / the button). */
	rulesSummary(): string[] {
		return buildSheddingRulesLines(this.deps.getGameState()?.sheddingRules, this.deps.tSync);
	}

	// ── The hand ──────────────────────────────────────────────────────────────

	private myHandCards(): HandCard[] {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return [];
		const seat = sheddingSeat(gs, myId);
		if (!seat) return [];
		const catalog = sheddingCatalog(gs);
		// Colour rank for "sort by colour" = the card's place in the colours ranked by their
		// NAME in the current language (wilds carry no colour → undefined → they pool last).
		const colourRank = this.orderedColours(gs);

		return seat.hand.map(instance => {
			const def = catalog.get(instance.cardId);
			const play = canPlayCard(gs, myId, instance.instanceId);
			const label = def ? this.deps.tSync(def.nameKey) : instance.cardId;
			const drawn = gs.shedding?.pendingDrawnPlay?.instanceId === instance.instanceId;
			const ci = def?.color ? colourRank.indexOf(def.color) : -1;
			return {
				id: instance.instanceId,
				cardId: instance.cardId,
				// The just-drawn card announces itself: it is the one the pause is about.
				label: drawn ? this.deps.tSync('game.shedding_card_drawn', { card: label }) : label,
				typeKey: def?.type ?? 'unknown',
				value: def ? (def.type === 'number' ? def.value ?? 0 : 10) : 0,
				colourOrder: ci >= 0 ? ci : undefined,
				playable: play.playable,
				unplayableReason: this.deps.tSync(play.reasonKey ?? 'game.hand_not_playable'),
				art: def ? genericCardArtHtml(def, label) : undefined,
				help: sheddingCardHelp(gs, instance.cardId, this.deps.tSync) ?? undefined,
			};
		});
	}

	/** Turn gate shared by play and draw: spoken, never silently swallowed. */
	private canActNow(gs: GameState, myId: string): boolean {
		if (gs.isGameOver) {
			this.deps.announce(this.deps.tSync('game.shedding_game_over'));
			return false;
		}
		if (gs.currentTurn !== myId) {
			this.deps.announce(this.deps.tSync('game.shedding_not_your_turn'));
			return false;
		}
		return true;
	}

	private canDrawNow(): { ok: true } | { ok: false; reason: string } {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return { ok: false, reason: '' };
		if (gs.isGameOver) return { ok: false, reason: this.deps.tSync('game.shedding_game_over') };
		if (gs.currentTurn !== myId) return { ok: false, reason: this.deps.tSync('game.shedding_not_your_turn') };
		return { ok: true };
	}

	/** Space: draw — or resolve the drawn-card pause by KEEPING the card. */
	private drawOrKeep(): void {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return;
		if (gs.shedding?.pendingDrawnPlay?.playerId === myId) {
			this.deps.commands.keep();
			return;
		}
		this.deps.commands.draw();
	}

	/** Enter on a card: wilds walk the colour picker, everything else plays straight. */
	private playCard(card: HandCard): void {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId || !this.canActNow(gs, myId)) return;
		const seat = sheddingSeat(gs, myId);
		const instance = seat?.hand.find(c => c.instanceId === card.id);
		const def = instance ? sheddingCatalog(gs).get(instance.cardId) : null;
		if (!def) return;

		if (def.type !== 'wild' && def.type !== 'wildDrawFour') {
			this.deps.commands.play(card.id);
			return;
		}

		const colors = deckColors(gs);
		popupMenu.open({
			ariaLabel: this.deps.tSync('game.shedding_pick_color', { card: card.label }),
			openAnnouncement: this.deps.tSync('game.shedding_pick_color', { card: card.label }),
			anchor: document.activeElement instanceof HTMLElement ? document.activeElement : null,
			items: colors.map(color => ({
				label: this.deps.tSync(`colors.${color}`),
				onSelect: () => this.deps.commands.play(card.id, color),
			})),
			announce: text => this.deps.announce(text),
			onClose: () => this.hand.focus(),
			// Escape/Tab aborts the play (the card stays in hand): say so.
			onCancel: () => this.deps.announce(this.deps.tSync('game.pick_cancelled')),
		});
	}

	// ── Visual echoes (aria-hidden) ───────────────────────────────────────────

	private renderTable(gs: GameState): void {
		const shedding = gs.shedding;
		if (!shedding) return;
		const top = topDef(gs);
		const band = COLOR_BANDS[shedding.currentColor] ?? '#9e9e9e';
		const topFace = top
			? genericCardArtHtml(top, this.deps.tSync(top.nameKey))
			: genericEmptyCardHtml();
		const colorWord = escapeHtml(this.deps.tSync(`colors.${shedding.currentColor}`));
		const arrow = shedding.direction === 1 ? '↻' : '↺';

		const rivals = shedding.seats.map(seat => {
			const player = gs.players.find(p => p.id === seat.playerId);
			const rawColor = player?.color ?? '#888';
			const color = escapeHtml(rawColor);
			const ink = contrastingTextColor(rawColor);
			const name = escapeHtml(player?.name ?? seat.playerId);
			const turn = gs.currentTurn === seat.playerId ? ' shedding-seat--turn' : '';
			const retired = seat.retired ? ' shedding-seat--retired' : '';
			return `<div class="shedding-seat${turn}${retired}" data-player-id="${escapeHtml(seat.playerId)}" style="--seat-color:${color};--seat-ink:${ink}">`
				+ `<span class="shedding-seat__name">${name}</span>`
				+ `<span class="shedding-seat__cards">🂠 ${seat.handCount}</span>`
				+ `<span class="shedding-seat__score">${seat.score}</span>`
				+ `</div>`;
		}).join('');

		// The table centre: the discards' top card as a real card tile in the colour in force (a
		// couple of offset layers behind read it as a pile), the play direction, and the draw pile
		// as a card-back stack. All aria-hidden — D speaks the same state on demand.
		this.table.innerHTML =
			`<div class="shedding-piles">`
			+ `<div class="shedding-discard" style="--in-force:${band};--in-force-ink:${contrastingTextColor(band)}">`
			+   topFace
			+   `<span class="shedding-discard__color">${colorWord}</span>`
			+ `</div>`
			+ `<div class="shedding-direction">${arrow}</div>`
			+ `<div class="shedding-draw">${genericCardBackHtml(String(shedding.drawCount))}</div>`
			+ `</div>`
			+ `<div class="shedding-seats">${rivals}</div>`;
	}
}
