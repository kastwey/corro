// friendRoster.ts — the roster shared by the two places people appear outside a game: the list of
// who is connected, and your own friends list.
//
// They ask different questions of the server and word their rows differently, but they ARE the same
// widget to a person using them: one tab stop, arrows between people, Right into a row's actions,
// Shift+F10 for the same actions as a menu — the third instance of the bargain the table roster and
// the in-game players panel already make. Somebody who has met one has met all of them, which only
// stays true if there is one implementation rather than two that drift.
//
// It renders and navigates. WHICH people are on it, what their line says and what acting on one
// does all belong to the surface.

import { RovingToolbarList } from './accessibleList.js';
import { reconcileChildren } from './domReconcile.js';
import { reconcileToolbarButtons, type ToolbarAction } from './toolbarButtons.js';

/** One person, reduced to what a roster needs: identity, a spoken line, and what to do about them. */
export interface RosterRow {
	/** Stable across refreshes, so the row a reader is standing on survives one. */
	key: string;
	/** The whole row as one flowing sentence. Also its accessible name. */
	line: string;
	/** Names the row's toolbar ("Actions for kastwey"). */
	actionsLabel: string;
	actions: ToolbarAction[];
	/**
	 * Whether this row is a PERSON. False for a summary row like "3 players you cannot see": a room
	 * whose only row is a count of people you cannot see is still an empty room, and saying so is
	 * the difference between "nobody is about" and "nobody is about that you can see".
	 */
	isPerson?: boolean;
}

export interface FriendRosterDeps {
	list: HTMLElement;
	/** Shown when there is nobody, hidden when there is somebody. */
	empty: HTMLElement | null;
	/** Hosts the row context menu — never <body>, which would leave it outside every landmark. */
	menuHost: () => HTMLElement | null;
	menuLabel: () => string;
	rowClass: string;
	buttonClass: string;
}

export class FriendRoster {
	private nav: RovingToolbarList | null = null;

	constructor(private readonly deps: FriendRosterDeps) {}

	render(rows: readonly RosterRow[]): void {
		reconcileChildren(this.deps.list, {
			items: [...rows],
			key: row => row.key.toLowerCase(),
			keyOf: element => (element as HTMLElement).dataset.rosterKey?.toLowerCase(),
			create: row => {
				const item = document.createElement('li');
				item.className = this.deps.rowClass;
				item.tabIndex = -1;
				const line = document.createElement('span');
				line.className = `${this.deps.rowClass}__line`;
				const actions = document.createElement('div');
				actions.className = `${this.deps.rowClass}__actions`;
				actions.setAttribute('role', 'toolbar');
				item.append(line, actions);
				this.fill(item, row);
				return item;
			},
			update: (element, row) => this.fill(element as HTMLElement, row),
			// Somebody leaving while their row holds the keyboard hands focus on rather than
			// dropping the reader onto <body>.
			rescueFocus: () => this.deps.list.querySelector<HTMLElement>(`.${this.deps.rowClass}`),
		});

		if (this.deps.empty) {
			this.deps.empty.hidden = rows.some(row => row.isPerson !== false);
		}
		this.ensureNav();
		this.nav?.refreshRovingTabindex();
	}

	private fill(item: HTMLElement, row: RosterRow): void {
		item.dataset.rosterKey = row.key;
		const line = item.querySelector<HTMLElement>(`.${this.deps.rowClass}__line`);
		if (line && line.textContent !== row.line) line.textContent = row.line;
		// The row's own label IS its line. The buttons inside name themselves, so what the row says
		// and what it shows cannot diverge.
		item.setAttribute('aria-label', row.line);

		const toolbar = item.querySelector<HTMLElement>(`.${this.deps.rowClass}__actions`);
		if (!toolbar) return;
		toolbar.setAttribute('aria-label', row.actionsLabel);
		reconcileToolbarButtons(toolbar, row.actions, {
			buttonClass: this.deps.buttonClass,
			keyAttr: 'friendAction',
			labelAsAriaLabel: true,
			rescueFocus: () => item,
		});
	}

	private ensureNav(): void {
		if (this.nav) return;
		this.nav = new RovingToolbarList({
			list: this.deps.list,
			itemSelector: `.${this.deps.rowClass}`,
			toolbarButtonSelector: `.${this.deps.rowClass}__actions button`,
			menuLabel: this.deps.menuLabel,
			menuClass: 'player-context-menu',
			menuItemClass: 'player-context-menu-item',
			menuHost: this.deps.menuHost,
		});
	}

	/** Move the keyboard into the list. False when there is nobody to move to. */
	focusFirst(): boolean {
		return this.nav?.focusItem(0) ?? false;
	}
}
