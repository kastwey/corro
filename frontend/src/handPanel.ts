// handPanel.ts — The accessible HAND: the central surface of card families (approved spec:
// in these families there is no spatial board — the hand list is where focus lives, ESC
// parks here, and the game is played from it).
//
// Generic on purpose: the family feeds cards ({id, label, typeKey, value, playable}) and
// the action callbacks; this component owns the keyboard model and speaks only UI
// mechanics (filter counts, sort changes, refusals, the discard confirmation). Game
// OUTCOMES (card played, card drawn — privately, via ToPlayer) are announced by the
// server, which owns the voice.
//
// Keyboard model (shared with the manage dialog / players panel via RovingToolbarList):
//   - Up/Down/Home/End move between cards; each card is one focus stop reading its label.
//   - Right enters the card's action toolbar; Shift+F10 / Applications mirrors it as a menu
//     (play, discard, family-appropriate sorting, and the card-display radio modes).
//   - Enter plays the focused card (spoken refusal with the reason when it can't be played).
//   - Space draws (turn-gated by the family; spoken refusal otherwise).
//   - Delete discards — behind a modal yes/no (it is irreversible), same dialog on every
//     path: the key, the toolbar button, the context menu, and the unplayable-card offer.

import { RovingCheckboxList, RovingToolbarList } from './accessibleList.js';
import { dialogManager } from './dialogManager.js';
import { reconcileChildren } from './domReconcile.js';
import { reconcileToolbarButtons, type ToolbarAction } from './toolbarButtons.js';
import type { HelpShortcut } from './shortcuts.js';
import { registerHandAnnouncementFocusTarget } from './handAnnouncementFocus.js';

/** The hand's keyboard bindings, as keymap-style specs for the shortcuts help. These MUST
 *  mirror onKeydown (which reads native key events): they are the single declaration of
 *  which key does what in the hand, so the help never drifts from the routing. */
const HAND_KEY = {
	play: 'enter',
	draw: 'space',
	discard: 'delete',
	multiToggle: 'ctrl+space',
	// Shift+F1 reads the focused card's help, so the player never hunts for the toolbar/menu
	// Help action. Fits the F1 family (F1 guide, Ctrl+F1 shortcuts, Ctrl+Shift+F1 rules).
	help: 'shift+f1',
} as const;

/** How THIS family words each hand affordance for the shortcuts help. The panel owns the
 *  bindings (HAND_KEY); the family owns only the wording, supplied right where it wires the
 *  matching callback — so a key can't be added without describing it (draft "take" vs
 *  journey "play"; shedding "draw or keep and pass"). A description is read only when its
 *  callback is also wired, so the optional ones pair with onDraw/onDiscard/multiSelect. */
export interface HandShortcutText {
	/** Enter — onPlay is always wired. */
	readonly play: string;
	/** Space — required when onDraw is wired. */
	readonly draw?: string;
	/** Delete — required when onDiscard is wired. */
	readonly discard?: string;
	/** Ctrl+Space — required when multiSelect is wired. */
	readonly multiSelect?: string;
}

/** One card in the hand, already localized by the family. */
export interface HandCard {
	/** Stable server-side card instance id (focus survives refreshes through it). */
	id: string;
	/** Full spoken/visible name ("Circule", "75 km", …). */
	label: string;
	/** Stable family type id, used by "sort by type" grouping ("distance", "attack"…). */
	typeKey: string;
	/** Numeric weight for "sort by value" (km…); 0 when not applicable. */
	value: number;
	/** Colour rank for "sort by colour" (lower = first; the family sets its deck order).
	 *  Undefined on colourless cards (wilds, and whole families with no
	 *  colour) — those sort last, and the colour-sort option only shows when SOME card has one. */
	colourOrder?: number;
	playable: boolean;
	/** Localized reason spoken when playing is refused. */
	unplayableReason?: string;
	/** Optional VISUAL face (trusted HTML from the family's renderer): purely aria-hidden
	 *  decoration for sighted players — the row's aria-label stays the accessible card. */
	art?: string;
	/** Localized "what does this card do?" text. When present, the row (and its Shift+F10
	 *  menu) offers a Help action that opens it as a reading dialog. */
	help?: string;
}

/** One family-owned ordering for a hand whose useful axes are not the generic
 *  value/type/colour set. The panel makes the comparator stable by preserving deal order
 *  when it returns zero. IDs are persisted, so keep them stable within the preference scope. */
export interface HandSortOption {
	readonly id: string;
	readonly labelKey: string;
	readonly announcementKey: string;
	compare(a: HandCard, b: HandCard): number;
}

/** Complete replacement for the generic hand orderings. A scope keeps one family's choice
 *  from overwriting another family's incompatible sort preference. */
export interface HandSorting {
	readonly preferenceScope: string;
	readonly defaultId: string;
	readonly options: readonly HandSortOption[];
}

/** The multi-select contract a family opts into (families without it keep the plain
 *  one-card hand: no mode toggle, Ctrl+Space inert). The panel owns the interaction —
 *  marking, the mode switch, its voice and sounds; the FAMILY owns what a marked set
 *  means: validation wording and the submit. Marked cards travel in MARKING ORDER
 *  (it can matter: draft resolves the first card first). */
export interface HandMultiSelect {
	/** May this marked set (1..n cards) be sent right now? The family words the reason. */
	validate(cards: HandCard[]): { ok: true } | { ok: false; reason: string };
	/** Send the marked set (already validated). */
	submit(cards: HandCard[]): void;
	/** Non-null when the rules currently FORCE a multi pick of this size: the panel
	 *  switches itself to multi-select (with its own sound), and back when it clears. */
	requiredCount?(): number | null;
}

export interface HandPanelDeps {
	getCards(): HandCard[];
	/** May the player draw right now? The family gates turn/phase and words the reason.
	 *  OPTIONAL along with onDraw: a family whose refill is automatic (assembly) has no
	 *  draw affordance at all — no button, and Space falls through. */
	canDraw?(): { ok: true } | { ok: false; reason: string };
	onDraw?(): void;
	onPlay(card: HandCard): void;
	/** OPTIONAL like onDraw: a family whose turn has no discard at all (draft — the pick
	 *  IS the whole turn) supplies none, and the affordance disappears everywhere (no
	 *  button, Delete falls through, no unplayable-card discard offer). */
	onDiscard?(card: HandCard): void;
	/** May the player discard right now? Gates the discard PROMPT the way {@link canDraw}
	 *  gates draw: when it refuses (journey's "draw a card first"), the reason is spoken and
	 *  no "do you want to discard?" dialog opens. Optional — a family without this gate always
	 *  offers discard (whenever onDiscard is wired). */
	canDiscard?(): { ok: true } | { ok: false; reason: string };
	/** Instant, assertive announcement (UI mechanics only). */
	announce(text: string): void;
	/** Full-key translator (keys under game.hand_*). */
	t(key: string, vars?: Record<string, unknown>): string;
	/** Opt-in multi-select (see <see cref="HandMultiSelect"/>): Ctrl+Space (or the tools
	 *  toggle, or Ctrl+click) switches modes; in multi mode Space marks and Enter sends. */
	multiSelect?: HandMultiSelect;
	/** Sound-pack event player for the panel's own cues (mode switches). Optional: no
	 *  sounds without it, everything else works the same. */
	playSound?(event: string): void;
	/** How this family words its hand keys for the shortcuts help (see HandShortcutText). */
	shortcutText: HandShortcutText;
	/** Optional family-owned orderings. Supplying these replaces value/type/colour/original;
	 *  include an original-order option explicitly when the family wants to expose one. */
	sorting?: HandSorting;
}

type BuiltInSortMode = 'hand' | 'type' | 'value' | 'valueAsc' | 'colour';
type PlayabilityMode = 'all' | 'first' | 'only';

const SORT_MODES: readonly BuiltInSortMode[] = ['hand', 'type', 'value', 'valueAsc', 'colour'];
const PLAYABILITY_MODES: readonly PlayabilityMode[] = ['all', 'first', 'only'];

/** Ordering/display preferences are per-player PRESENTATION preferences (like theme or
 *  sound): they live in localStorage — not in the game document — and survive reloads on
 *  this browser. */
const PREFS_KEY = 'corro.handPreferences';

export class HandPanel {
	private deps: HandPanelDeps | null = null;
	private root: HTMLElement | null = null;
	private listEl: HTMLUListElement | null = null;
	private emptyEl: HTMLParagraphElement | null = null;
	/** Stable focused narration while an authoritative update changes the card rows. */
	private actionStatusEl: HTMLParagraphElement | null = null;
	private actionReturnFocusId: string | null = null;
	private unregisterActionFocus: (() => void) | null = null;
	/** The LIST-level tools (sorts + card-display mode): painted ONCE for the whole hand as
	 *  a visible toolbar — never duplicated on every row — and mirrored into the context menu. */
	private listActionsEl: HTMLElement | null = null;
	private nav: RovingToolbarList | null = null;
	/** Single-tab-stop roving over the tools toolbar (arrows move inside it). */
	private toolsNav: RovingCheckboxList | null = null;

	// "What advances me most" is the natural top of a card hand: value order by default.
	private sortMode = 'value';
	/** Exactly one view applies: normal order, playable-first tiers, or playable cards only. */
	private playabilityMode: PlayabilityMode = 'all';

	// ── Multi-select state (per PANEL instance = per game, deliberately NOT persisted:
	// the mode preference lives for the session, as agreed) ──
	/** The player's own explicit mode choice; null until they ever switch. */
	private userMode: 'single' | 'multi' | null = null;
	/** Non-null while the rules force a multi pick (overrides the preference). */
	private forcedCount: number | null = null;
	/** Marked card ids, in MARKING ORDER (the order the set is sent in). */
	private markedOrder: string[] = [];

	/** Build the panel inside `mount`. Idempotent per mount; call update() to render cards. */
	init(mount: HTMLElement, deps: HandPanelDeps): void {
		this.deps = deps;
		this.destroyDom();
		this.sortMode = this.customSorting()?.defaultId ?? 'value';
		this.loadPreferences();

		const root = document.createElement('section');
		root.className = 'hand-panel';

		// The visible draw affordance (families with no dice replace the roll button with
		// this). Space works too; refusals are SPOKEN, the button never goes `disabled`.
		// A family with an AUTOMATIC refill (assembly) supplies no onDraw: no button.
		if (deps.onDraw) {
			const draw = document.createElement('button');
			draw.type = 'button';
			draw.className = 'hand-panel__draw btn btn--primary';
			draw.textContent = deps.t('game.hand_draw');
			draw.setAttribute('aria-keyshortcuts', 'Space');
			draw.addEventListener('click', () => this.tryDraw());
			root.appendChild(draw);
		}

		// The list-level tools (sort + card-display mode) affect the WHOLE hand, so they are
		// painted once, here — not repeated on every row. One tab stop (roving, like any toolbar);
		// the Shift+F10 menu of any row mirrors them after the row's own actions.
		const tools = document.createElement('div');
		tools.className = 'hand-panel__list-actions';
		tools.setAttribute('role', 'toolbar');
		tools.setAttribute('aria-label', deps.t('game.hand_tools_label'));
		root.appendChild(tools);
		this.listActionsEl = tools;
		this.toolsNav = new RovingCheckboxList({ container: tools, itemSelector: 'button' });

		// A focused card can disappear after play/discard. Moving straight to its replacement
		// makes JAWS announce "1 of N" ahead of the server voice even when the live region was
		// updated first. This stable status receives that action's complete utterance as focused
		// content and survives the following list reconciliation. It is programmatic-only; the
		// next Tab/arrow/action key deliberately returns the player to the changed hand.
		const actionStatus = document.createElement('p');
		actionStatus.className = 'hand-panel__action-status sr-only';
		actionStatus.tabIndex = -1;
		root.appendChild(actionStatus);

		const list = document.createElement('ul');
		list.className = 'hand-panel__list';
		// A real ARIA list (role="list" survives the list-style:none / display:flex that
		// strips native list semantics in WebKit). Screen readers announce it as a list with
		// each card's position ("1 de 7"). NVDA also reads a per-item "nivel 1"; that is
		// handled reader-side, not by dropping the list (which lost the list announcement).
		list.setAttribute('role', 'list');
		list.setAttribute('aria-label', deps.t('game.hand_list_label'));
		root.appendChild(list);

		const empty = document.createElement('p');
		empty.className = 'hand-panel__empty';
		empty.tabIndex = -1;
		empty.hidden = true;
		root.appendChild(empty);

		mount.appendChild(root);
		this.root = root;
		this.listEl = list;
		this.emptyEl = empty;
		this.actionStatusEl = actionStatus;
		this.unregisterActionFocus = registerHandAnnouncementFocusTarget(utterance => {
			const active = document.activeElement;
			if (!this.root || !this.actionStatusEl || !active || !this.root.contains(active)) {
				return false;
			}
			this.actionReturnFocusId = active.closest<HTMLElement>('.hand-card')?.dataset.focusId ?? null;
			this.actionStatusEl.textContent = utterance;
			this.actionStatusEl.focus();
			return document.activeElement === this.actionStatusEl;
		});
		actionStatus.addEventListener('focusout', () => {
			actionStatus.textContent = '';
			this.actionReturnFocusId = null;
		});

		this.nav = new RovingToolbarList({
			list,
			itemSelector: '.hand-card',
			toolbarButtonSelector: '.hand-card__actions button',
			listActionsSelector: '.hand-panel__list-actions button',
			menuLabel: () => deps.t('game.hand_menu_label'),
			menuClass: 'hand-context-menu',
			menuItemClass: 'hand-context-menu-item',
			// Visible popups belong to the active landmark, never as orphan content under body.
			menuHost: () => root.closest<HTMLElement>(
				'dialog[open], main, [role="main"], [role="region"]') ?? root,
		});

		// Registered AFTER the roving controller so navigation keys are already resolved;
		// this layer only adds the game keys (Space draw/mark, Enter play/send, Delete
		// discard, Ctrl+Space mode switch).
		root.addEventListener('keydown', (e) => {
			if (e.target === this.actionStatusEl && this.reenterHandFromActionStatus(e)) return;
			this.onKeydown(e);
		});
		// Mouse projection of the same multi-select state: in multi mode a row click
		// toggles its mark; Ctrl+click from single mode enters multi with that card marked.
		list.addEventListener('click', (e) => this.onListClick(e));

		this.update();
	}

	/** Re-render from the family's current cards, preserving focus by card id. */
	update(): void {
		if (!this.deps || !this.listEl || !this.emptyEl) return;
		this.syncMultiSelect();
		const all = this.deps.getCards();
		const visible = this.visibleCards(all);

		// Two distinct empties: NO CARDS AT ALL swaps in the empty-hand message; a filter
		// with no matches stays a plain zero-item list. Its list semantics already say all
		// that is useful, without an extra description that makes turn changes chatty.
		const allEmpty = all.length === 0;
		const filteredEmpty = !allEmpty && visible.length === 0;
		this.emptyEl.hidden = !allEmpty;
		this.emptyEl.textContent = this.deps.t('game.hand_empty');
		this.listEl.hidden = allEmpty;
		if (filteredEmpty) {
			this.listEl.tabIndex = -1; // a focus landing spot while no row exists
		} else {
			this.listEl.removeAttribute('tabindex');
		}

		// Noted BEFORE the reconcile: if focus gets disturbed by the reorder, it returns to
		// the SAME card when it survives (manage-dialog convention), else the first row.
		const activeCardId = (document.activeElement as HTMLElement | null)
			?.closest?.<HTMLElement>('.hand-card')?.dataset.focusId ?? null;

		reconcileChildren(this.listEl, {
			items: visible,
			key: card => card.id,
			keyOf: el => (el as HTMLElement).dataset.focusId,
			create: card => this.createRow(card),
			update: (li, card) => this.updateRow(li as HTMLElement, card),
			// Focus never lands on <body>: the owning card if it survived, else the first
			// remaining card, else the empty list (filtered) or the empty message.
			rescueFocus: () => {
				const items = this.nav?.getItems() ?? [];
				const owner = activeCardId ? items.find(el => el.dataset.focusId === activeCardId) ?? null : null;
				if (owner) { this.nav?.setRovingItem(items, items.indexOf(owner)); return owner; }
				if (items[0]) { this.nav?.setRovingItem(items, 0); return items[0]; }
				return this.listEl && !this.listEl.hidden ? this.listEl : this.emptyEl;
			},
		});
		this.nav?.refreshRovingTabindex();

		// Keep the list-level tools fresh (ordering/display state shows in the toolbar and
		// travels into the context menu — even when the filter left no row).
		if (this.listActionsEl) {
			reconcileToolbarButtons(this.listActionsEl, this.listLevelSpecs(), {
				buttonClass: 'hand-card__btn',
				keyAttr: 'focusId',
			});
			this.toolsNav?.refreshRovingTabindex();
		}
	}

	/** Put keyboard focus on the hand (the current card, else the empty list/message). */
	focus(): void {
		if (this.nav?.focusItem()) return;
		if (this.listEl && !this.listEl.hidden) this.listEl.focus();
		else this.emptyEl?.focus();
	}

	/** Move roving focus to the next VISIBLE card that satisfies `pred`, searching FORWARD
	 *  from the current focus (or BACKWARD when `backward`), wrapping around; returns false
	 *  when no visible card matches (the caller words the "none" announcement). Landing on the
	 *  card reads its own label, so success needs no extra speech. Powers the shedding
	 *  colour-jump keys (R/G/B/Y forward, Shift+ the same backward). */
	focusNextMatching(pred: (card: HandCard) => boolean, backward = false): boolean {
		const items = this.nav?.getItems() ?? [];
		if (!items.length) return false;
		const activeId = (document.activeElement as HTMLElement | null)?.dataset?.focusId
			?? items.find(el => el.tabIndex === 0)?.dataset.focusId ?? null;
		const start = Math.max(0, items.findIndex(el => el.dataset.focusId === activeId));
		const dir = backward ? -1 : 1;
		for (let step = 1; step <= items.length; step++) {
			const idx = ((start + dir * step) % items.length + items.length) % items.length;
			const card = this.cardById(items[idx].dataset.focusId ?? '');
			if (card && pred(card)) { this.nav!.focusItem(idx); return true; }
		}
		return false;
	}

	/** Detach everything (tests / leaving a card game). */
	destroy(): void {
		this.destroyDom();
		this.deps = null;
	}

	private destroyDom(): void {
		this.unregisterActionFocus?.();
		this.unregisterActionFocus = null;
		this.nav?.destroy();
		this.nav = null;
		this.toolsNav?.destroy();
		this.toolsNav = null;
		this.root?.remove();
		this.root = null;
		this.listEl = null;
		this.emptyEl = null;
		this.actionStatusEl = null;
		this.actionReturnFocusId = null;
		this.listActionsEl = null;
		this.sortMode = 'value'; // back to the default ordering
		this.playabilityMode = 'all';
		this.userMode = null; // the mode preference lives one game, not across them
		this.forcedCount = null;
		this.markedOrder = [];
	}

	// ── Multi-select ──────────────────────────────────────────────────────────

	/**
	 * The status is a deliberate pause between the server voice and the changed list. A
	 * navigation/action key first re-enters the hand and is consumed, so a player hears the
	 * newly focused card before deciding what to do with it. Tab keeps native order: forward
	 * enters the first row and backward reaches the list tools/draw control.
	 */
	private reenterHandFromActionStatus(event: KeyboardEvent): boolean {
		if (event.key === 'Tab') return false;
		const keys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' ', 'Delete']);
		if (!keys.has(event.key)) return false;

		event.preventDefault();
		event.stopPropagation();
		this.actionStatusEl!.textContent = '';
		const items = this.nav?.getItems() ?? [];
		const ownerIndex = this.actionReturnFocusId
			? items.findIndex(item => item.dataset.focusId === this.actionReturnFocusId)
			: -1;
		const targetIndex = ownerIndex >= 0
			? ownerIndex
			: items.length > 0 && (event.key === 'ArrowUp' || event.key === 'End')
				? items.length - 1
				: 0;
		this.actionReturnFocusId = null;
		if (items.length > 0) this.nav!.focusItem(targetIndex);
		else this.focus();

		// If the known card survived (a draw changed the hand around it), replay the key from
		// that row: arrows continue relative navigation and action keys continue naturally.
		// A removed card never transfers a key to an unfamiliar replacement row: the first
		// press only enters and reads it.
		if (ownerIndex >= 0) {
			items[ownerIndex].dispatchEvent(new KeyboardEvent('keydown', {
				key: event.key,
				ctrlKey: event.ctrlKey,
				shiftKey: event.shiftKey,
				altKey: event.altKey,
				metaKey: event.metaKey,
				bubbles: true,
				cancelable: true,
			}));
		}
		return true;
	}

	/** Whether the hand is in multi-select right now: forced episodes win, then the
	 *  player's own choice, and single-card is the default. */
	private isMulti(): boolean {
		if (!this.deps?.multiSelect) return false;
		return this.forcedCount != null || this.userMode === 'multi';
	}

	/** Reconcile the forced episode and the marks with the fresh state (runs on every
	 *  update): entering/leaving a forced episode speaks and sounds; marks of cards that
	 *  left the hand vanish silently. */
	private syncMultiSelect(): void {
		if (!this.deps?.multiSelect) return;
		const required = this.deps.multiSelect.requiredCount?.() ?? null;
		if (required != null && this.forcedCount == null) {
			const wasMulti = this.isMulti();
			this.forcedCount = required;
			if (!wasMulti) {
				this.deps.playSound?.('hand.mode.multi_forced');
				this.deps.announce(this.deps.t('game.hand_multi_forced', { count: required }));
			}
		} else if (required == null && this.forcedCount != null) {
			this.forcedCount = null;
			if (!this.isMulti()) {
				this.deps.playSound?.('hand.mode.single');
				this.deps.announce(this.deps.t('game.hand_multi_off'));
			}
		}
		const ids = new Set(this.deps.getCards().map(c => c.id));
		this.markedOrder = this.isMulti() ? this.markedOrder.filter(id => ids.has(id)) : [];
	}

	/** The player flips the mode (Ctrl+Space, the tools toggle): their choice STICKS for
	 *  the rest of the game. Refused out loud while a forced episode holds the mode. */
	private toggleModeByUser(): void {
		if (!this.deps?.multiSelect) return;
		if (this.forcedCount != null) {
			this.deps.announce(this.deps.t('game.hand_multi_locked'));
			return;
		}
		const entering = !this.isMulti();
		this.userMode = entering ? 'multi' : 'single';
		if (!entering) this.markedOrder = [];
		this.deps.playSound?.(entering ? 'hand.mode.multi' : 'hand.mode.single');
		this.deps.announce(this.deps.t(entering ? 'game.hand_multi_on' : 'game.hand_multi_off'));
		this.update();
	}

	/** Mark/unmark one card, speaking the running count ("Croqueta, marcada. Seleccionadas: 2."). */
	private toggleMark(card: HandCard): void {
		const at = this.markedOrder.indexOf(card.id);
		if (at >= 0) this.markedOrder.splice(at, 1);
		else this.markedOrder.push(card.id);
		this.deps!.announce(this.deps!.t(at >= 0 ? 'game.hand_multi_unmarked' : 'game.hand_multi_marked',
			{ card: card.label, count: this.markedOrder.length }));
		this.update();
	}

	/** Enter (or the Send button): family-validate the marked set and submit it in
	 *  marking order. An empty set is refused out loud, never silently swallowed. */
	private sendMarked(): void {
		if (!this.deps?.multiSelect) return;
		const byId = new Map(this.deps.getCards().map(c => [c.id, c]));
		const cards = this.markedOrder.map(id => byId.get(id)).filter((c): c is HandCard => !!c);
		if (cards.length === 0) {
			this.deps.announce(this.deps.t('game.hand_multi_none'));
			return;
		}
		const check = this.deps.multiSelect.validate(cards);
		if (!check.ok) {
			this.deps.announce(check.reason);
			return;
		}
		this.markedOrder = [];
		this.update(); // the checkmarks clear immediately, not on the server's echo
		this.focus(); // back on the hand before the server repaints it
		this.deps.multiSelect.submit(cards);
	}

	/** Mouse projection: row click toggles in multi mode; Ctrl+click from single mode
	 *  ENTERS multi (a deliberate user switch — it sticks) with that card marked. */
	private onListClick(e: MouseEvent): void {
		if (!this.deps?.multiSelect) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest('button')) return; // row toolbars keep their own clicks
		const item = target?.closest<HTMLElement>('.hand-card');
		if (!item) return;
		const card = this.cardById(item.dataset.focusId);
		if (!card) return;

		if (this.isMulti()) {
			this.toggleMark(card);
			return;
		}
		if (e.ctrlKey) {
			this.userMode = 'multi';
			this.deps.playSound?.('hand.mode.multi');
			this.deps.announce(this.deps.t('game.hand_multi_on'));
			this.toggleMark(card);
		}
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	private visibleCards(all: HandCard[]): HandCard[] {
		const filtered = this.playabilityMode === 'only' ? all.filter(c => c.playable) : [...all];
		const custom = this.customSorting()?.options.find(option => option.id === this.sortMode);
		const compareBySelectedOrder = (a: HandCard, b: HandCard): number => {
			if (custom) return custom.compare(a, b);
			if (this.sortMode === 'type') {
				// Group by type (alphabetical on the stable key), hand order within a group.
				return a.typeKey.localeCompare(b.typeKey);
			}
			if (this.sortMode === 'value' || this.sortMode === 'valueAsc') {
				// Biggest first by default ("what advances me most"), or smallest first when
				// the player prefers building up.
				const sign = this.sortMode === 'value' ? -1 : 1;
				return sign * (a.value - b.value);
			}
			if (this.sortMode === 'colour') {
				// Group by the family's deck colour order, biggest value first within a
				// colour, colourless cards (wilds) pooled last in hand order.
				const rank = (c: HandCard): number => c.colourOrder ?? Number.MAX_SAFE_INTEGER;
				return rank(a) - rank(b) || b.value - a.value;
			}
			return 0; // Original hand order.
		};

		// In playable-first mode, playability is the primary key. The chosen family/generic
		// ordering remains secondary inside both tiers, and deal order makes every tie stable.
		return filtered
			.map((c, i) => ({ c, i }))
			.sort((a, b) => (this.playabilityMode === 'first'
				? Number(b.c.playable) - Number(a.c.playable)
				: 0)
				|| compareBySelectedOrder(a.c, b.c)
				|| a.i - b.i)
			.map(x => x.c);
	}

	private createRow(card: HandCard): HTMLElement {
		const item = document.createElement('li');
		item.className = 'hand-card';
		item.setAttribute('role', 'listitem');
		item.tabIndex = -1;
		item.dataset.focusId = card.id;

		// The multi-select checkbox (aria-hidden: the row's aria-label carries the state).
		const check = document.createElement('span');
		check.className = 'hand-card__check';
		check.setAttribute('aria-hidden', 'true');
		item.appendChild(check);

		// The visual face slot (aria-hidden decoration; the row's aria-label is the card).
		const art = document.createElement('span');
		art.className = 'hand-card__art';
		art.setAttribute('aria-hidden', 'true');
		item.appendChild(art);

		const name = document.createElement('span');
		name.className = 'hand-card__name';
		name.setAttribute('aria-hidden', 'true');
		item.appendChild(name);

		const actions = document.createElement('div');
		actions.className = 'hand-card__actions';
		actions.setAttribute('role', 'toolbar');
		item.appendChild(actions);

		this.updateRow(item, card);
		return item;
	}

	private updateRow(item: HTMLElement, card: HandCard): void {
		const t = this.deps!.t;
		const multi = this.isMulti();
		const marked = multi && this.markedOrder.includes(card.id);
		// Playable stays silent (the common case); only the exceptions are spoken —
		// an unplayable card, and a marked one in multi-select. (Position "1 de 7" comes
		// from the ARIA list itself, so it is not repeated in the label.)
		let ariaLabel = card.playable
			? card.label
			: `${card.label}. ${t('game.hand_unplayable_tag')}`;
		if (marked) ariaLabel = `${ariaLabel}, ${t('game.hand_multi_marked_tag')}`;
		if (item.getAttribute('aria-label') !== ariaLabel) item.setAttribute('aria-label', ariaLabel);

		// The visible checkbox only exists in multi mode (for the eye it isn't a "mode":
		// checkboxes and a send button simply appear).
		const check = item.querySelector('.hand-card__check') as HTMLElement;
		const checkGlyph = multi ? (marked ? '☑' : '☐') : '';
		if (check.textContent !== checkGlyph) check.textContent = checkGlyph;
		item.classList.toggle('hand-card--marked', marked);

		// The face only changes with the card's LABEL (a late package-i18n merge repaints
		// raw keys into names): key the render on both, skip the innerHTML otherwise.
		const art = item.querySelector('.hand-card__art') as HTMLElement;
		const artKey = `${card.id}|${card.label}`;
		if (card.art && art.dataset.renderedFor !== artKey) {
			art.innerHTML = card.art;
			art.dataset.renderedFor = artKey;
		}
		// With a face, the row LOOKS like a card (the face carries the printed name).
		item.classList.toggle('hand-card--visual', !!card.art);

		const name = item.querySelector('.hand-card__name') as HTMLElement;
		if (name.textContent !== card.label) name.textContent = card.label;
		item.classList.toggle('hand-card--unplayable', !card.playable);

		const actions = item.querySelector('.hand-card__actions') as HTMLElement;
		const actionsLabel = t('game.actions_for', { name: card.label });
		if (actions.getAttribute('aria-label') !== actionsLabel) actions.setAttribute('aria-label', actionsLabel);

		reconcileToolbarButtons(actions, this.actionSpecs(card), {
			buttonClass: 'hand-card__btn',
			keyAttr: 'focusId',
		});
		// The play button carries the aria-disabled convention (never `disabled`): it stays
		// focusable and clicking it speaks the reason.
		const playBtn = actions.querySelector<HTMLElement>('[data-focus-id="play"]');
		if (playBtn) {
			if (card.playable) playBtn.removeAttribute('aria-disabled');
			else playBtn.setAttribute('aria-disabled', 'true');
		}
	}

	/** Per-card actions ONLY (play/discard): the list-level ordering/display tools live once
	 *  in the tools toolbar, and the context menu composes both. */
	private actionSpecs(card: HandCard): ToolbarAction[] {
		const t = this.deps!.t;
		const specs: ToolbarAction[] = [
			{ key: 'play', label: t('game.hand_play'), onClick: () => this.tryPlay(card) },
		];
		if (this.deps!.onDiscard) {
			specs.push({ key: 'discard', label: t('game.hand_discard'), onClick: () => this.tryDiscard(card) });
		}
		if (card.help) {
			specs.push({ key: 'help', label: t('game.hand_help'), onClick: () => this.showHelp(card) });
		}
		return specs;
	}

	/** "What does this card do?" — a READING dialog (documentMode: browseable with the
	 *  screen reader's virtual cursor), titled by the card, closing back onto the hand. */
	private showHelp(card: HandCard): void {
		const escape = (s: string) => s.replace(/[&<>"']/g, c =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
		dialogManager.show({
			title: card.label,
			content: `<p>${escape(card.help ?? '')}</p>`,
			className: 'dialog-card-help',
			documentMode: true,
			buttons: [{
				label: this.deps!.t('game.help_close'),
				variant: 'primary',
				action: () => { dialogManager.close(); this.focus(); },
			}],
		});
	}

	/** The row-independent actions (they also feed the list-level menu on a filtered-empty
	 *  hand): ordering and card display are two RADIO submenus. Card display always has one
	 *  selected mode, including the neutral "all cards" option. */
	private listLevelSpecs(): ToolbarAction[] {
		const t = this.deps!.t;
		const sortGroup = t('game.hand_sort_group');
		const playabilityGroup = t('game.hand_playability_group');
		const sortAction = (key: string, mode: string, labelKey: string): ToolbarAction => ({
			key, label: t(labelKey), group: sortGroup,
			pressed: this.sortMode === mode,
			onClick: () => this.setSort(mode),
		});
		const playabilityAction = (
			key: string, mode: PlayabilityMode, labelKey: string
		): ToolbarAction => ({
			key, label: t(labelKey), group: playabilityGroup,
			pressed: this.playabilityMode === mode,
			onClick: () => this.setPlayabilityMode(mode),
		});
		// Multi-select lives in the tools too (the mouse projection of Ctrl+Space), and
		// in multi mode the SEND button with its live count leads the toolbar.
		const multiActions: ToolbarAction[] = !this.deps!.multiSelect ? [] : [
			...(this.isMulti() ? [{
				key: 'multi-send',
				label: t('game.hand_multi_send', { count: this.markedOrder.length }),
				onClick: () => this.sendMarked(),
			}] : []),
			{
				key: 'multi-toggle',
				label: t('game.hand_multi_toggle'),
				pressed: this.isMulti(),
				onClick: () => this.toggleModeByUser(),
			},
		];
		// "Sort by colour" is only meaningful where cards HAVE a colour: show it only
		// when some card carries a colourOrder, so colourless families never see a dead option.
		const hasColour = this.deps!.getCards().some(c => c.colourOrder !== undefined);
		const customSortActions = this.customSorting()?.options.map(option =>
			sortAction(`sort-${option.id}`, option.id, option.labelKey));
		return [
			...multiActions,
			...(customSortActions ?? [
				sortAction('sort-value', 'value', 'game.hand_sort_by_value'),
				sortAction('sort-value-asc', 'valueAsc', 'game.hand_sort_by_value_asc'),
				...(hasColour ? [sortAction('sort-colour', 'colour', 'game.hand_sort_by_colour')] : []),
				sortAction('sort-type', 'type', 'game.hand_sort_by_type'),
				sortAction('sort-hand', 'hand', 'game.hand_sort_hand'),
			]),
			playabilityAction('show-all-cards', 'all', 'game.hand_show_all'),
			playabilityAction('prioritize-playable', 'first', 'game.hand_prioritize_playable'),
			playabilityAction('filter-playable', 'only', 'game.hand_filter_playable'),
		];
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	private tryPlay(card: HandCard): void {
		if (!card.playable) {
			const reason = card.unplayableReason ?? this.deps!.t('game.hand_not_playable');
			if (!this.deps!.onDiscard) {
				// No discard in this family: the refusal is the whole answer.
				this.deps!.announce(reason);
				return;
			}
			// Discarding the unplayable card is the usual next step, but not before drawing:
			// if discard is gated (journey's "draw a card first"), that's the answer, not a
			// "do you want to discard?" prompt.
			const can = this.deps!.canDiscard?.() ?? { ok: true as const };
			if (!can.ok) { this.deps!.announce(can.reason); return; }
			// Discarding is the ONLY action left for an unplayable card, so offer it right
			// here: the dialog reads the refusal reason and asks in one breath.
			this.confirmDiscard(card, `${reason} ${this.deps!.t('game.hand_discard_question', { card: card.label })}`);
			return;
		}
		this.deps!.onPlay(card);
	}

	/** Discarding is irreversible: a modal yes/no confirms it (all paths: Delete, the
	 *  toolbar button, the context menu, and the unplayable-card offer). */
	private tryDiscard(card: HandCard): void {
		if (!this.deps?.onDiscard) return; // no discard in this family: Delete falls through
		// Don't even ASK when discarding isn't allowed yet (journey: "draw a card first") —
		// speak the reason instead of opening a yes/no the server would only reject.
		const can = this.deps.canDiscard?.() ?? { ok: true as const };
		if (!can.ok) { this.deps.announce(can.reason); return; }
		this.confirmDiscard(card, this.deps!.t('game.hand_discard_question', { card: card.label }));
	}

	private confirmDiscard(card: HandCard, message: string): void {
		dialogManager.showConfirm({
			title: this.deps!.t('game.hand_discard'),
			message,
			// The dialog renders its buttons from i18n keys ("Descartar" / common Cancel).
			confirmI18nKey: 'game.hand_discard',
			// The player ASKED to discard: land on the answer, Cancel is one Tab away.
			focusConfirm: true,
			onConfirm: () => {
				this.focus(); // back on the hand before the server repaints it
				this.deps!.onDiscard!(card);
			},
			onCancel: () => this.focus(),
		});
	}

	private tryDraw(): void {
		if (!this.deps?.onDraw) return; // automatic-refill family: no draw action at all
		const can = this.deps.canDraw?.() ?? { ok: true as const };
		if (!can.ok) {
			this.deps.announce(can.reason);
			return;
		}
		this.deps.onDraw();
	}

	private setSort(mode: string): void {
		this.sortMode = mode;
		this.savePreferences();
		this.update();
		const custom = this.customSorting()?.options.find(option => option.id === mode);
		this.deps!.announce(this.deps!.t(custom?.announcementKey ?? `game.hand_sorted_${mode}`));
	}

	private setPlayabilityMode(mode: PlayabilityMode): void {
		if (this.playabilityMode === mode) return;
		this.playabilityMode = mode;
		this.savePreferences();
		this.update();
		const all = this.deps!.getCards();
		if (mode === 'only') {
			this.deps!.announce(this.deps!.t('game.hand_filter_applied', {
				playable: all.filter(c => c.playable).length, total: all.length,
			}));
			return;
		}
		this.deps!.announce(this.deps!.t(mode === 'first'
			? 'game.hand_prioritize_playable_applied'
			: 'game.hand_show_all_applied'));
	}

	// ── Keyboard ──────────────────────────────────────────────────────────────

	/** The hand keys live NOW, for the shortcuts help — one row per wired affordance, in the
	 *  family's own words. The keys mirror onKeydown below (HAND_KEY is their single source);
	 *  a description is emitted only when its callback is wired, so the help lists exactly
	 *  what this hand can do. The card board appends its S / Shift+S status keys. */
	activeShortcuts(): HelpShortcut[] {
		const d = this.deps;
		if (!d) return [];
		const rows: HelpShortcut[] = [{ keys: HAND_KEY.play, descKey: d.shortcutText.play }];
		if (d.onDraw && d.shortcutText.draw) rows.push({ keys: HAND_KEY.draw, descKey: d.shortcutText.draw });
		if (d.onDiscard && d.shortcutText.discard) rows.push({ keys: HAND_KEY.discard, descKey: d.shortcutText.discard });
		if (d.multiSelect && d.shortcutText.multiSelect) rows.push({ keys: HAND_KEY.multiToggle, descKey: d.shortcutText.multiSelect });
		// Card help (Shift+F1) is listed whenever any card in hand carries help — every card
		// family provides it, but the row is honest about it being available right now.
		if (d.getCards().some(c => c.help)) rows.push({ keys: HAND_KEY.help, descKey: 'game.help_cmd_card_help' });
		return rows;
	}

	private onKeydown(e: KeyboardEvent): void {
		if (!this.deps) return;
		const target = e.target as HTMLElement | null;
		// Toolbar buttons and the context menu keep their native Enter/Space activation.
		if (target?.closest('button')) return;

		const item = target?.closest<HTMLElement>('.hand-card') ?? null;
		const card = item ? this.cardById(item.dataset.focusId) : null;

		// Shift+F1 reads the focused card's help (the F1-family "context help"): open it
		// straight from the card, no trip to the toolbar or the Shift+F10 menu.
		if (e.key === 'F1' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
			if (card?.help) {
				e.preventDefault();
				e.stopPropagation();
				this.showHelp(card);
			}
			return;
		}

		// These bindings ARE HAND_KEY / activeShortcuts() — keep the two in step.
		// stopPropagation as well as preventDefault: the global keymap binds these same keys
		// to board commands (Space = roll dice…) — a key the hand consumed must never ALSO
		// reach that layer, or drawing would fire a dice roll behind the player's back.
		if (e.key === ' ' || e.key === 'Spacebar') {
			e.preventDefault();
			e.stopPropagation();
			if (e.ctrlKey) {
				this.toggleModeByUser(); // Ctrl+Space flips single ↔ multi
				return;
			}
			if (this.isMulti()) {
				if (card) this.toggleMark(card); // in multi mode Space MARKS, never draws
				return;
			}
			this.tryDraw();
			return;
		}

		if (e.key === 'Enter') {
			if (this.isMulti()) {
				e.preventDefault();
				e.stopPropagation();
				this.sendMarked(); // Enter sends the SET, wherever focus sits
				return;
			}
			if (!card) return;
			e.preventDefault();
			e.stopPropagation();
			this.tryPlay(card);
			return;
		}
		if (e.key === 'Delete') {
			if (!card) return;
			e.preventDefault();
			e.stopPropagation();
			this.tryDiscard(card);
		}
	}

	private cardById(id: string | undefined): HandCard | null {
		if (!id || !this.deps) return null;
		return this.deps.getCards().find(c => c.id === id) ?? null;
	}

	// ── Preferences (survive reloads on this browser) ─────────────────────────

	/** An empty or malformed family declaration falls back to the proven generic orderings. */
	private customSorting(): HandSorting | null {
		const sorting = this.deps?.sorting;
		if (!sorting || sorting.options.length === 0) return null;
		return sorting.options.some(option => option.id === sorting.defaultId) ? sorting : null;
	}

	private preferencesKey(): string {
		const scope = this.customSorting()?.preferenceScope.trim();
		return scope ? `${PREFS_KEY}.${scope}` : PREFS_KEY;
	}

	private loadPreferences(): void {
		try {
			const raw = window.localStorage.getItem(this.preferencesKey());
			if (!raw) return;
			const prefs = JSON.parse(raw);
			const knownSort = typeof prefs.sort === 'string' && (this.customSorting()
				? this.customSorting()!.options.some(option => option.id === prefs.sort)
				: SORT_MODES.some(mode => mode === prefs.sort));
			if (knownSort) this.sortMode = prefs.sort;
			const knownPlayabilityMode = typeof prefs.playabilityMode === 'string'
				&& PLAYABILITY_MODES.some(mode => mode === prefs.playabilityMode);
			if (knownPlayabilityMode) {
				this.playabilityMode = prefs.playabilityMode;
			} else if (prefs.onlyPlayable === true) {
				// Legacy checkbox preferences could contain both flags. The narrower filter wins.
				this.playabilityMode = 'only';
			} else if (prefs.playableFirst === true) {
				this.playabilityMode = 'first';
			}
		} catch {
			// Unavailable/corrupted storage (private mode…): the defaults still work.
		}
	}

	private savePreferences(): void {
		try {
			window.localStorage.setItem(this.preferencesKey(),
				JSON.stringify({
					sort: this.sortMode,
					playabilityMode: this.playabilityMode,
				}));
		} catch {
			// Best effort: losing the preference never breaks the game.
		}
	}
}

export const handPanel = new HandPanel();
