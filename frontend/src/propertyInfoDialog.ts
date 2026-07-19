// propertyInfoDialog.ts — Accessible modal showing the full public information about a
// single board square: its colour group, price, owner, whole-group ownership, buildings,
// mortgage state and (for streets) the complete rent table. It is opened by clicking a
// board square or with the Shift+I shortcut on the cursor square. Read-only: in Corro
// every holding is public, so this can be opened for any square.
//
// Like the player-detail modal it is a native modal <dialog> (showModal) and the info
// rows reuse the shared roving-tabindex model (RovingToolbarList) so a screen reader voices
// each line on focus — essential under role="application", where there is no virtual cursor.

import { tSync, localizeColor } from './i18nBinder.js';
import type { Square, Player } from './models.js';
import { RovingToolbarList } from './accessibleList.js';
import { ownsWholeColorGroup } from './gameCommands.js';
import { squareGroupLabel } from './localizeSquare.js';
import { setAnnouncerHost } from './announcer.js';

const t = (key: string, vars?: Record<string, any>) => tSync(`game.${key}`, vars);

export interface PropertyInfoData {
	name: string;
	color?: string;
	/** The square's group name key (e.g. "game.color_brown", "groups.g1") — what we read to the
	 *  player ("Grupo: Marrón"). The colour is just its visual form and is shown, not spoken. */
	groupNameKey?: string;
	price?: number;
	/** The sum a tax square charges on landing (kept distinct from a purchase price). */
	amount?: number;
	rent?: number[];
	/** Board square type ("property" | "railroad" | "utility" | …), drives the rent block. */
	type?: string;
	/** Display name of the owner, or undefined when the square is unowned. */
	ownerName?: string;
	ownedByMe: boolean;
	/** True when the owner holds every square of this colour group. */
	ownsWholeGroup: boolean;
	smallBuildings: number;
	bigBuildings: number;
	mortgaged: boolean;
}

/** Railroad rent ladder by number of stations the owner holds (mirrors the server's
 *  CalculateRailroadRent: 1→25, 2→50, 3→100, 4→200). */
const RAILROAD_RENT = [25, 50, 100, 200];

/**
 * Project a board square into the read-only data the info modal renders. Returns null when
 * the index is out of range. Pure (no DOM/i18next) so it can be unit-tested directly.
 */
export function projectPropertyInfo(
	squares: Square[],
	index: number,
	players: Player[],
	myPlayerId: string | undefined | null
): PropertyInfoData | null {
	const s = squares[index];
	if (!s) return null;
	const owner = s.ownerId ? players.find(p => p.id === s.ownerId) : undefined;
	return {
		name: s.name,
		color: s.color,
		groupNameKey: s.groupNameKey,
		price: s.price,
		amount: s.amount,
		rent: s.rent,
		type: s.type,
		ownerName: s.ownerId ? (owner?.name ?? String(s.ownerId)) : undefined,
		ownedByMe: !!myPlayerId && s.ownerId === myPlayerId,
		ownsWholeGroup: ownsWholeColorGroup(squares, s.color, s.ownerId),
		smallBuildings: s.smallBuildings ?? 0,
		bigBuildings: s.bigBuildings ?? 0,
		mortgaged: !!s.mortgaged,
	};
}

/**
 * Build the ordered, accessible info lines for one square (colour, price, owner,
 * whole-group ownership, buildings, mortgage and the rent table). Pure so it can be
 * unit-tested without a DOM.
 */
export function propertyInfoLines(
	d: PropertyInfoData,
	translate: (k: string, v?: Record<string, any>) => string = t,
	// The group line ("Grupo: Marrón"), resolved from the square's group name key like the board
	// status does — so it works for hex-coloured package boards, not just the classic colour words.
	groupLabel: (d: Pick<PropertyInfoData, 'groupNameKey' | 'color'>) => string =
		(dd) => squareGroupLabel(dd, tSync, localizeColor)
): string[] {
	const lines: string[] = [];

	// A tax square isn't ownable: it has no colour/owner/rent, just the amount you pay on landing.
	if (d.type === 'tax') {
		if (typeof d.amount === 'number') lines.push(translate('property_info_tax', { price: d.amount }));
		return lines;
	}

	const group = groupLabel(d);
	if (group) lines.push(group);
	if (typeof d.price === 'number') lines.push(translate('property_info_price', { price: d.price }));

	if (d.ownerName) {
		lines.push(d.ownedByMe
			? translate('property_info_owner_self')
			: translate('property_info_owner', { owner: d.ownerName }));
		if (d.ownsWholeGroup) {
			lines.push(d.ownedByMe
				? translate('you_own_whole_group')
				: translate('property_info_group_owned', { owner: d.ownerName }));
		}
	} else if (typeof d.price === 'number') {
		lines.push(translate('property_info_unowned'));
	}

	if (d.bigBuildings > 0) lines.push(translate('hotel_label'));
	else if (d.smallBuildings > 0) lines.push(translate('houses_count', { count: d.smallBuildings }));

	if (d.mortgaged) lines.push(translate('mortgaged_label'));

	// Streets carry a rent array sized to the board's building tiers: base, one per small
	// construction, then the big one (so length = levels + 2). Railroads and utilities have no rent
	// array (their rent is computed dynamically), so we render their own ladders instead.
	const type = d.type?.toLowerCase();
	if (d.rent && d.rent.length > 0) {
		lines.push(translate('property_info_rent_base', { amount: d.rent[0] }));
		const last = d.rent.length - 1; // the big-construction rent
		for (let h = 1; h < last; h++) {
			lines.push(translate('property_info_rent_houses', { count: h, amount: d.rent[h] }));
		}
		if (last >= 1) lines.push(translate('property_info_rent_hotel', { amount: d.rent[last] }));
	} else if (type === 'railroad') {
		// Rent grows with the number of stations the owner holds (1→4), regardless of who
		// owns this one — it is public info a player weighs before buying or trading.
		RAILROAD_RENT.forEach((amount, i) =>
			lines.push(translate('property_info_rent_railroad', { count: i + 1, amount })));
	} else if (type === 'utility') {
		// Utility rent is a multiple of the tenant's dice throw: 4× with one utility, 10×
		// with both. There is no fixed amount, so describe the rule rather than a number.
		lines.push(translate('property_info_rent_utility_one'));
		lines.push(translate('property_info_rent_utility_both'));
	}

	if (lines.length === 0) lines.push(translate('property_info_no_details'));
	return lines;
}

export interface PropertyInfoDeps {
	getData: () => PropertyInfoData;
	/** Called after the dialog closes (to restore board focus). */
	onClose?: () => void;
	announce?: (text: string) => void;
}

class PropertyInfoDialog {
	private dialog: HTMLDialogElement | null = null;
	private deps: PropertyInfoDeps | null = null;
	private nav: RovingToolbarList | null = null;

	open(deps: PropertyInfoDeps): void {
		// Re-opening replaces any previous instance so the cursor square always wins.
		if (this.dialog) this.close();
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
		dialog.id = 'property-info-dialog';
		dialog.className = 'property-info-dialog';
		dialog.setAttribute('aria-labelledby', 'property-info-title');

		const surface = document.createElement('div');
		surface.className = 'property-info-application';
		surface.setAttribute('role', 'application');
		surface.setAttribute('aria-labelledby', 'property-info-title');

		const header = document.createElement('div');
		header.className = 'property-info-panel__header';
		const title = document.createElement('h2');
		title.id = 'property-info-title';
		title.className = 'property-info-panel__title';
		title.textContent = data.name;
		header.appendChild(title);
		surface.appendChild(header);

		// Each info line is a roving-tabindex stop so a screen reader voices it on focus.
		const list = document.createElement('ul');
		list.className = 'property-info-list';
		list.setAttribute('role', 'list');
		list.setAttribute('aria-labelledby', 'property-info-title');
		propertyInfoLines(data).forEach(text => {
			const li = document.createElement('li');
			li.className = 'property-info-item';
			li.setAttribute('role', 'listitem');
			li.tabIndex = -1;
			li.setAttribute('aria-label', text);
			const span = document.createElement('span');
			span.className = 'property-info-item__text';
			span.setAttribute('aria-hidden', 'true');
			span.textContent = text;
			li.appendChild(span);
			list.appendChild(li);
		});
		surface.appendChild(list);

		const footer = document.createElement('div');
		footer.className = 'property-info-panel__footer';
		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'property-info-panel__close';
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

		// The list shares the roving-tabindex keyboard model (arrow keys move between
		// lines); the rows carry no toolbar, so the selector below matches nothing.
		this.nav = new RovingToolbarList({
			list,
			itemSelector: '.property-info-item',
			toolbarButtonSelector: '.property-info-item button',
			menuLabel: () => data.name,
			menuClass: 'property-info-context-menu',
			menuItemClass: 'property-info-context-menu-item',
		});
		this.nav.refreshRovingTabindex();
		// Land on the first line (the top of the read order); the user then Tabs to Close.
		this.nav.focusItem(0);

		this.deps.announce?.(data.name);
	}
}

export const propertyInfoDialog = new PropertyInfoDialog();
