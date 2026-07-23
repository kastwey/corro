// playerPanel.ts — always-visible side panel listing every player's money,
// position and holding status. It is also the accessible, interactive players list:
// each player is a single roving-tabindex row with a per-row action toolbar
// (Information / Propose trade / Go to player) reached with Right arrow and
// mirrored by the Shift+F10 / Applications context menu — sharing the
// RovingToolbarList model with the notifications and manage-properties lists.
// Ctrl+P (and the F6 panel cycle) focuses the row of the player whose turn it is.

import { tokenIconHtml } from './tokenIcons.js';
import { tSync, money } from './i18nBinder.js';
import { RovingToolbarList } from './accessibleList.js';
import { reconcileChildren } from './domReconcile.js';
import { reconcileToolbarButtons, type ToolbarAction } from './toolbarButtons.js';
import type { Player, Square } from './models.js';

const t = (key: string, vars?: Record<string, any>) => tSync(`game.${key}`, vars);

export interface PlayerPanelDeps {
	getPlayers: () => Player[];
	getSquares: () => Square[];
	getCurrentTurnId: () => string | null | undefined;
	getMyId: () => string | null | undefined;
	/** Total pending debt the player still owes (0 when debt-free). */
	getTotalDebt: (playerId: string) => number;
	/** Non-property families: the player's BOARD identity — the race squadron/seat name,
	 *  the track piece name — or null on property boards. When present, the row shows this
	 *  identity instead of money (those families have no economy). */
	getBoardIdentity?: (playerId: string) => string | null;
	/** Whether the row offers "go to player". False in the race family: a player has
	 *  SEVERAL pieces there, so the jump has no single target (N / M cycle the pieces
	 *  instead). Defaults to true (property: the token; track: the one piece). */
	showGoToPlayer?: () => boolean;
	/** Whether the row offers "propose trade" at all. False for families with no economy
	 *  (race, track, journey). Defaults to true (property). */
	showTrade?: () => boolean;
	/** True when it is the local player's turn (gates the "Propose trade" action). */
	isMyTurn: () => boolean;
	/** Open the read-only player-detail modal. */
	onShowInfo: (playerId: string) => void;
	/** Open the trade builder pre-targeting this player. */
	onProposeTrade: (playerId: string) => void;
	/** Move the board navigation cursor to the player's square. */
	onGoToPlayer: (playerId: string) => void;
}

export class PlayerPanel {
	private container: HTMLElement | null = null;
	private list: HTMLElement | null = null;
	private deps: PlayerPanelDeps | null = null;
	private nav: RovingToolbarList | null = null;
	/** row -> its persistent child nodes, so a row's content is mutated, never rebuilt. */
	private readonly shells = new WeakMap<HTMLLIElement, CardRefs>();

	init(mount: HTMLElement, deps: PlayerPanelDeps): void {
		this.deps = deps;
		if (this.container) {
			this.update();
			return;
		}

		const aside = document.createElement('aside');
		aside.id = 'players-panel';
		aside.className = 'players-panel';
		aside.setAttribute('role', 'complementary');
		aside.setAttribute('aria-label', t('players_panel_title'));

		const title = document.createElement('h2');
		title.className = 'players-panel__title';
		title.textContent = t('players_panel_title');

		const list = document.createElement('ul');
		list.className = 'players-panel__list';
		list.setAttribute('role', 'list');

		aside.append(title, list);
		mount.appendChild(aside);

		this.container = aside;
		this.list = list;
		this.update();
	}

	/**
	 * Move keyboard focus into the panel, landing on the current player's row
	 * (fallback: the first row). Returns false if the panel has no rows yet.
	 */
	focus(): boolean {
		if (!this.nav || !this.deps) return false;
		const items = this.nav.getItems();
		if (items.length === 0) return false;
		const currentId = this.deps.getCurrentTurnId();
		let idx = items.findIndex(it => it.dataset.playerId === currentId);
		if (idx < 0) idx = 0;
		return this.nav.focusItem(idx);
	}

	update(): void {
		if (!this.list || !this.deps) return;
		const players = this.deps.getPlayers();
		const squares = this.deps.getSquares();
		const currentId = this.deps.getCurrentTurnId();
		const myId = this.deps.getMyId();

		// Reconcile rows by player id so a focused row (or one of its toolbar buttons)
		// survives every update — only the contents/labels that changed are touched.
		reconcileChildren(this.list, {
			items: players,
			key: p => p.id,
			keyOf: el => (el as HTMLElement).dataset.playerId,
			create: p => {
				const li = document.createElement('li');
				li.dataset.playerId = p.id;
				this.populateCard(li, p, squares, currentId, myId);
				return li;
			},
			update: (li, p) => this.populateCard(li as HTMLLIElement, p, squares, currentId, myId),
			// A whole row vanishing while focused (a player left the game) lands focus on
			// the first remaining row instead of <body>.
			rescueFocus: () => this.list!.querySelector<HTMLElement>('.player-card'),
		});

		this.ensureNav();
		this.nav?.refreshRovingTabindex();
	}

	private ensureNav(): void {
		if (this.nav || !this.list) return;
		this.nav = new RovingToolbarList({
			list: this.list,
			itemSelector: '.player-card',
			toolbarButtonSelector: '.player-card__actions button',
			menuLabel: () => t('player_menu_label'),
			menuClass: 'player-context-menu',
			menuItemClass: 'player-context-menu-item',
		});
	}

	private populateCard(
		li: HTMLLIElement,
		p: Player,
		squares: Square[],
		currentId: string | null | undefined,
		myId: string | null | undefined
	): void {
		const isMe = p.id === myId;
		const isCurrent = p.id === currentId;
		const squareName = squares[p.position]?.name ?? '';
		const debt = this.computeDebt(p);

		// Build the row's persistent skeleton ONCE; every later update mutates it in place
		// so a focused row — or a focused toolbar button — is never destroyed (which would
		// throw focus to <body> and drop a screen reader into browse mode). Each step below
		// touches only the parts that actually changed.
		const refs = this.ensureCardShell(li);
		this.updateIdentity(li, refs, p, isMe, isCurrent);
		this.updateMoney(refs, p, debt);
		this.updateMeta(refs, p, squareName);
		this.updateToolbar(li, refs, p, myId);
		this.updateRowLabel(li, p, { isMe, isCurrent, squareName, debt });
	}

	/** A player's debt position: whether they owe, their net balance, and any shortfall. */
	private computeDebt(p: Player): DebtInfo {
		const totalDebt = this.deps!.getTotalDebt(p.id);
		return { inDebt: totalDebt > 0, net: p.money - totalDebt, shortfall: Math.max(0, totalDebt - p.money) };
	}

	/** Row class/state, the decorative token chip, and the player name (+ "you" badge). */
	private updateIdentity(li: HTMLLIElement, refs: CardRefs, p: Player, isMe: boolean, isCurrent: boolean): void {
		const className = 'player-card' + (isCurrent ? ' is-current' : '') + (isMe ? ' is-me' : '');
		if (li.className !== className) li.className = className;
		if (isCurrent) li.setAttribute('aria-current', 'true');
		else li.removeAttribute('aria-current');
		if (li.tabIndex !== 0 && li.tabIndex !== -1) li.tabIndex = -1;

		// Token chip (decorative; accessible name comes from the row label).
		if (refs.token.dataset.token !== p.token) {
			refs.token.dataset.token = p.token;
			refs.token.innerHTML = tokenIconHtml(p.token);
		}
		const tokenBg = p.color ?? '';
		if (refs.token.style.background !== tokenBg) refs.token.style.background = tokenBg;

		if (refs.nameText.textContent !== p.name) refs.nameText.textContent = p.name;
		toggleChild(refs.name, refs.youRef, isMe, () => {
			const you = document.createElement('span');
			you.className = 'player-card__you';
			you.textContent = t('you_badge');
			refs.youRef = you;
			return you;
		}, () => { refs.youRef = null; });
		// A neutral visible badge on the row that holds the TURN. A die was misleading in
		// card families, which have no roll at all. Decorative: the row label already says it
		// and aria-current marks the row for assistive tech.
		toggleChild(refs.name, refs.turnRef, isCurrent, () => {
			const turn = document.createElement('span');
			turn.className = 'player-card__turn';
			turn.setAttribute('aria-hidden', 'true');
			turn.textContent = t('turn_badge');
			refs.turnRef = turn;
			return turn;
		}, () => { refs.turnRef = null; });
	}

	/**
	 * Money figure. A player in debt shows their NET balance (cash − total debt, normally
	 * negative) in a distinctive debt colour, so the panel never "lies" by showing a healthy
	 * positive figure while they actually owe money. It auto-corrects the moment the debt is
	 * cleared (the row re-renders from the next state update).
	 */
	private updateMoney(refs: CardRefs, p: Player, debt: DebtInfo): void {
		// Non-property families: no economy — the line carries the player's board identity
		// instead (squadron / piece name, marked with the player's colour), which is how announcements
		// refer to them on the board.
		const seatName = this.deps?.getBoardIdentity?.(p.id) ?? null;
		// An identity line can be LONG (the journey status): the row switches to a stacked
		// layout — name on top, identity on its own full-width line (see player-panel.css).
		refs.money.closest('.player-card')?.classList.toggle('player-card--seat', seatName !== null);
		if (seatName !== null) {
			if (refs.money.className !== 'player-card__money player-card__seat') {
				refs.money.className = 'player-card__money player-card__seat';
			}
			if (refs.money.textContent !== seatName) refs.money.textContent = seatName;
			const color = p.color ?? '';
			if (refs.money.style.getPropertyValue('--seat-color') !== color) {
				refs.money.style.setProperty('--seat-color', color);
			}
			refs.money.style.removeProperty('color');
			return;
		}
		refs.money.style.removeProperty('--seat-color');
		refs.money.style.removeProperty('color');
		const moneyClass = 'player-card__money' + (debt.inDebt ? ' player-card__money--debt' : '');
		if (refs.money.className !== moneyClass) refs.money.className = moneyClass;
		const moneyText = money(debt.inDebt ? debt.net : p.money);
		if (refs.money.textContent !== moneyText) refs.money.textContent = moneyText;
	}

	/** Meta row: board position plus optional holding and "get out of holding free" card tags. */
	private updateMeta(refs: CardRefs, p: Player, squareName: string): void {
		if (refs.pos.textContent !== squareName) refs.pos.textContent = squareName;
		// A player with no live connection is flagged so the table knows who they are
		// waiting for (the server flips isConnected on disconnect/rejoin and announces it).
		const offline = p.isConnected === false;
		const offlineText = offline ? t('disconnected_tag') : '';
		toggleTag(refs.meta, refs.offlineRef, offline, 'player-tag player-tag--offline', offlineText,
			(el) => { refs.offlineRef = el; }, () => { refs.offlineRef = null; });
		const bankruptText = p.isBankrupt ? t('bankrupt_tag') : '';
		toggleTag(refs.meta, refs.bankruptRef, !!p.isBankrupt, 'player-tag player-tag--bankrupt', bankruptText,
			(el) => { refs.bankruptRef = el; }, () => { refs.bankruptRef = null; });
		const holdingText = p.isHeld
			? ((p.holdingTurnsRemaining && p.holdingTurnsRemaining > 0)
				? t('holding_tag_turns', { turns: p.holdingTurnsRemaining })
				: t('holding_tag'))
			: '';
		toggleTag(refs.meta, refs.holdingRef, !!p.isHeld, 'player-tag player-tag--holding', holdingText,
			(el) => { refs.holdingRef = el; }, () => { refs.holdingRef = null; });
		const cardText = p.releasePasses > 0 ? t('release_pass_tag', { count: p.releasePasses }) : '';
		toggleTag(refs.meta, refs.cardRef, p.releasePasses > 0, 'player-tag player-tag--card', cardText,
			(el) => { refs.cardRef = el; }, () => { refs.cardRef = null; });
	}

	/**
	 * Per-row action toolbar (Right arrow / Shift+F10 mirror it). Reconciled by stable action
	 * key so survivors — including the focused button — keep their identity; a removed focused
	 * button lands focus back on its row.
	 */
	private updateToolbar(li: HTMLLIElement, refs: CardRefs, p: Player, myId: string | null | undefined): void {
		const toolbarLabel = t('actions_for', { name: p.name });
		if (refs.toolbar.getAttribute('aria-label') !== toolbarLabel) {
			refs.toolbar.setAttribute('aria-label', toolbarLabel);
		}
		const actions: ToolbarAction[] = [
			{ key: 'info', label: t('player_info_action'), onClick: () => this.deps!.onShowInfo(p.id) },
		];
		// No trade action for a bankrupt player (out of the game; the server rejects it
		// too) — nor in families without an economy to trade with (race, track, journey).
		if (this.deps!.showTrade?.() !== false && this.deps!.isMyTurn() && p.id !== myId && !p.isBankrupt) {
			actions.push({ key: 'trade', label: t('player_trade_action'), onClick: () => this.deps!.onProposeTrade(p.id) });
		}
		if (this.deps!.showGoToPlayer?.() !== false) {
			actions.push({ key: 'goto', label: t('player_goto_action'), onClick: () => this.deps!.onGoToPlayer(p.id) });
		}
		reconcileToolbarButtons(refs.toolbar, actions, {
			buttonClass: 'player-card__btn',
			keyAttr: 'action',
			labelAsAriaLabel: true,
			rescueFocus: () => li,
		});
	}

	/**
	 * Accessible summary read when a screen-reader user navigates the row. Only written when
	 * it actually changes, so an unrelated state update never makes JAWS re-read it.
	 */
	private updateRowLabel(li: HTMLLIElement, p: Player, ctx: RowLabelContext): void {
		const parts: string[] = [p.name];
		if (ctx.isMe) parts.push(t('you_badge'));
		if (ctx.isCurrent) parts.push(t('current_turn_label'));
		if (p.isConnected === false) parts.push(t('disconnected_tag'));
		if (p.isBankrupt) parts.push(t('bankrupt_tag'));
		const seatName = this.deps?.getBoardIdentity?.(p.id) ?? null;
		if (seatName !== null) {
			parts.push(seatName); // the squadron / piece IS the player's board identity
		} else {
			parts.push(ctx.debt.inDebt
				? t('panel_money_debt_label', { net: ctx.debt.net, short: ctx.debt.shortfall })
				: t('panel_money_label', { amount: p.money }));
		}
		if (ctx.squareName) parts.push(t('panel_position_label', { square: ctx.squareName }));
		if (p.isHeld) parts.push(t('holding_tag'));
		if (p.releasePasses > 0) parts.push(t('release_pass_tag', { count: p.releasePasses }));
		const ariaLabel = parts.join('. ');
		if (li.getAttribute('aria-label') !== ariaLabel) li.setAttribute('aria-label', ariaLabel);
	}

	/** Build (once) and return the persistent child nodes of a player row. */
	private ensureCardShell(li: HTMLLIElement): CardRefs {
		const cached = this.shells.get(li);
		if (cached) return cached;

		const token = document.createElement('span');
		token.className = 'player-card__token';
		token.setAttribute('aria-hidden', 'true');

		const name = document.createElement('div');
		name.className = 'player-card__name';
		const nameText = document.createElement('span');
		nameText.className = 'player-card__name-text';
		name.appendChild(nameText);

		const money = document.createElement('div');
		money.className = 'player-card__money';

		const meta = document.createElement('div');
		meta.className = 'player-card__meta';
		const pos = document.createElement('span');
		pos.className = 'player-card__pos';
		meta.appendChild(pos);

		const toolbar = document.createElement('div');
		toolbar.className = 'player-card__actions';
		toolbar.setAttribute('role', 'toolbar');

		li.append(token, name, money, meta, toolbar);
		const refs: CardRefs = { token, name, nameText, youRef: null, turnRef: null, money, meta, pos, offlineRef: null, bankruptRef: null, holdingRef: null, cardRef: null, toolbar };
		this.shells.set(li, refs);
		return refs;
	}
}

/** Context for {@link PlayerPanel.updateRowLabel}: the row's identity and money state. */
interface RowLabelContext {
	isMe: boolean;
	isCurrent: boolean;
	squareName: string;
	debt: DebtInfo;
}

/** A player's debt position: whether they owe, their net balance, and any shortfall. */
interface DebtInfo {
	inDebt: boolean;
	net: number;
	shortfall: number;
}

/** The persistent child nodes of a player row, reused across surgical updates. */
interface CardRefs {
	token: HTMLElement;
	name: HTMLElement;
	nameText: HTMLElement;
	youRef: HTMLElement | null;
	turnRef: HTMLElement | null;
	money: HTMLElement;
	meta: HTMLElement;
	pos: HTMLElement;
	offlineRef: HTMLElement | null;
	bankruptRef: HTMLElement | null;
	holdingRef: HTMLElement | null;
	cardRef: HTMLElement | null;
	toolbar: HTMLElement;
}

/** Add or remove an optional child of `parent`, creating it lazily on first need. */
function toggleChild(
	parent: HTMLElement,
	current: HTMLElement | null,
	present: boolean,
	create: () => HTMLElement,
	onRemove: () => void
): void {
	if (present && !current) parent.appendChild(create());
	else if (!present && current) { current.remove(); onRemove(); }
}

/** Add / update / remove an optional inline tag (holding, free-card) inside `parent`. */
function toggleTag(
	parent: HTMLElement,
	current: HTMLElement | null,
	present: boolean,
	className: string,
	text: string,
	onCreate: (el: HTMLElement) => void,
	onRemove: () => void
): void {
	if (present) {
		if (!current) {
			const el = document.createElement('span');
			el.className = className;
			el.textContent = text;
			parent.appendChild(el);
			onCreate(el);
		} else if (current.textContent !== text) {
			current.textContent = text;
		}
	} else if (current) {
		current.remove();
		onRemove();
	}
}

export const playerPanel = new PlayerPanel();
