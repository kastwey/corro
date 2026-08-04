// friendsList.ts — your own friends, and the requests waiting for an answer.
//
// The same roster as the list of who is connected (friendRoster.ts), asking a different question.
// It has to exist separately from that one because a request must be answerable whether or not the
// person who sent it happens to be online — otherwise saying yes would mean waiting for them to
// come back.
//
// One list rather than three sections. Requests waiting on you sort to the top, because they are the
// only rows with something to do; everything below is people, in one alphabet. A reader arrows down
// it once and hears where each person stands, rather than having to find their way between three
// headings to learn that nobody has written.

import { FriendRoster } from './friendRoster.js';
import {
	actionLabel,
	actionsFor,
	fetchFriends,
	performFriendAction,
	relationshipText,
	resultText,
	type FriendActionKey,
	type FriendEntry,
	type Relationship,
	type Translate,
} from './friends.js';

export interface FriendsListDeps {
	/** The people tab's list, and the tab of things to answer. */
	list: HTMLElement;
	empty: HTMLElement | null;
	requestsList?: HTMLElement | null;
	requestsEmpty?: HTMLElement | null;
	/** Where the outcome of the reader's own action is said, once. */
	status?: HTMLElement | null;
	t: Translate;
	fetchImpl?: typeof fetch;
	/** Start writing to somebody: hands the lobby's message box their name. */
	writeTo?: (handle: string) => void;
	/** Ask a friend to be let into the table they are at. Absent when nothing can be asked. */
	askToJoin?: (gameId: string, handle: string) => Promise<void>;
	/**
	 * Called after EVERY read, including the one that follows answering something. The count in the
	 * requests tab's name lives outside this list, and setting it only when the view opens leaves it
	 * claiming somebody is waiting seconds after they were answered.
	 */
	onRefreshed?: (entries: FriendEntry[]) => void;
}

/** Requests waiting on the reader first; everyone else alphabetically. */
const RANK: Record<Relationship, number> = {
	RequestReceived: 0,
	Friends: 1,
	RequestSent: 2,
	None: 3,
	Self: 4,
};

export function sortFriends(entries: readonly FriendEntry[]): FriendEntry[] {
	return [...entries].sort((a, b) =>
		RANK[a.relationship] - RANK[b.relationship]
		|| a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' }));
}

/**
 * The two tabs, split.
 *
 * People you are something to go in one; things waiting on an answer go in the other. A request
 * you SENT belongs with the people — it is somebody you are waiting on, not something to answer —
 * which is the distinction the two tabs exist to make.
 */
export function splitForTabs(entries: readonly FriendEntry[]): {
	people: FriendEntry[];
	requests: FriendEntry[];
} {
	const sorted = sortFriends(entries);
	return {
		people: sorted.filter(entry => entry.relationship !== 'RequestReceived'),
		requests: sorted.filter(entry => entry.relationship === 'RequestReceived'),
	};
}

/**
 * One person as a single flowing line: "berto. Has asked to be your friend." The relationship is the
 * whole point of this list, so unlike the online roster there is no activity to lead with.
 */
export function describeFriend(entry: FriendEntry, t: Translate): string {
	const standing = relationshipText(entry.relationship, t);
	return standing
		? t('lobby.friends.row', { handle: entry.handle, state: standing })
		: `${entry.handle}.`;
}

export class FriendsList {
	private readonly roster: FriendRoster;
	private readonly requestsRoster: FriendRoster | null;
	private busy = false;

	constructor(private readonly deps: FriendsListDeps) {
		this.roster = new FriendRoster({
			list: deps.list,
			empty: deps.empty,
			menuHost: () => document.getElementById('view-friends'),
			menuLabel: () => deps.t('lobby.friends.menuLabel'),
			rowClass: 'friend-row',
			buttonClass: 'friend-row__btn',
		});
		// The second tab is the same roster asking a different question, so it is the same widget.
		this.requestsRoster = deps.requestsList
			? new FriendRoster({
				list: deps.requestsList,
				empty: deps.requestsEmpty ?? null,
				menuHost: () => document.getElementById('view-friends'),
				menuLabel: () => deps.t('lobby.friends.menuLabel'),
				rowClass: 'friend-row',
				buttonClass: 'friend-row__btn',
			})
			: null;
	}

	/** Ask the server and paint both tabs. Returns everything, which is what the tests assert. */
	async refresh(): Promise<FriendEntry[]> {
		const entries = await fetchFriends(this.deps.fetchImpl ?? fetch);
		const { people, requests } = splitForTabs(entries);

		this.roster.render(people.map(entry => this.rowFor(entry)));
		this.requestsRoster?.render(requests.map(entry => this.rowFor(entry)));

		const sorted = sortFriends(entries);
		this.deps.onRefreshed?.(sorted);
		return sorted;
	}

	/**
	 * One person as a row. What it offers follows from where the two of them stand, plus the two
	 * things only a FRIEND can be offered: writing to them, and asking into the table they are at.
	 */
	private rowFor(entry: FriendEntry) {
		const t = this.deps.t;
		const actions = actionsFor(entry.relationship).map(action => ({
			key: action,
			label: actionLabel(action, entry.handle, t),
			onClick: () => void this.act(action, entry.handle),
		}));

		if (entry.relationship === 'Friends' && this.deps.writeTo) {
			actions.unshift({
				key: 'chat' as FriendActionKey,
				label: t('lobby.friends.actionChat', { handle: entry.handle }),
				onClick: () => { this.deps.writeTo?.(entry.handle); },
			});
		}
		// Only when they are actually at a table with room: an action that is usually absent is
		// better than one that is usually refused.
		if (entry.joinableGameId && this.deps.askToJoin) {
			const gameId = entry.joinableGameId;
			actions.push({
				key: 'join' as FriendActionKey,
				label: t('lobby.friends.actionJoin', { handle: entry.handle }),
				onClick: () => void this.deps.askToJoin?.(gameId, entry.handle),
			});
		}

		return {
			key: entry.handle,
			line: describeFriend(entry, t),
			actionsLabel: t('lobby.friends.actionsFor', { handle: entry.handle }),
			actions,
		};
	}

	/** How many requests are waiting on an answer — what the way in to this view announces. */
	static waiting(entries: readonly FriendEntry[]): number {
		return entries.filter(entry => entry.relationship === 'RequestReceived').length;
	}

	private async act(action: FriendActionKey, handle: string): Promise<void> {
		// A second click while the first is in flight would race two writes against one row.
		if (this.busy) return;
		this.busy = true;
		try {
			const result = await performFriendAction(this.deps.fetchImpl ?? fetch, action, handle);
			if (this.deps.status) {
				this.deps.status.textContent = resultText(result, handle, this.deps.t);
			}
			await this.refresh();
		} finally {
			this.busy = false;
		}
	}

	/** Move the keyboard into the list. False when there is nobody to move to. */
	focusFirst(): boolean {
		return this.roster.focusFirst();
	}
}
