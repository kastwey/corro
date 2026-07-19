// managePropertiesDialog.ts — Accessible dialog that lets a player manage their
// owned properties outside of a forced debt situation: build / sell houses and
// mortgage / lift mortgages. The server is authoritative and validates every
// action (classic ownership, even-build rule, building shortage, etc.), so this
// dialog simply offers the contextually plausible actions and relies on the
// server to reject invalid ones with a spoken error.

import { tSync, localizeColor } from './i18nBinder.js';
import type { Square } from './models.js';
import { groupDisplayName } from './localizeSquare.js';
import { RovingToolbarList } from './accessibleList.js';
import { reconcileChildren } from './domReconcile.js';
import { reconcileToolbarButtons, type ToolbarAction } from './toolbarButtons.js';
import { setAnnouncerHost } from './announcer.js';

const t = (key: string, vars?: Record<string, any>) => tSync(`game.${key}`, vars);

/**
 * Fraction of a property's face value the bank pays to mortgage it (a fixed
 * Corro rule that mirrors the server's `MortgageRate`). Used only for the
 * dialog's display hint; the server stays authoritative for the actual amount.
 */
export const MORTGAGE_RATE = 0.5;

export interface ManageablePropertyItem {
	index: number;
	name: string;
	/** Colour group of the property, when it has one (railroads/utilities don't). */
	color?: string;
	/** i18n key for the group name; resolved for the accessible label instead of the raw hex colour. */
	groupNameKey?: string;
	smallBuildings: number;
	bigBuildings: number;
	mortgaged: boolean;
	housePrice: number;
	mortgageValue: number;
	/** Face/purchase price of the property, read so the owner can gauge its trade value. */
	price: number;
	/** Building requires a full color group; the caller resolves this. */
	canBuild: boolean;
	/**
	 * True when ANY lot in this property's colour group still has a building. Officially every
	 * building in the group must be sold first, so the lot can't be mortgaged while this holds —
	 * even if this particular lot is already building-free.
	 */
	groupHasBuildings: boolean;
}

export interface ManagePropertiesDeps {
	getProperties: () => ManageablePropertyItem[];
	onBuild: (index: number) => void;
	onSell: (index: number) => void;
	onMortgage: (index: number) => void;
	onUnmortgage: (index: number) => void;
	/** Called after the dialog closes (to restore board focus). */
	onClose?: () => void;
	announce?: (text: string) => void;
}

/**
 * Project a player's owned squares into the items the manage dialog renders.
 * Reads the fields the server actually sends (`buildingCost`, `price`) and derives
 * the mortgage value locally, because the server does not include a per-square
 * mortgage value in the board state. `canBuild` is true only for a full colour
 * group; the server still enforces the remaining build rules.
 */
export function buildManageableProperties(squares: Square[], myIndices: Set<number>): ManageablePropertyItem[] {
	const groupTotal = new Map<string, number>();
	const groupMine = new Map<string, number>();
	const groupBuilt = new Map<string, boolean>();
	const groupMortgaged = new Map<string, boolean>();
	const groupMinLevel = new Map<string, number>();
	const level = (s: Square) => (s.smallBuildings ?? 0) + (s.bigBuildings ?? 0) * 5;
	squares.forEach((s, i) => {
		if (!s.color) return;
		groupTotal.set(s.color, (groupTotal.get(s.color) ?? 0) + 1);
		if (myIndices.has(i)) groupMine.set(s.color, (groupMine.get(s.color) ?? 0) + 1);
		if (level(s) > 0) groupBuilt.set(s.color, true);
		if (s.mortgaged) groupMortgaged.set(s.color, true);
		groupMinLevel.set(s.color, Math.min(groupMinLevel.get(s.color) ?? Number.POSITIVE_INFINITY, level(s)));
	});

	const items: ManageablePropertyItem[] = [];
	squares.forEach((s, i) => {
		if (!myIndices.has(i)) return;
		const color = s.color;
		const ownsGroup = !!color && groupTotal.get(color) === groupMine.get(color);
		const housePrice = s.buildingCost ?? 0;
		// Build is legal (so the menu OFFERS it — inapplicable actions are hidden, matching the
		// mortgage rule below) only on a group I own outright, house-buildable, with NO mortgaged
		// lot in the group, and building EVENLY: this lot must be among the least-built, so a house
		// here never opens a >1 gap. The server enforces the same, but computing it here means the
		// action simply isn't shown rather than shown-and-rejected.
		const groupClear = !!color && !(groupMortgaged.get(color) ?? false);
		const isLeastBuilt = !!color && level(s) === (groupMinLevel.get(color) ?? 0);
		items.push({
			index: i,
			name: s.name,
			color: s.color,
			groupNameKey: s.groupNameKey,
			smallBuildings: s.smallBuildings ?? 0,
			bigBuildings: s.bigBuildings ?? 0,
			mortgaged: !!s.mortgaged,
			housePrice,
			mortgageValue: Math.floor((s.price ?? 0) * MORTGAGE_RATE),
			price: s.price ?? 0,
			canBuild: ownsGroup && housePrice > 0 && groupClear && isLeastBuilt,
			groupHasBuildings: !!color && (groupBuilt.get(color) ?? false),
		});
	});
	return items;
}

class ManagePropertiesDialog {
	private dialog: HTMLDialogElement | null = null;
	private panel: HTMLElement | null = null;
	private listEl: HTMLUListElement | null = null;
	private emptyEl: HTMLElement | null = null;
	private deps: ManagePropertiesDeps | null = null;
	private nav: RovingToolbarList | null = null;

	open(deps: ManagePropertiesDeps): void {
		this.deps = deps;
		this.build();
		this.reconcile(true);
		this.deps.announce?.(t('manage_title'));
	}

	isOpen(): boolean {
		return this.dialog !== null;
	}

	/**
	 * Surgically refresh the list in place (e.g. after the server confirms a build /
	 * sell / mortgage) WITHOUT tearing down the modal. Rows, buttons and the roving
	 * tabindex survive, so the focused control keeps focus and a screen reader is not
	 * thrown back to the top of the dialog — only what actually changed is touched.
	 */
	refresh(): void {
		if (this.dialog) this.reconcile(false);
	}

	close(): void {
		if (!this.dialog) return;
		this.nav?.destroy();
		this.nav = null;
		if (this.dialog.open) this.dialog.close();
		setAnnouncerHost(null);
		this.dialog.remove();
		this.dialog = null;
		this.panel = null;
		this.listEl = null;
		this.emptyEl = null;
		const onClose = this.deps?.onClose;
		this.deps = null;
		onClose?.();
	}

	/**
	 * Build the dialog skeleton ONCE: a native modal &lt;dialog&gt; whose ::backdrop dims
	 * the board and makes the rest of the page inert, with the page-level focus trap still
	 * scoping to it. The list is created empty here; {@link reconcile} fills and updates it.
	 */
	private build(): void {
		const dialog = document.createElement('dialog');
		dialog.className = 'manage-dialog';
		dialog.setAttribute('aria-labelledby', 'manage-title');

		const panel = document.createElement('div');
		panel.className = 'manage-panel';
		// The native dialog keeps its implicit role. Only the keyboard-intensive surface enters
		// application mode, so arrows reach the roving rows and their toolbars.
		panel.setAttribute('role', 'application');
		panel.setAttribute('aria-labelledby', 'manage-title');

		const header = document.createElement('div');
		header.className = 'manage-panel__header';
		const title = document.createElement('h2');
		title.id = 'manage-title';
		title.className = 'manage-panel__title';
		title.textContent = t('manage_title');
		header.appendChild(title);
		panel.appendChild(header);

		const empty = document.createElement('p');
		empty.className = 'manage-panel__empty';
		// Focusable so it is reachable inside the application surface (no virtual cursor).
		empty.tabIndex = 0;
		empty.textContent = t('manage_no_properties');
		empty.hidden = true;
		panel.appendChild(empty);

		const list = document.createElement('ul');
		list.className = 'manage-list';
		list.setAttribute('role', 'list');
		list.setAttribute('aria-label', t('manage_list_label'));
		panel.appendChild(list);

		const footer = document.createElement('div');
		footer.className = 'manage-panel__footer';
		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'manage-panel__close';
		closeBtn.dataset.focusId = 'close';
		closeBtn.textContent = t('manage_close');
		closeBtn.addEventListener('click', () => this.close());
		footer.appendChild(closeBtn);
		panel.appendChild(footer);

		dialog.appendChild(panel);
		// Escape fires `cancel` on a modal dialog; own the teardown so nav/listeners are
		// cleaned up and onClose runs (preventDefault stops the UA's bare close()).
		dialog.addEventListener('cancel', (ev) => {
			ev.preventDefault();
			this.close();
		});

		document.body.appendChild(dialog);
		this.dialog = dialog;
		this.panel = panel;
		this.listEl = list;
		this.emptyEl = empty;
		dialog.showModal();
		// A modal dialog makes the rest of the page inert, so the announcer's live region
		// (in <body>) would be silenced. Host it inside the dialog while it is open.
		setAnnouncerHost(dialog);

		// Wire the shared roving-tabindex / toolbar / context-menu keyboard model once;
		// it reads its items live from the list, so reconciling rows keeps it working.
		this.nav = new RovingToolbarList({
			list,
			itemSelector: '.manage-item',
			toolbarButtonSelector: '.manage-item__actions button',
			menuLabel: () => t('manage_menu_label'),
			menuClass: 'manage-context-menu',
			menuItemClass: 'manage-context-menu-item',
			// This dialog is modal, so <body> is inert; host the context menu inside the
			// dialog or Shift+F10 / right-click / Applications key would open an unreachable
			// menu (bug #12).
			menuHost: () => this.dialog,
		});
	}

	/**
	 * Reconcile the list against the current properties: update surviving rows/buttons in
	 * place, add the new, remove the gone, reorder to match — never rebuilding a row that
	 * survives. Focus is preserved: if the control that had focus disappears (e.g. the
	 * "mortgage" button becomes "unmortgage"), focus lands back on its row rather than
	 * being lost to &lt;body&gt; (which drops JAWS into browse mode).
	 */
	private reconcile(initialFocus: boolean): void {
		if (!this.deps || !this.listEl) return;
		const properties = this.deps.getProperties();

		const active = document.activeElement as HTMLElement | null;
		const activeWasInList = !!active && this.listEl.contains(active);
		const activeOwnerId = activeWasInList
			? (active!.closest('.manage-item') as HTMLElement | null)?.dataset.focusId ?? null
			: null;

		const isEmpty = properties.length === 0;
		if (this.emptyEl) this.emptyEl.hidden = !isEmpty;
		this.listEl.hidden = isEmpty;

		reconcileChildren(this.listEl, {
			items: properties,
			key: p => `item-${p.index}`,
			keyOf: el => (el as HTMLElement).dataset.focusId,
			create: p => this.createRow(p),
			update: (li, p) => this.updateRow(li as HTMLLIElement, p),
			// If the focused control disappeared (e.g. "mortgage" became "unmortgage"),
			// land focus back on its owning row — never <body> (which drops JAWS into
			// browse mode). Falls back to the first row, then the close button.
			rescueFocus: () => this.rescueListFocus(activeOwnerId),
		});

		this.nav?.refreshRovingTabindex();

		if (initialFocus) {
			// Focus the first row (so a screen reader reads it), else the close button.
			if (!this.nav?.focusItem(0)) {
				this.panel?.querySelector<HTMLElement>('.manage-panel__close')?.focus();
			}
		}
	}

	/** Pick where focus lands when a focused control is removed during a refresh. */
	private rescueListFocus(ownerId: string | null): HTMLElement | null {
		if (!this.listEl) return null;
		const owner = ownerId
			? Array.from(this.listEl.querySelectorAll<HTMLElement>('.manage-item'))
				.find(li => li.dataset.focusId === ownerId) ?? null
			: null;
		if (owner) {
			const items = this.nav?.getItems() ?? [];
			this.nav?.setRovingItem(items, items.indexOf(owner));
			return owner;
		}
		const first = this.nav?.getItems()[0] ?? null;
		if (first) {
			this.nav?.setRovingItem(this.nav.getItems(), 0);
			return first;
		}
		return this.panel?.querySelector<HTMLElement>('.manage-panel__close') ?? null;
	}

	/** Create a fresh property row (shell + content) keyed by its square index. */
	private createRow(p: ManageablePropertyItem): HTMLLIElement {
		const item = document.createElement('li');
		item.className = 'manage-item';
		item.setAttribute('role', 'listitem');
		item.tabIndex = -1;
		item.dataset.focusId = `item-${p.index}`;

		const name = document.createElement('span');
		name.className = 'manage-item__name';
		name.setAttribute('aria-hidden', 'true');
		item.appendChild(name);

		const actions = document.createElement('div');
		actions.className = 'manage-item__actions';
		actions.setAttribute('role', 'toolbar');
		item.appendChild(actions);

		this.updateRow(item, p);
		return item;
	}

	/** Update an existing row in place: only touch attributes/text/buttons that changed. */
	private updateRow(item: HTMLLIElement, p: ManageablePropertyItem): void {
		const stateParts: string[] = [];
		if (p.bigBuildings > 0) stateParts.push(t('manage_state_hotel'));
		else if (p.smallBuildings > 0) stateParts.push(t('manage_state_houses', { count: p.smallBuildings }));
		if (p.mortgaged) stateParts.push(t('manage_state_mortgaged'));

		// The colour group is gameplay-relevant (it's what enables building), so read it
		// right after the name. Railroads/utilities have no colour and are skipped.
		const colorLabel = groupDisplayName(p, tSync, localizeColor);
		// The face price is read so a player can gauge a property's worth when negotiating.
		const priceLabel = p.price > 0 ? t('manage_sale_price', { price: p.price }) : '';

		// The whole row is one roving-tabindex stop whose aria-label reads the property
		// name, colour and state; the visible label is aria-hidden to avoid a double read.
		// Only write the aria-label when it actually changed so a refresh doesn't make a
		// screen reader re-read an unchanged row.
		const ariaLabel = [p.name, colorLabel, priceLabel, ...stateParts].filter(Boolean).join('. ');
		if (item.getAttribute('aria-label') !== ariaLabel) item.setAttribute('aria-label', ariaLabel);

		const name = item.querySelector('.manage-item__name') as HTMLElement;
		const visibleExtras = [colorLabel, priceLabel, ...stateParts].filter(Boolean);
		const nameText = `${p.name}${visibleExtras.length ? ` (${visibleExtras.join(', ')})` : ''}`;
		if (name.textContent !== nameText) name.textContent = nameText;

		const actions = item.querySelector('.manage-item__actions') as HTMLElement;
		const actionsLabel = t('actions_for', { name: p.name });
		if (actions.getAttribute('aria-label') !== actionsLabel) actions.setAttribute('aria-label', actionsLabel);

		// keyAttr 'focusId' keeps each button's data-focus-id (build-N, mortgage-N, …). A
		// removed focused button is rescued by the row-level reconcile (rescueListFocus),
		// which lands focus on the owning row — so no per-button rescue is needed here.
		reconcileToolbarButtons(actions, this.actionSpecs(p), {
			buttonClass: 'manage-item__btn',
			keyAttr: 'focusId',
		});
	}

	/** The contextually plausible actions for a property (server stays authoritative). */
	private actionSpecs(p: ManageablePropertyItem): ToolbarAction[] {
		const specs: ToolbarAction[] = [];
		if (p.mortgaged) {
			specs.push({
				key: `unmortgage-${p.index}`,
				label: t('manage_unmortgage', { value: Math.ceil(p.mortgageValue * 1.1) }),
				onClick: () => this.deps?.onUnmortgage(p.index),
			});
		} else {
			if (p.canBuild && p.housePrice > 0 && p.bigBuildings === 0) {
				specs.push({
					key: `build-${p.index}`,
					label: t('manage_build', { price: p.housePrice }),
					onClick: () => this.deps?.onBuild(p.index),
				});
			}
			if (p.smallBuildings > 0 || p.bigBuildings > 0) {
				specs.push({
					key: `sell-${p.index}`,
					label: t('manage_sell', { value: Math.floor(p.housePrice / 2) }),
					onClick: () => this.deps?.onSell(p.index),
				});
			}
			// Official rule: a lot can be mortgaged only when NO building stands on ANY lot of its
			// colour group, so hide the action while a group-mate is still built (the server agrees).
			if (p.smallBuildings === 0 && p.bigBuildings === 0 && !p.groupHasBuildings) {
				specs.push({
					key: `mortgage-${p.index}`,
					label: t('manage_mortgage', { value: p.mortgageValue }),
					onClick: () => this.deps?.onMortgage(p.index),
				});
			}
		}
		return specs;
	}
}

export const managePropertiesDialog = new ManagePropertiesDialog();
