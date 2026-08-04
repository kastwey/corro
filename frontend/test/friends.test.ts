import test from 'node:test';
import assert from 'node:assert/strict';
import {
	actionLabel,
	actionsFor,
	asRelationship,
	parseFriends,
	performFriendAction,
	relationshipText,
	resultText,
	type Relationship,
} from '../src/friends.js';

/**
 * The vocabulary both rosters share: what a relationship lets you do, what it is called, and what
 * each attempt says afterwards.
 *
 * The one rule worth defending here is a negative: NOTHING cancels a request. A cancel would have to
 * fail on a request that had been refused — and a button that quietly stops working is exactly how
 * the asker would learn the answer the other person chose not to give.
 */

const t = (key: string, vars?: Record<string, unknown>) =>
	vars?.handle ? `${key}:${vars.handle}` : key;

test('a relationship the server has not taught this client is a stranger, never a crash', () => {
	assert.equal(asRelationship('Friends'), 'Friends');
	assert.equal(asRelationship('Betrothed'), 'None');
	assert.equal(asRelationship(undefined), 'None');
	assert.equal(asRelationship(42), 'None');
});

test('what a row offers is decided entirely by where the two of them stand', () => {
	assert.deepEqual(actionsFor('None'), ['request']);
	assert.deepEqual(actionsFor('RequestReceived'), ['accept', 'decline']);
	assert.deepEqual(actionsFor('Friends'), ['remove']);
	// A request you sent, and your own row: nothing to press.
	assert.deepEqual(actionsFor('RequestSent'), []);
	assert.deepEqual(actionsFor('Self'), []);
});

// A toolbar of bare verbs ("Accept", "Decline") is unreadable in a list of people: out of context a
// screen reader reads the button, not the row it sits in.
test('every action names the person it is about', () => {
	for (const action of ['request', 'accept', 'decline', 'remove'] as const) {
		assert.match(actionLabel(action, 'kastwey', t), /kastwey$/, action);
	}
});

test('a stranger has no standing to announce; everybody else does', () => {
	assert.equal(relationshipText('None', t), null);
	assert.equal(relationshipText('Friends', t), 'lobby.friends.stateFriends');
	assert.equal(relationshipText('RequestSent', t), 'lobby.friends.stateSent');
	assert.equal(relationshipText('RequestReceived', t), 'lobby.friends.stateReceived');
	assert.equal(relationshipText('Self', t), 'lobby.friends.stateSelf');
});

test('only whole entries are believed', () => {
	assert.deepEqual(
		parseFriends({ friends: [{ handle: 'ana', relationship: 'Friends' }] }),
		[{ handle: 'ana', relationship: 'Friends', joinableGameId: null }]);
	// The one place a table is named, and only ever a friend's.
	assert.deepEqual(
		parseFriends({ friends: [{ handle: 'ana', relationship: 'Friends', joinableGameId: 'g1' }] }),
		[{ handle: 'ana', relationship: 'Friends', joinableGameId: 'g1' }]);
	// An empty or absent one is no table, never an empty string somebody could act on.
	assert.deepEqual(
		parseFriends({ friends: [{ handle: 'ana', relationship: 'Friends', joinableGameId: '' }] }),
		[{ handle: 'ana', relationship: 'Friends', joinableGameId: null }]);
	for (const payload of [
		{ friends: [{ handle: '' }] },
		{ friends: 'nope' },
		{},
		null,
	]) {
		assert.deepEqual(parseFriends(payload), [], JSON.stringify(payload));
	}
});

/** Records what was asked of the server, and answers however the test says. */
function server(reply: { ok: boolean; status?: number } | 'throw') {
	const calls: Array<{ url: string; method: string; body?: string }> = [];
	const fetchImpl = (async (url: string, init?: RequestInit) => {
		calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string });
		if (reply === 'throw') throw new Error('offline');
		return { ...reply, status: reply.status ?? (reply.ok ? 204 : 500) };
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

test('each action is one write, addressed by handle', async () => {
	for (const [action, method, url] of [
		['request', 'POST', '/api/friends/requests'],
		['accept', 'POST', '/api/friends/requests/accept'],
		['decline', 'POST', '/api/friends/requests/decline'],
		['remove', 'DELETE', '/api/friends/kastwey'],
	] as const) {
		const s = server({ ok: true });
		await performFriendAction(s.fetchImpl, action, 'kastwey');
		assert.deepEqual(s.calls.map(c => [c.method, c.url]), [[method, url]], action);
	}
});

// Not one of them is a GET: the session cookie is SameSite=Lax, so a GET that changed a
// relationship could be fired by an image tag in a forum post.
test('nothing that changes a relationship is a GET', async () => {
	for (const action of ['request', 'accept', 'decline', 'remove'] as const) {
		const s = server({ ok: true });
		await performFriendAction(s.fetchImpl, action, 'kastwey');
		assert.notEqual(s.calls[0].method, 'GET', action);
	}
});

test('a handle with awkward characters is escaped into the path rather than breaking it', async () => {
	const s = server({ ok: true });
	await performFriendAction(s.fetchImpl, 'remove', 'a b/c');
	assert.equal(s.calls[0].url, '/api/friends/a%20b%2Fc');
});

test('a name nobody holds is told apart from a server that broke', async () => {
	const missing = server({ ok: false, status: 404 });
	assert.equal(await performFriendAction(missing.fetchImpl, 'request', 'ghost'), 'nobody');

	const broken = server({ ok: false, status: 500 });
	assert.equal(await performFriendAction(broken.fetchImpl, 'request', 'ana'), 'failed');
});

test('a network that never answers is a failure, never an exception the surface must catch', async () => {
	for (const action of ['request', 'accept', 'decline', 'remove'] as const) {
		const s = server('throw');
		assert.equal(await performFriendAction(s.fetchImpl, action, 'ana'), 'failed', action);
	}
});

// Declining says out loud what declining MEANS, because it is not undoable and the person doing it
// deserves to know that before they wonder why the request never came back.
test('what is said afterwards names the person and, for a refusal, its consequence', () => {
	const words = (key: string, vars?: Record<string, unknown>) => {
		const text: Record<string, string> = {
			'lobby.friends.resultSent': `Se envió tu solicitud a ${vars?.handle}.`,
			'lobby.friends.resultDeclined':
				`Has rechazado a ${vars?.handle}. No se le avisa, y no puede volver a pedírtelo.`,
		};
		return text[key] ?? key;
	};
	assert.equal(resultText('sent', 'ana', words), 'Se envió tu solicitud a ana.');
	assert.match(resultText('declined', 'ana', words), /no puede volver a pedírtelo/);
});

test('there is no action anywhere that takes a sent request back', () => {
	const everyAction = (['None', 'RequestSent', 'RequestReceived', 'Friends', 'Self'] as Relationship[])
		.flatMap(actionsFor);
	assert.equal(everyAction.includes('remove'), true, 'ending a friendship is offered');
	assert.deepEqual(everyAction.filter(a => a === 'request'), ['request'],
		'asking is offered exactly once, to a stranger');
	// Whatever a future action is called, none of them may be reachable from a request you sent.
	assert.deepEqual(actionsFor('RequestSent'), []);
});
