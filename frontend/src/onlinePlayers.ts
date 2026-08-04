// onlinePlayers.ts — the list of who is connected.
//
// Built on the shared roster (friendRoster.ts), so it is the same thing to operate as the table
// roster and the in-game players panel: one tab stop, arrows between people, Right into a person's
// actions, Shift+F10 for the same actions as a menu.
//
// It shows a handle and a coarse activity, never a display name and never which table: the question
// this answers is "is anyone around, and can I interrupt them?", not "where are they". Each row also
// says what the reader already is to that person, because a reader arrowing down the list has to
// hear that without stepping into the row to find out.
//
// It is not a live region and does not poll. People arriving and leaving is a stream of changes
// nobody asked to be read; the list is a page you visit, refreshed when you arrive and by asking.

import { FriendRoster } from './friendRoster.js';
import {
	actionLabel,
	actionsFor,
	asRelationship,
	relationshipText,
	performFriendAction,
	resultText,
	type FriendActionKey,
	type FriendResult,
	type Relationship,
	type Translate,
} from './friends.js';

/** One person, as the server publishes them. */
export interface OnlinePlayer {
	readonly handle: string;
	/** InLobby | AtTable | Playing — coarse on purpose. */
	readonly activity: string;
	/** What the reader is to them: what the row offers to do about it. */
	readonly relationship: Relationship;
}

export interface OnlineListDeps {
	list: HTMLElement;
	empty: HTMLElement | null;
	error: HTMLElement | null;
	/** Where the outcome of the reader's OWN action is said. Never used for the room changing. */
	status?: HTMLElement | null;
	/** Already translated. `activity` keys map to one flowing line per person. */
	t: Translate;
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
			? [{
				handle,
				activity,
				relationship: asRelationship((entry as { relationship?: unknown })?.relationship),
			}]
			: [];
	});
}

/**
 * One person as a single flowing line: "kastwey, playing. Friend." The name, what they are doing
 * and where the two of them stand are one sentence rather than three facts glued together.
 */
export function describePlayer(player: OnlinePlayer, t: Translate): string {
	const key = ACTIVITY_KEYS[player.activity] ?? ACTIVITY_KEYS.InLobby;
	const line = t('lobby.online.row', { handle: player.handle, activity: t(key) });
	const standing = relationshipText(player.relationship, t);
	return standing ? `${line} ${standing}` : line;
}

export class OnlineList {
	private readonly roster: FriendRoster;
	private busy = false;

	constructor(private readonly deps: OnlineListDeps) {
		this.roster = new FriendRoster({
			list: deps.list,
			empty: deps.empty,
			menuHost: () => document.getElementById('view-online'),
			menuLabel: () => deps.t('lobby.online.menuLabel'),
			rowClass: 'online-player',
			buttonClass: 'online-player__btn',
		});
	}

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

		this.roster.render(players.map(player => ({
			key: player.handle,
			line: describePlayer(player, this.deps.t),
			actionsLabel: this.deps.t('lobby.online.actionsFor', { handle: player.handle }),
			actions: actionsFor(player.relationship).map(action => ({
				key: action,
				label: actionLabel(action, player.handle, this.deps.t),
				onClick: () => void this.act(action, player.handle),
			})),
		})));

		if (this.deps.error) {
			// The only thing worth saying out loud here, and only when asking actually failed.
			this.deps.error.textContent = failed ? this.deps.t('lobby.online.failed') : '';
		}
		return players;
	}

	/**
	 * Do one thing, say how it went, and re-read the list — the server decides what the
	 * relationship now is, so nothing here guesses at the new state.
	 */
	private async act(action: FriendActionKey, handle: string): Promise<void> {
		// A second click while the first is in flight would race two writes against one row.
		if (this.busy) return;
		this.busy = true;
		try {
			const result: FriendResult = await performFriendAction(
				this.deps.fetchImpl ?? fetch, action, handle);
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
