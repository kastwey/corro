// tableInvites.ts — being asked to a table, and asking to be let into one.
//
// Both arrive in the same place and read as the same kind of thing: a line saying who and where,
// with something to do about it. They are kept apart from the friend requests in the friends view
// because they are about a table that may not be there in five minutes — a friendship waits, a seat
// does not.
//
// Nothing here polls. The whole list is read once when the lobby opens, and one arriving while
// somebody is already here is pushed to them. That is the same bargain the online list makes: a
// page you visit, not a ticker that talks over you — except that an invitation, unlike somebody
// walking into the room, is addressed to YOU, so it is worth saying once when it lands.

/** One table waiting on this player's answer. */
export interface PendingInvitation {
	readonly gameId: string;
	/** Who asked, by public name. Empty when this player was the one who asked. */
	readonly invitedBy: string;
	/** The shipped board, so the client can name it in this player's own language. */
	readonly boardId: string | null;
	/** True when this player knocked rather than being invited. */
	readonly asked: boolean;
}

/** Only whole entries are believed; anything malformed is nothing waiting. */
export function parsePendingInvitations(payload: unknown): PendingInvitation[] {
	if (!Array.isArray(payload)) return [];
	return payload.flatMap(entry => {
		const item = entry as Record<string, unknown> | null;
		const gameId = item?.gameId;
		if (typeof gameId !== 'string' || gameId.length === 0) return [];
		return [{
			gameId,
			invitedBy: typeof item?.invitedBy === 'string' ? item.invitedBy : '',
			boardId: typeof item?.boardId === 'string' ? item.boardId : null,
			asked: item?.asked === true,
		}];
	});
}

export type Translate = (key: string, vars?: Record<string, unknown>) => string;

/**
 * One waiting table as a single flowing line: who asked, and what is being played. A player who
 * knocked reads their own line differently — there is nothing for them to answer, only something to
 * be told about.
 */
export function describeInvitation(
	invitation: PendingInvitation,
	boardName: (boardId: string | null) => string | null,
	t: Translate,
): string {
	const board = boardName(invitation.boardId);
	if (invitation.asked) {
		return board
			? t('lobby.invites.askedAtBoard', { board })
			: t('lobby.invites.asked');
	}
	return board
		? t('lobby.invites.invitedToBoard', { from: invitation.invitedBy, board })
		: t('lobby.invites.invited', { from: invitation.invitedBy });
}

/** What a waiting table lets you do about it. A door you knocked on offers nothing but waiting. */
export type InviteActionKey = 'accept' | 'decline';

export function actionsForInvitation(invitation: PendingInvitation): InviteActionKey[] {
	return invitation.asked ? [] : ['accept', 'decline'];
}

/** How an answer ended, in the words the surface will say. */
export type InviteResult = 'joining' | 'declined' | 'full' | 'gone' | 'failed';

const RESULT_KEYS: Record<InviteResult, string> = {
	joining: 'lobby.invites.joining',
	declined: 'lobby.invites.declined',
	full: 'lobby.invites.full',
	gone: 'lobby.invites.gone',
	failed: 'lobby.invites.failed',
};

export function resultText(result: InviteResult, t: Translate): string {
	return t(RESULT_KEYS[result]);
}

/** The server's word for what happened, as this client understands it. */
export function asInviteResult(outcome: unknown): InviteResult {
	switch (outcome) {
		case 'JOINING':
		case 'ADMITTED': return 'joining';
		case 'DECLINED': return 'declined';
		case 'TABLE_FULL': return 'full';
		case 'GONE': return 'gone';
		default: return 'failed';
	}
}

/** What inviting somebody ended in, for the person who did the inviting. */
export type SendInviteResult =
	| 'invited' | 'asked' | 'alreadyHere' | 'full' | 'needsPublicName' | 'refused';

export function asSendInviteResult(outcome: unknown): SendInviteResult {
	switch (outcome) {
		case 'INVITED': return 'invited';
		case 'ASKED': return 'asked';
		case 'ALREADY_HERE': return 'alreadyHere';
		case 'TABLE_FULL': return 'full';
		case 'NEEDS_PUBLIC_NAME': return 'needsPublicName';
		default: return 'refused';
	}
}

const SEND_KEYS: Record<SendInviteResult, string> = {
	invited: 'table.inviteSent',
	asked: 'lobby.invites.askSent',
	alreadyHere: 'table.inviteAlreadyHere',
	full: 'table.inviteTableFull',
	needsPublicName: 'table.inviteNeedsPublicName',
	// One sentence for every refusal, as everywhere else: an unknown name and somebody who does not
	// accept invitations from this player must be impossible to tell apart.
	refused: 'table.inviteRefused',
};

export function sendResultText(
	result: SendInviteResult, handle: string, t: Translate,
): string {
	return t(SEND_KEYS[result], { handle });
}
