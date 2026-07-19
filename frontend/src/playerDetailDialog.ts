// playerDetailDialog.ts — Accessible modal showing a single player's full public
// information: money, position, holding status, release-pass cards and every owned
// property with its buildings / mortgage state. In Corro all holdings are public,
// so this can be opened for any player from the players panel.
//
// The property list reuses the shared roving-tabindex model (RovingToolbarList) so it
// behaves like the notifications / manage-properties lists: Up/Down move between rows,
// each row's aria-label reads its full content. The rows are read-only (no per-row
// actions); the only action — "Propose trade" — lives in the footer and is shown only
// when it's my turn and the player is not me.

import { tSync, localizeColor } from './i18nBinder.js';
import type { Square } from './models.js';
import { groupDisplayName } from './localizeSquare.js';
import { RovingToolbarList } from './accessibleList.js';
import { setAnnouncerHost } from './announcer.js';

const t = (key: string, vars?: Record<string, any>) => tSync(`game.${key}`, vars);

export interface PlayerPropertyItem {
	index: number;
	name: string;
	color?: string;
	/** i18n key for the group name; resolved for the label instead of the raw hex colour. */
	groupNameKey?: string;
	smallBuildings: number;
	bigBuildings: number;
	mortgaged: boolean;
}

export interface PlayerDetailData {
	name: string;
	tokenName: string;
	money: number;
	positionName: string;
	held: boolean;
	releasePasses: number;
	isBankrupt: boolean;
	properties: PlayerPropertyItem[];
}

export interface PlayerDetailDeps {
	getData: () => PlayerDetailData;
	/** Show the "Propose trade" footer button (my turn and the player is not me). */
	canProposeTrade: boolean;
	onProposeTrade?: () => void;
	/** Called after the dialog closes (to restore board focus). */
	onClose?: () => void;
	announce?: (text: string) => void;
}

/**
 * Project a player's owned square indices into the read-only items the detail modal
 * renders. Unlike the manage dialog this keeps properties that carry buildings, since
 * the modal only *displays* state and never mutates it.
 *
 * The result is grouped by colour: colour groups appear in the order they first occur on
 * the board, with board order preserved inside each group, and squares with no colour
 * group (railroads, utilities) listed last in board order. This reads "colour set by
 * colour set" rather than by the raw ownership order, which a player perceives as random.
 */
export function projectPlayerProperties(squares: Square[], indices: number[]): PlayerPropertyItem[] {
	const items: PlayerPropertyItem[] = [];
	indices.forEach((i) => {
		const s = squares[i];
		if (!s) return;
		items.push({
			index: i,
			name: s.name,
			color: s.color,
			groupNameKey: s.groupNameKey,
			smallBuildings: s.smallBuildings ?? 0,
			bigBuildings: s.bigBuildings ?? 0,
			mortgaged: !!s.mortgaged,
		});
	});
	// Rank each colour by where it first appears on the board so groups sort in board
	// order; colourless squares sort after every coloured group.
	const colorRank = new Map<string, number>();
	squares.forEach((s, idx) => {
		if (s.color && !colorRank.has(s.color)) colorRank.set(s.color, idx);
	});
	const rankOf = (color?: string) =>
		color && colorRank.has(color) ? colorRank.get(color)! : Number.MAX_SAFE_INTEGER;
	items.sort((a, b) => rankOf(a.color) - rankOf(b.color) || a.index - b.index);
	return items;
}

/** Accessible label for one property row (name, colour group, buildings, mortgage). */
export function playerPropertyLabel(
	p: PlayerPropertyItem,
	translate: (k: string, v?: Record<string, any>) => string = t,
	groupLabel: (p: Pick<PlayerPropertyItem, 'groupNameKey' | 'color'>) => string =
		(pp) => groupDisplayName(pp, tSync, localizeColor)
): string {
	const parts: string[] = [p.name];
	const group = groupLabel(p);
	if (group) parts.push(group);
	if (p.bigBuildings > 0) parts.push(translate('manage_state_hotel'));
	else if (p.smallBuildings > 0) parts.push(translate('manage_state_houses', { count: p.smallBuildings }));
	if (p.mortgaged) parts.push(translate('manage_state_mortgaged'));
	return parts.join('. ');
}

class PlayerDetailDialog {
	private dialog: HTMLDialogElement | null = null;
	private deps: PlayerDetailDeps | null = null;
	private nav: RovingToolbarList | null = null;
	private summaryNav: RovingToolbarList | null = null;

	open(deps: PlayerDetailDeps): void {
		this.deps = deps;
		this.render();
	}

	isOpen(): boolean {
		return this.dialog !== null;
	}

	close(): void {
		if (!this.dialog) return;
		this.nav?.destroy();
		this.nav = null;
		this.summaryNav?.destroy();
		this.summaryNav = null;
		try { this.dialog.close(); } catch (e) { this.dialog.removeAttribute('open'); }
		setAnnouncerHost(null);
		this.dialog.remove();
		this.dialog = null;
		const onClose = this.deps?.onClose;
		this.deps = null;
		onClose?.();
	}

	private render(): void {
		if (!this.deps) return;
		const data = this.deps.getData();

		const dialog = document.createElement('dialog');
		dialog.id = 'player-detail-dialog';
		dialog.className = 'player-detail-dialog';
		dialog.setAttribute('aria-labelledby', 'player-detail-title');

		const surface = document.createElement('div');
		surface.className = 'player-detail-application';
		surface.setAttribute('role', 'application');
		surface.setAttribute('aria-labelledby', 'player-detail-title');

		const header = document.createElement('div');
		header.className = 'player-detail-panel__header';
		const title = document.createElement('h2');
		title.id = 'player-detail-title';
		title.className = 'player-detail-panel__title';
		title.textContent = t('player_detail_title', { name: data.name });
		header.appendChild(title);
		surface.appendChild(header);

		// Player summary (money, position, holding status, release-pass cards). Read-only, but
		// each line is a roving-tabindex stop so a screen reader voices it on focus —
		// essential under role="application", where there is no virtual cursor to browse.
		const summary = document.createElement('ul');
		summary.className = 'player-detail-summary';
		summary.setAttribute('role', 'list');
		const addLine = (text: string) => {
			const li = document.createElement('li');
			li.className = 'player-detail-summary__line';
			li.setAttribute('role', 'listitem');
			li.tabIndex = -1;
			li.setAttribute('aria-label', text);
			const span = document.createElement('span');
			span.className = 'player-detail-summary__text';
			span.setAttribute('aria-hidden', 'true');
			span.textContent = text;
			li.appendChild(span);
			summary.appendChild(li);
		};
		addLine(t('player_detail_token', { token: data.tokenName }));
		if (data.isBankrupt) addLine(t('player_detail_bankrupt'));
		addLine(t('player_detail_money', { amount: data.money }));
		if (data.positionName) addLine(t('player_detail_position', { square: data.positionName }));
		if (data.held) addLine(t('player_detail_held'));
		if (data.releasePasses > 0) addLine(t('player_detail_release_passes', { count: data.releasePasses }));
		surface.appendChild(summary);

		const propsHeading = document.createElement('h3');
		propsHeading.className = 'player-detail-panel__subtitle';
		propsHeading.id = 'player-detail-props-title';
		propsHeading.textContent = t('player_detail_properties_label');
		surface.appendChild(propsHeading);

		let listEl: HTMLElement | null = null;
		if (data.properties.length === 0) {
			const empty = document.createElement('p');
			empty.className = 'player-detail-panel__empty';
			// Focusable so it is reachable under role="application" (no virtual cursor).
			empty.tabIndex = 0;
			empty.textContent = t('player_detail_no_properties');
			surface.appendChild(empty);
		} else {
			const list = document.createElement('ul');
			list.className = 'player-detail-list';
			list.setAttribute('role', 'list');
			list.setAttribute('aria-labelledby', 'player-detail-props-title');
			data.properties.forEach(p => list.appendChild(this.renderProperty(p)));
			surface.appendChild(list);
			listEl = list;
		}

		const footer = document.createElement('div');
		footer.className = 'player-detail-panel__footer';
		if (this.deps.canProposeTrade) {
			const tradeBtn = document.createElement('button');
			tradeBtn.type = 'button';
			tradeBtn.className = 'player-detail-panel__trade';
			tradeBtn.textContent = t('player_detail_propose_trade');
			tradeBtn.addEventListener('click', () => {
				const onProposeTrade = this.deps?.onProposeTrade;
				this.close();
				onProposeTrade?.();
			});
			footer.appendChild(tradeBtn);
		}
		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'player-detail-panel__close';
		closeBtn.textContent = t('player_detail_close');
		closeBtn.addEventListener('click', () => this.close());
		footer.appendChild(closeBtn);
		surface.appendChild(footer);
		dialog.appendChild(surface);

		dialog.addEventListener('keydown', (ev) => {
			if (ev.key === 'Escape') {
				ev.preventDefault();
				this.close();
			}
		});

		document.body.appendChild(dialog);
		if (typeof (dialog as any).showModal === 'function') (dialog as any).showModal();
		else dialog.setAttribute('open', 'true');
		this.dialog = dialog;
		// A modal dialog makes the rest of the page inert, silencing the announcer's live
		// region in <body>; host it inside the dialog while it is open.
		setAnnouncerHost(dialog);

		// The property list shares the roving-tabindex keyboard model; the rows carry no
		// toolbar, so Right / Shift+F10 are no-ops (the list is purely informational).
		this.nav = listEl
			? new RovingToolbarList({
				list: listEl,
				itemSelector: '.player-detail-item',
				toolbarButtonSelector: '.player-detail-item__actions button',
				menuLabel: () => t('player_detail_properties_label'),
				menuClass: 'player-detail-context-menu',
				menuItemClass: 'player-detail-context-menu-item',
			})
			: null;
		// Each list keeps exactly one tab stop so Tab walks summary → properties → footer.
		this.nav?.refreshRovingTabindex();

		// The summary lines reuse the same model (arrow keys move between them); they have
		// no toolbar either, so the selector below intentionally matches nothing.
		this.summaryNav = new RovingToolbarList({
			list: summary,
			itemSelector: '.player-detail-summary__line',
			toolbarButtonSelector: '.player-detail-summary__line button',
			menuLabel: () => t('player_detail_title', { name: data.name }),
			menuClass: 'player-detail-context-menu',
			menuItemClass: 'player-detail-context-menu-item',
		});
		this.summaryNav.refreshRovingTabindex();

		// Land on the first summary line (the top of the read order); the user then Tabs
		// down to the property list and the footer buttons.
		this.summaryNav.focusItem(0);

		this.deps.announce?.(t('player_detail_title', { name: data.name }));
	}

	private renderProperty(p: PlayerPropertyItem): HTMLLIElement {
		const item = document.createElement('li');
		item.className = 'player-detail-item';
		item.setAttribute('role', 'listitem');
		item.tabIndex = -1;

		item.setAttribute('aria-label', playerPropertyLabel(p));

		const name = document.createElement('span');
		name.className = 'player-detail-item__name';
		name.setAttribute('aria-hidden', 'true');
		name.textContent = playerPropertyLabel(p);
		item.appendChild(name);

		return item;
	}
}

export const playerDetailDialog = new PlayerDetailDialog();
