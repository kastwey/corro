// draftBoard.ts — The draft family's surface (simultaneous pick-and-pass genre). Like the
// other card families: NO spatial board — the HAND PANEL is the home surface (Enter
// commits the secret pick, and pressing it again on another card CHANGES the pick while
// the table is still deciding), and everything visual (each seat's table, scores,
// dessert stashes, who has picked) is an aria-hidden echo for sighted players. The public
// story a blind player needs speaks through draftStatusText: the players-panel identity
// line per player, the S key for my own, Shift+S for the rivals.

import { HandPanel, type HandCard } from './handPanel.js';
import { cardArtSvg, genericCardArtHtml, genericCardBackHtml } from './cardArt.js';
import { escapeHtml } from './escapeHtml.js';
import { contrastingTextColor } from './colorContrast.js';
import {
	draftCardHelp, draftCatalog, draftHandSize, draftSeat, draftStatusText, hasUnspentExtra,
} from './draftRules.js';
import { soundEvents } from './soundEvents.js';
import {
	cardBoardHelpShortcuts, playerName, registerPileStatusKey, registerStatusKeys, resetCardBoard,
} from './cardBoardShell.js';
import { buildDraftRulesLines } from './rulesSummaries.js';
import type { DraftCardDef, DraftSeatState, GameState } from './models.js';
import type { HelpShortcut } from './shortcuts.js';

export interface DraftBoardDeps {
	getGameState(): GameState | null;
	getMyPlayerId(): string | null;
	announce(text: string): void;
	tSync(key: string, vars?: Record<string, unknown>): string;
	onIdle(): void;
	motionDisabled(): boolean;
	commands: {
		/** Commit the secret pick; the second card rides an "extra" on my table. */
		pick(instanceId: string, secondInstanceId?: string | null): void;
	};
}

/** Each generic scoring type (shared by every draft package) gets a colour, so a seat's tableau
 *  reads as a row of coloured cards grouped by how they score — not a text list. */
const DRAFT_TYPE_COLOR: Record<string, string> = {
	points: '#2f9e5f', multiplier: '#8e24aa', set: '#d97a2b',
	scale: '#1e88e5', majority: '#d24d86', dessert: '#c9a227', extra: '#00897b',
};

export class DraftBoard {
	private built = false;
	private readonly hand = new HandPanel();
	private piles!: HTMLElement;
	private tables!: HTMLElement;
	/** Table sizes per seat at the previous render, to flash a table that just grew. */
	private readonly lastTableSizes = new Map<string, number>();

	constructor(
		private readonly element: HTMLElement,
		private readonly deps: DraftBoardDeps,
	) {}

	/** Repaint everything from a fresh state (builds the surface on first call). */
	update(gs: GameState): void {
		const firstBuild = !this.built;
		if (firstBuild) this.build();
		this.renderPiles(gs);
		this.renderTables(gs);
		this.hand.update();
		if (firstBuild && document.activeElement === this.element) this.hand.focus();
	}

	/** The hand is this family's home surface: board focus lands here. */
	focusHand(): void {
		this.hand.focus();
	}

	/** The hand keys + shared player status and D pile query, for the help. */
	helpShortcuts(): HelpShortcut[] {
		return cardBoardHelpShortcuts(this.hand, 'game.help_cmd_draft_deck');
	}

	/** The active rules for the rules dialog (Ctrl+Shift+F1). */
	rulesSummary(): string[] {
		return buildDraftRulesLines(this.deps.getGameState()?.draftRules, this.deps.tSync);
	}

	/** No piece animation in this family (reveals land instantly). */
	isAnimating(): boolean {
		return false;
	}

	/** Every RIVAL's status (Shift+S), each led by their name. My own is the plain S. */
	private allSeatsStatus(gs: GameState, myId: string): string | null {
		const lines = (gs.draft?.seats ?? []).filter(seat => seat.playerId !== myId).map(seat => {
			const status = draftStatusText(gs, seat.playerId, this.deps.tSync);
			if (!status) return null;
			return `${playerName(gs, seat.playerId)}: ${status}`;
		}).filter((s): s is string => !!s);
		return lines.length > 0 ? lines.join('. ') : null;
	}

	// ── Construction ──────────────────────────────────────────────────────────

	private build(): void {
		resetCardBoard(this.element, 'draft-mode');

		// Visual-only region: the shared deck and player tables. Everything here is spoken
		// elsewhere (D, per-player status lines, S and the server's reveal voice).
		const visual = document.createElement('div');
		visual.className = 'draft-visual';
		visual.setAttribute('aria-hidden', 'true');
		this.piles = document.createElement('div');
		this.piles.className = 'card-table-piles draft-piles';
		visual.appendChild(this.piles);
		this.tables = document.createElement('div');
		this.tables.className = 'draft-tables';
		visual.appendChild(this.tables);
		this.element.appendChild(visual);

		const handMount = document.createElement('div');
		handMount.className = 'draft-hand';
		this.element.appendChild(handMount);

		this.hand.init(handMount, {
			getCards: () => this.myHandCards(),
			// No onDiscard either: the pick IS the whole turn, so the discard
			// affordance disappears (button, Delete and the unplayable offer).
			onPlay: card => this.pickCard(card),
			// Multi-select is how a waiting "extra" gets spent: mark TWO cards (the
			// first resolves first — a marked multiplier catches the points card that
			// follows it) and send. One marked card is just the normal pick.
			multiSelect: {
				validate: cards => this.validatePicks(cards),
				submit: cards => this.submitPicks(cards),
			},
			playSound: event => soundEvents.playEvent(event),
			announce: text => this.deps.announce(text),
			t: (key, vars) => this.deps.tSync(key, vars),
			// Enter takes the card; Ctrl+Space arms a multi-pick (chopsticks). No draw/discard.
			shortcutText: { play: 'game.help_cmd_pick_card', multiSelect: 'game.help_cmd_multi_select' },
		});

		// S — "how am I doing?" — anywhere on the draft surface; Shift+S answers
		// "how are the OTHERS doing?". Same convention as journey and assembly.
		registerStatusKeys(this.element, {
			getGameState: this.deps.getGameState,
			getMyPlayerId: this.deps.getMyPlayerId,
			announce: this.deps.announce,
			mine: (gs, myId) => draftStatusText(gs, myId, this.deps.tSync),
			rivals: (gs, myId) => this.allSeatsStatus(gs, myId),
		});
		registerPileStatusKey(this.element, {
			announce: this.deps.announce,
			read: () => {
				const draft = this.deps.getGameState()?.draft;
				return draft
					? this.deps.tSync('game.draft_status_deck', { draw: draft.drawCount ?? 0 })
					: null;
			},
		});

		this.built = true;
	}

	// ── The hand ──────────────────────────────────────────────────────────────

	private myHandCards(): HandCard[] {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return [];
		const seat = draftSeat(gs, myId);
		if (!seat) return [];
		const catalog = draftCatalog(gs);

		return seat.hand.map(instance => {
			const def = catalog.get(instance.cardId);
			const label = def ? this.deps.tSync(def.nameKey) : instance.cardId;
			const picked = seat.committedInstanceId === instance.instanceId;
			return {
				id: instance.instanceId,
				// The committed card announces itself as the current pick, so arrowing
				// through the hand always tells you where your choice stands.
				label: picked ? this.deps.tSync('game.draft_card_picked', { card: label }) : label,
				typeKey: def?.type ?? 'unknown',
				value: def?.value ?? 0,
				playable: true, // a pick is always legal in this genre
				art: def ? genericCardArtHtml(def, label) : undefined,
				help: draftCardHelp(gs, instance.cardId, this.deps.tSync) ?? undefined,
			};
		});
	}

	/** Enter on a card: commit (or change) the secret pick. The server refuses anything
	 *  stale; the only local gate is the finished game. */
	private pickCard(card: HandCard): void {
		if (!this.gateAlive()) return;
		this.deps.commands.pick(card.id);
	}

	/** Multi-select validation: one card is the normal pick; two need an unspent
	 *  "extra" on my table; more than two is never legal in this genre. */
	private validatePicks(cards: HandCard[]): { ok: true } | { ok: false; reason: string } {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return { ok: false, reason: this.deps.tSync('game.draft_not_seated') };
		if (cards.length > 2)
			return { ok: false, reason: this.deps.tSync('game.draft_too_many_picks') };
		if (cards.length === 2 && !hasUnspentExtra(gs, myId))
			return { ok: false, reason: this.deps.tSync('game.draft_needs_extra') };
		return { ok: true };
	}

	/** Send the marked set: [a] is the plain pick, [a, b] spends the extra (a resolves
	 *  first — the marking order came from the player's own hands). */
	private submitPicks(cards: HandCard[]): void {
		if (!this.gateAlive()) return;
		this.deps.commands.pick(cards[0].id, cards[1]?.id ?? null);
	}

	/** Shared liveness gate: a finished game refuses out loud instead of acting. */
	private gateAlive(): boolean {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return false;
		if (gs.isGameOver) {
			this.deps.announce(this.deps.tSync('game.draft_game_over'));
			return false;
		}
		return true;
	}

	// ── Visual echoes (aria-hidden) ───────────────────────────────────────────
	private renderPiles(gs: GameState): void {
		const draft = gs.draft;
		if (!draft) return;
		this.piles.innerHTML = `<span class="card-table-pile" data-pile="deck">`
			+ genericCardBackHtml(String(draft.drawCount ?? 0))
			+ `<span class="card-table-pile__label">${escapeHtml(this.deps.tSync('game.draft_pile_deck'))}</span>`
			+ `</span>`;
	}

	private renderTables(gs: GameState): void {
		const catalog = draftCatalog(gs);
		const handSize = draftHandSize(gs);
		const rows = (gs.draft?.seats ?? []).map(seat => {
			const player = gs.players.find(p => p.id === seat.playerId);
			const color = escapeHtml(player?.color ?? '#888');
			const name = escapeHtml(player?.name ?? seat.playerId);
			const dessert = seat.desserts[0] ? catalog.get(seat.desserts[0].cardId) : undefined;
			const tiles = this.tableTiles(seat, catalog)
				+ (seat.desserts.length > 0 ? this.dessertTile(seat.desserts.length, dessert) : '');
			const picked = seat.hasPicked && seat.handCount > 0
				? `<span class="draft-table__picked">✓</span>` : '';
			const short = seat.handCount !== handSize && seat.handCount > 0
				? ` (${seat.handCount})` : '';
			const cards = seat.retired ? '' : `<span class="draft-table__cards">🂠 ${seat.handCount}${short}</span>`;
			return `<div class="draft-table${seat.retired ? ' draft-table--retired' : ''}" style="--seat-color:${color}">`
				+ `<span class="draft-table__name">${name}${picked}</span>`
				+ `<span class="draft-table__chips">${tiles || `<span class="draft-table__empty">—</span>`}</span>`
				+ `<span class="draft-table__score">${seat.score}</span>`
				+ cards
				+ `</div>`;
		});
		this.tables.innerHTML = rows.join('');
		this.applyRevealFlash(gs);
	}

	/** A seat's served cards as coloured tiles: plain copies grouped with a ×count, and each
	 *  boosted card (multiplier caught its points card) kept apart with its ×factor badge. */
	private tableTiles(seat: DraftSeatState, catalog: Map<string, DraftCardDef>): string {
		const plain = new Map<string, { def?: DraftCardDef; count: number }>();
		const boosted: Array<{ def?: DraftCardDef; multiplier?: DraftCardDef; factor: number }> = [];
		for (const slot of seat.table) {
			const def = catalog.get(slot.card.cardId);
			if (slot.onMultiplier) {
				const multiplier = catalog.get(slot.onMultiplier.cardId);
				boosted.push({ def, multiplier, factor: multiplier?.factor ?? 1 });
				continue;
			}
			const entry = plain.get(slot.card.cardId) ?? { def, count: 0 };
			entry.count++;
			plain.set(slot.card.cardId, entry);
		}
		const tile = (def: DraftCardDef | undefined, count: number, badge: string, multiplier?: DraftCardDef): string => {
			const type = (def?.type ?? 'unknown').replace(/[^a-z]/gi, '');
			const colour = DRAFT_TYPE_COLOR[type] ?? '#9e9e9e';
			const nm = escapeHtml(def ? this.deps.tSync(def.nameKey) : '?');
			return `<span class="draft-card draft-card--${type}" style="--type-color:${colour};--type-ink:${contrastingTextColor(colour)}">`
				+ (def ? cardArtSvg(def, 'draft-card__art card-art-thumb') : '')
				+ (multiplier ? cardArtSvg(multiplier, 'draft-card__multiplier-art') : '')
				+ `<span class="draft-card__name">${nm}</span>`
				+ (count > 1 ? `<span class="draft-card__count">×${count}</span>` : '')
				+ (badge ? `<span class="draft-card__badge">${badge}</span>` : '')
				+ `</span>`;
		};
		return [...plain.values()].map(e => tile(e.def, e.count, '')).join('')
			+ boosted.map(b => tile(b.def, 1, `×${b.factor}`, b.multiplier)).join('');
	}

	/** The dessert stash: one pudding tile wearing the count, drawn as a little stack. */
	private dessertTile(n: number, def?: DraftCardDef): string {
		return `<span class="draft-card draft-card--stack" style="--type-color:${DRAFT_TYPE_COLOR.dessert}">`
			+ (def ? cardArtSvg(def, 'draft-card__art card-art-thumb') : '')
			+ `<span class="draft-card__count">×${n}</span></span>`;
	}

	/** A table that just GREW flashes (the reveal landed — same language as the other
	 *  card families' hit flash). */
	private applyRevealFlash(gs: GameState): void {
		(gs.draft?.seats ?? []).forEach((seat, index) => {
			const count = seat.table.length + seat.desserts.length;
			const previous = this.lastTableSizes.get(seat.playerId);
			this.lastTableSizes.set(seat.playerId, count);
			if (previous === undefined || count <= previous) return;
			if (this.deps.motionDisabled()) return;
			const row = this.tables.children[index] as HTMLElement | undefined;
			row?.classList.add('draft-table--revealed');
			window.setTimeout(() => row?.classList.remove('draft-table--revealed'), 700);
		});
	}
}
