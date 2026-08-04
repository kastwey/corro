// lobbyNotices.ts — whether the lobby says who arrives.
//
// Kept in the BROWSER, not on the account, and that is the interesting decision. Everything else
// about a player travels with them; this one should not. It is a preference about speech on THIS
// device: somebody who drives this machine with a screen reader and another one silently would
// otherwise have to pick one answer for both, and get the wrong one half the time.
//
// The default is friends only. Announcing every stranger who wanders into a busy lobby is a stream
// nobody asked to be read — the same reason the online list does not speak — while a friend
// arriving is the one thing worth interrupting a quiet moment for.

/** Whose arrivals are worth saying out loud. */
export type LobbyArrivals = 'nobody' | 'friends' | 'everyone';

const STORAGE_KEY = 'corro.lobbyArrivals';
const CHOICES: readonly LobbyArrivals[] = ['nobody', 'friends', 'everyone'];

/** The stored choice, or the default for anything missing or unrecognised. */
export function lobbyArrivalsSetting(storage?: Storage): LobbyArrivals {
	try {
		const raw = (storage ?? localStorage).getItem(STORAGE_KEY);
		return CHOICES.includes(raw as LobbyArrivals) ? raw as LobbyArrivals : 'friends';
	} catch {
		return 'friends';
	}
}

export function setLobbyArrivalsSetting(choice: LobbyArrivals, storage?: Storage): void {
	try {
		(storage ?? localStorage).setItem(STORAGE_KEY, choice);
	} catch {
		/* A blocked storage costs the choice on reload, which is not worth failing over. */
	}
}

/**
 * Whether one arrival is worth saying, given the setting and whether they are a friend.
 *
 * Pure, because this is the whole rule and it is the part that must not drift: an arrival that
 * should be silent and is not turns a lobby into a ticker for the exact people this app is for.
 */
export function shouldAnnounceArrival(
	setting: LobbyArrivals, isFriend: boolean,
): boolean {
	switch (setting) {
		case 'everyone': return true;
		case 'friends': return isFriend;
		default: return false;
	}
}

/**
 * What to say when somebody arrives or leaves.
 *
 * A friend is named as being on your LIST rather than with a word that agrees with them: Spanish
 * would need "tu amigo" or "tu amiga" and there is no way to know which, so the sentence refers to
 * the list — a thing with a fixed name in this interface — and stays right for everybody.
 */
export function arrivalText(
	handle: string,
	isFriend: boolean,
	arriving: boolean,
	t: (key: string, vars?: Record<string, unknown>) => string,
): string {
	const key = arriving
		? (isFriend ? 'lobby.settings.arrivedFriend' : 'lobby.settings.arrived')
		: (isFriend ? 'lobby.settings.leftFriend' : 'lobby.settings.left');
	return t(key, { handle });
}
