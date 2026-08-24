// unreadMessages.ts — what the home's Messages button says.
//
// Messages are a screen of their own, so a message that arrives while somebody is looking at
// their tables has to leave a mark they can find later. The mark is the button's NAME, not a
// badge: a number painted in a corner is invisible to exactly the people this lobby is for.
//
// Both functions are pure so the counting rule can be tested without a DOM, a socket or a clock.

/** How the button reads: plain, or carrying what is waiting. */
export function messagesButtonLabel(
	unread: number,
	t: (key: string, vars?: Record<string, unknown>) => string,
): string {
	return unread > 0
		? t('lobby.home.messagesButtonUnread', { count: unread })
		: t('lobby.home.messagesButton');
}

/**
 * The count after a message lands. Reading the messages screen IS reading the message, so one
 * arriving while it is open leaves nothing behind; anywhere else in the lobby, it waits.
 */
export function unreadAfterArrival(current: number, viewingMessages: boolean): number {
	return viewingMessages ? 0 : current + 1;
}

/**
 * Whether an arriving message is this reader's own line coming back. The server sends a copy of
 * every message to the sender's OTHER tabs so the conversation reads the same everywhere, and
 * that copy carries the sender's handle — which is this reader's. It is not news: nobody should
 * be told they have written to themselves, or be left an unread mark on a message they wrote.
 *
 * Compared without case, like every other handle comparison in the chat: a handle is a name, and
 * "Ana" and "ana" are the same person.
 */
export function isOwnEcho(from: string, me: string | null): boolean {
	if (!me) return false;
	return from.toLowerCase() === me.toLowerCase();
}
