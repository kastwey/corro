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
	list: HTMLElement;
	empty: HTMLElement | null;
	/** Where the outcome of the reader's own action is said, once. */
	status?: HTMLElement | null;
	t: Translate;
	fetchImpl?: typeof fetch;
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
	}

	/** Ask the server and paint. Returns what was shown, which is what the tests assert. */
	async refresh(): Promise<FriendEntry[]> {
		const entries = sortFriends(await fetchFriends(this.deps.fetchImpl ?? fetch));

		this.roster.render(entries.map(entry => ({
			key: entry.handle,
			line: describeFriend(entry, this.deps.t),
			actionsLabel: this.deps.t('lobby.friends.actionsFor', { handle: entry.handle }),
			actions: actionsFor(entry.relationship).map(action => ({
				key: action,
				label: actionLabel(action, entry.handle, this.deps.t),
				onClick: () => void this.act(action, entry.handle),
			})),
		})));

		return entries;
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
