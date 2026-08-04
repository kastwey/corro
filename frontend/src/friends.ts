// friends.ts — asking, answering, and the words for what two people are to each other.
//
// The vocabulary is shared with the online list, because the same relationship decides what a row
// says and what it offers to do: a person you have asked shows no action at all, a person who has
// asked YOU shows two, and a friend shows the one that ends it.
//
// Nothing here can cancel a request. That is the server's rule and it is worth repeating on this
// side so nobody adds the button back: a cancel would have to fail on a request that had been
// refused, and a button that quietly stops working is how the asker would find out an answer the
// other person chose not to give.

/** What the reader is to another player. The strings the server sends, verbatim. */
export type Relationship = 'None' | 'RequestSent' | 'RequestReceived' | 'Friends' | 'Self';

const RELATIONSHIPS: readonly Relationship[] = [
	'None', 'RequestSent', 'RequestReceived', 'Friends', 'Self',
];

/** One person on a friends list: their public name, and where the two of them stand. */
export interface FriendEntry {
	readonly handle: string;
	readonly relationship: Relationship;
	/**
	 * The table this friend is sitting at, when it is one this reader could join. Null otherwise —
	 * which is almost always, since it needs them to be at a table that is waiting and not full.
	 * The one place presence names a table, and only ever a friend's.
	 */
	readonly joinableGameId?: string | null;
}

/** A relationship the server sent, or 'None' for anything this client does not recognise — an
 * unknown word must not make a row disappear or throw; the person is still there. */
export function asRelationship(value: unknown): Relationship {
	return RELATIONSHIPS.includes(value as Relationship) ? value as Relationship : 'None';
}

/** Only whole entries are believed; anything malformed is nobody. */
export function parseFriends(payload: unknown): FriendEntry[] {
	const friends = (payload as { friends?: unknown } | null)?.friends;
	if (!Array.isArray(friends)) return [];
	return friends.flatMap(entry => {
		const handle = (entry as { handle?: unknown })?.handle;
		if (typeof handle !== 'string' || handle.length === 0) return [];
		const joinable = (entry as { joinableGameId?: unknown })?.joinableGameId;
		return [{
			handle,
			relationship: asRelationship((entry as { relationship?: unknown })?.relationship),
			joinableGameId: typeof joinable === 'string' && joinable.length > 0 ? joinable : null,
		}];
	});
}

/** The phrase for a relationship, or null when there is nothing to say (strangers). */
const RELATIONSHIP_KEYS: Partial<Record<Relationship, string>> = {
	RequestSent: 'lobby.friends.stateSent',
	RequestReceived: 'lobby.friends.stateReceived',
	Friends: 'lobby.friends.stateFriends',
	Self: 'lobby.friends.stateSelf',
};

export type Translate = (key: string, vars?: Record<string, unknown>) => string;

export function relationshipText(relationship: Relationship, t: Translate): string | null {
	const key = RELATIONSHIP_KEYS[relationship];
	return key ? t(key) : null;
}

/** What a relationship lets you do about it. Ordered as they are offered. */
export type FriendActionKey = 'request' | 'accept' | 'decline' | 'remove';

export function actionsFor(relationship: Relationship): FriendActionKey[] {
	switch (relationship) {
		case 'None': return ['request'];
		case 'RequestReceived': return ['accept', 'decline'];
		case 'Friends': return ['remove'];
		// A request you sent, and your own row: nothing to do but wait, or nothing to do at all.
		default: return [];
	}
}

const ACTION_KEYS: Record<FriendActionKey, string> = {
	request: 'lobby.friends.actionRequest',
	accept: 'lobby.friends.actionAccept',
	decline: 'lobby.friends.actionDecline',
	remove: 'lobby.friends.actionRemove',
};

/** An action's label, which names the person: a toolbar of bare verbs is unreadable in a list. */
export function actionLabel(action: FriendActionKey, handle: string, t: Translate): string {
	return t(ACTION_KEYS[action], { handle });
}

/** How an attempt ended, in the words the surface will say. */
export type FriendResult = 'sent' | 'accepted' | 'declined' | 'removed' | 'nobody' | 'failed';

async function post(
	fetchImpl: typeof fetch, path: string, handle: string,
): Promise<Response | null> {
	try {
		return await fetchImpl(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ handle }),
		});
	} catch {
		return null;
	}
}

/**
 * Asks somebody to be friends. "Sent" covers asking somebody who had already asked you, which the
 * server turns into an agreement — the surface re-reads its list rather than trusting this word for
 * what the relationship now is.
 */
export async function requestFriend(
	fetchImpl: typeof fetch, handle: string,
): Promise<FriendResult> {
	const response = await post(fetchImpl, '/api/friends/requests', handle);
	if (!response) return 'failed';
	if (response.status === 404) return 'nobody';
	return response.ok ? 'sent' : 'failed';
}

export async function respondToRequest(
	fetchImpl: typeof fetch, handle: string, accept: boolean,
): Promise<FriendResult> {
	const path = accept ? '/api/friends/requests/accept' : '/api/friends/requests/decline';
	const response = await post(fetchImpl, path, handle);
	if (!response) return 'failed';
	return response.ok ? (accept ? 'accepted' : 'declined') : 'failed';
}

export async function removeFriend(
	fetchImpl: typeof fetch, handle: string,
): Promise<FriendResult> {
	try {
		const response = await fetchImpl(`/api/friends/${encodeURIComponent(handle)}`, {
			method: 'DELETE',
		});
		return response.ok ? 'removed' : 'failed';
	} catch {
		return 'failed';
	}
}

/**
 * Asks somebody sitting at the same table, addressed by their SEAT. The caller never learns their
 * public name and does not need to — the server resolves the seat and answers.
 *
 * Separate from requestFriend because the routes differ in what they are allowed to reach:
 * this one works whatever the other player's visibility says, since sharing a table has already
 * introduced them. What the other player decides is unchanged.
 */
export async function requestFriendAtTable(
	fetchImpl: typeof fetch, gameId: string, playerId: string,
): Promise<FriendResult> {
	try {
		const response = await fetchImpl('/api/friends/requests/table', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ gameId, playerId }),
		});
		if (response.status === 404) return 'nobody';
		return response.ok ? 'sent' : 'failed';
	} catch {
		return 'failed';
	}
}

/** Everything this player is part of. A refused list is the same quiet outcome as an empty one. */
export async function fetchFriends(fetchImpl: typeof fetch): Promise<FriendEntry[]> {
	try {
		const response = await fetchImpl('/api/friends');
		return response.ok ? parseFriends(await response.json()) : [];
	} catch {
		return [];
	}
}

/** The one place an action key becomes a request, shared by both rosters. */
export async function performFriendAction(
	fetchImpl: typeof fetch,
	action: FriendActionKey,
	handle: string,
): Promise<FriendResult> {
	switch (action) {
		case 'request': return requestFriend(fetchImpl, handle);
		case 'remove': return removeFriend(fetchImpl, handle);
		default: return respondToRequest(fetchImpl, handle, action === 'accept');
	}
}

const RESULT_KEYS: Record<FriendResult, string> = {
	sent: 'lobby.friends.resultSent',
	accepted: 'lobby.friends.resultAccepted',
	declined: 'lobby.friends.resultDeclined',
	removed: 'lobby.friends.resultRemoved',
	nobody: 'lobby.friends.resultNobody',
	failed: 'lobby.friends.resultFailed',
};

/**
 * What to say after acting. Said once, in the surface's own status region — this is the reader's
 * own action, so it is theirs to hear, unlike somebody else arriving in the room.
 */
export function resultText(result: FriendResult, handle: string, t: Translate): string {
	return t(RESULT_KEYS[result], { handle });
}
