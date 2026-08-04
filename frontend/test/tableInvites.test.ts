import test from 'node:test';
import assert from 'node:assert/strict';
import {
	actionsForInvitation,
	asInviteResult,
	asSendInviteResult,
	describeInvitation,
	parsePendingInvitations,
	resultText,
	sendResultText,
} from '../src/tableInvites.js';

/**
 * Being asked to a table, and asking to be let into one.
 *
 * Both arrive in the same list and read as the same kind of thing, but only one of them has
 * anything to answer: a door you knocked on offers nothing but waiting, and showing it an Accept
 * button would be offering to accept your own request.
 *
 * The board is named because an invitation with no idea what is being played is one somebody has to
 * accept blind — and it comes across as an id so this client can name it in the reader's own
 * language, rather than being handed a name in somebody else's.
 */

const t = (key: string, vars?: Record<string, unknown>) => {
	switch (key) {
		case 'lobby.invites.invited': return `${vars?.from} te ha invitado a su mesa.`;
		case 'lobby.invites.invitedToBoard':
			return `${vars?.from} te ha invitado a su mesa: ${vars?.board}.`;
		case 'lobby.invites.asked': return 'Has pedido entrar en una mesa. Esperando respuesta.';
		case 'lobby.invites.askedAtBoard':
			return `Has pedido entrar en una mesa: ${vars?.board}. Esperando respuesta.`;
		case 'lobby.invites.joining': return 'Te llevamos a la mesa.';
		case 'lobby.invites.full': return 'Esa mesa se llenó antes de que respondieras.';
		case 'table.inviteSent': return `Se ha invitado a ${vars?.handle}.`;
		case 'table.inviteRefused': return `No se ha podido invitar a ${vars?.handle}.`;
		default: return key;
	}
};

const named = (id: string | null) => (id === 'snakes' ? 'Serpientes' : null);

test('only whole entries are believed', () => {
	assert.deepEqual(
		parsePendingInvitations([{ gameId: 'g1', invitedBy: 'ana', boardId: 'snakes', asked: false }]),
		[{ gameId: 'g1', invitedBy: 'ana', boardId: 'snakes', asked: false }]);

	// Anything without a table is nothing waiting, which is a safe thing to show.
	for (const payload of [
		[{ invitedBy: 'ana' }],
		[{ gameId: '' }],
		'nope',
		null,
		undefined,
	]) {
		assert.deepEqual(parsePendingInvitations(payload), [], JSON.stringify(payload ?? null));
	}
});

test('a missing board or inviter is a thinner line, never a broken one', () => {
	const [entry] = parsePendingInvitations([{ gameId: 'g1' }]);
	assert.deepEqual(entry, { gameId: 'g1', invitedBy: '', boardId: null, asked: false });
});

test('an invitation says who asked and what is being played', () => {
	assert.equal(
		describeInvitation(
			{ gameId: 'g', invitedBy: 'ana', boardId: 'snakes', asked: false }, named, t),
		'ana te ha invitado a su mesa: Serpientes.');
	// A board this client cannot name yet is left out rather than shown as an id.
	assert.equal(
		describeInvitation(
			{ gameId: 'g', invitedBy: 'ana', boardId: 'unknown-board', asked: false }, named, t),
		'ana te ha invitado a su mesa.');
});

test('a door you knocked on reads as yours, and offers nothing to answer', () => {
	const mine = { gameId: 'g', invitedBy: '', boardId: 'snakes', asked: true };

	assert.equal(
		describeInvitation(mine, named, t),
		'Has pedido entrar en una mesa: Serpientes. Esperando respuesta.');
	// Offering Accept here would be offering to accept your own request.
	assert.deepEqual(actionsForInvitation(mine), []);
	assert.deepEqual(
		actionsForInvitation({ gameId: 'g', invitedBy: 'ana', boardId: null, asked: false }),
		['accept', 'decline']);
});

// A table filling up between the invitation and the answer is the ordinary case, not an error, and
// it has to be said plainly rather than reported as a failure.
test('the outcomes the server can report each become their own sentence', () => {
	assert.equal(asInviteResult('JOINING'), 'joining');
	assert.equal(asInviteResult('ADMITTED'), 'joining');
	assert.equal(asInviteResult('TABLE_FULL'), 'full');
	assert.equal(asInviteResult('GONE'), 'gone');
	assert.equal(asInviteResult('DECLINED'), 'declined');
	// A word this client does not know is a failure, not a crash.
	assert.equal(asInviteResult('SOMETHING_NEW'), 'failed');
	assert.equal(asInviteResult(undefined), 'failed');

	assert.equal(resultText('full', t), 'Esa mesa se llenó antes de que respondieras.');
});

// One sentence for every refusal: an unknown name and somebody who does not accept invitations
// from this player must be impossible to tell apart, exactly as with messages.
test('inviting reports what happened, and refusals do not say which refusal', () => {
	assert.equal(asSendInviteResult('INVITED'), 'invited');
	assert.equal(asSendInviteResult('ALREADY_HERE'), 'alreadyHere');
	assert.equal(asSendInviteResult('TABLE_FULL'), 'full');
	assert.equal(asSendInviteResult('NEEDS_PUBLIC_NAME'), 'needsPublicName');
	// Everything else — no such name, they refuse you, the server said something new — is one word.
	assert.equal(asSendInviteResult('REFUSED'), 'refused');
	assert.equal(asSendInviteResult('WHO_KNOWS'), 'refused');

	assert.equal(sendResultText('invited', 'ana', t), 'Se ha invitado a ana.');
	assert.equal(sendResultText('refused', 'ana', t), 'No se ha podido invitar a ana.');
});
