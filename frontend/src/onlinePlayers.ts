// onlinePlayers.ts — the list of who is connected.
//
// The same roster widget the table and the in-game players panel use (RovingToolbarList): one tab
// stop for the whole list, arrows between people, Right into a person's actions and Shift+F10 for
// the same actions as a menu. Deliberately the SAME thing to learn as the other two rosters —
// somebody who has met one has met all three.
//
// It shows a handle and a coarse activity, never a display name and never which table: the
// question this answers is "is anyone around, and can I interrupt them?", not "where are they".
//
// It is not a live region and does not poll. People arriving and leaving is a stream of changes
// nobody asked to be read; the list is a page you visit, refreshed when you arrive and by asking.

import { RovingToolbarList } from './accessibleList.js';
import { reconcileChildren } from './domReconcile.js';

/** One person, as the server publishes them. */
export interface OnlinePlayer {
	readonly handle: string;
	/** InLobby | AtTable | Playing — coarse on purpose. */
	readonly activity: string;
}

export interface OnlineListDeps {
	list: HTMLElement;
	empty: HTMLElement | null;
	error: HTMLElement | null;
	/** Already translated. `activity` keys map to one flowing line per person. */
	t: (key: string, vars?: Record<string, unknown>) => string;
	fetchImpl?: typeof fetch;
}

/** The three the server can report, mapped to the keys that word them. */
const ACTIVITY_KEYS: Record<string, string> = {
	InLobby: 'lobby.online.activityInLobby',
	AtTable: 'lobby.online.activityAtTable',
	Playing: 'lobby.online.activityPlaying',
};

/**
 * Read a payload defensively. Anything malformed is "nobody", which is the same safe outcome as an
 * empty room — the list is never worth an error message about a shape.
 */
export function parseOnlinePlayers(payload: unknown): OnlinePlayer[] {
	const players = (payload as { players?: unknown } | null)?.players;
	if (!Array.isArray(players)) return [];
	return players.flatMap(entry => {
		const handle = (entry as { handle?: unknown })?.handle;
		const activity = (entry as { activity?: unknown })?.activity;
		return typeof handle === 'string' && handle.length > 0 && typeof activity === 'string'
			? [{ handle, activity }]
			: [];
	});
}

/**
 * One person as a single flowing line: "@kastwey, playing." A screen reader reads the row, so the
 * name and what they are doing are one sentence rather than two facts glued together.
 */
export function describePlayer(
	player: OnlinePlayer,
	t: (key: string, vars?: Record<string, unknown>) => string,
): string {
	const key = ACTIVITY_KEYS[player.activity] ?? ACTIVITY_KEYS.InLobby;
	return t('lobby.online.row', { handle: player.handle, activity: t(key) });
}

export class OnlineList {
	private nav: RovingToolbarList | null = null;

	constructor(private readonly deps: OnlineListDeps) {}

	/** Ask the server and paint. Returns what was shown, which is what the tests assert. */
	async refresh(): Promise<OnlinePlayer[]> {
		const fetchImpl = this.deps.fetchImpl ?? fetch;
		let players: OnlinePlayer[] = [];
		let failed = false;
		try {
			const response = await fetchImpl('/api/presence/online');
			if (response.ok) players = parseOnlinePlayers(await response.json());
			else failed = true;
		} catch {
			failed = true;
		}

		this.render(players);
		if (this.deps.error) {
			// The only thing worth saying out loud here, and only when asking actually failed.
			this.deps.error.textContent = failed ? this.deps.t('lobby.online.failed') : '';
		}
		return players;
	}

	private render(players: readonly OnlinePlayer[]): void {
		reconcileChildren(this.deps.list, {
			items: [...players],
			key: player => player.handle.toLowerCase(),
			keyOf: element => (element as HTMLElement).dataset.handle?.toLowerCase(),
			create: player => {
				const row = document.createElement('li');
				row.className = 'online-player';
				row.tabIndex = -1;
				this.fill(row, player);
				return row;
			},
			update: (element, player) => this.fill(element as HTMLElement, player),
			// Somebody leaving while their row holds the keyboard hands focus on rather than
			// dropping the reader onto <body>.
			rescueFocus: () => this.deps.list.querySelector<HTMLElement>('.online-player'),
		});

		if (this.deps.empty) this.deps.empty.hidden = players.length > 0;
		this.ensureNav();
		this.nav?.refreshRovingTabindex();
	}

	private fill(row: HTMLElement, player: OnlinePlayer): void {
		row.dataset.handle = player.handle;
		const line = describePlayer(player, this.deps.t);
		if (row.textContent !== line) row.textContent = line;
		// The row's own label IS the line: nothing else in it speaks, so they cannot diverge.
		row.setAttribute('aria-label', line);
	}

	private ensureNav(): void {
		if (this.nav) return;
		this.nav = new RovingToolbarList({
			list: this.deps.list,
			itemSelector: '.online-player',
			// The actions themselves arrive with friendships and messaging; the widget already
			// knows how to carry them, and offers no menu while a row has none.
			toolbarButtonSelector: '.online-player__actions button',
			menuLabel: () => this.deps.t('lobby.online.menuLabel'),
			menuClass: 'player-context-menu',
			menuItemClass: 'player-context-menu-item',
			menuHost: () => document.getElementById('view-online'),
		});
	}

	/** Move the keyboard into the list. False when there is nobody to move to. */
	focusFirst(): boolean {
		return this.nav?.focusItem(0) ?? false;
	}
}
