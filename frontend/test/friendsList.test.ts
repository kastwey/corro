import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { FriendsList, describeFriend, sortFriends } from '../src/friendsList.js';

/**
 * Your friends, and the requests waiting for an answer.
 *
 * It exists separately from the list of who is connected because a request has to be answerable
 * whether or not the person who sent it happens to be online — otherwise saying yes would mean
 * waiting for them to come back.
 *
 * One list rather than three sections, with the rows that need something from you at the top: a
 * reader arrows down it once instead of navigating between headings to learn that nobody has
 * written.
 */

setupDom();

const translate = (key: string, vars?: Record<string, unknown>) => {
	switch (key) {
		case 'lobby.friends.row': return `${vars?.handle}. ${vars?.state}`;
		case 'lobby.friends.stateFriends': return 'Tu amigo.';
		case 'lobby.friends.stateSent': return 'Le pediste amistad.';
		case 'lobby.friends.stateReceived': return 'Te ha pedido amistad.';
		case 'lobby.friends.actionsFor': return `Acciones para ${vars?.handle}`;
		case 'lobby.friends.actionAccept': return `Aceptar a ${vars?.handle}`;
		case 'lobby.friends.actionDecline': return `Rechazar a ${vars?.handle}`;
		case 'lobby.friends.actionRemove': return `Dejar de ser amigo de ${vars?.handle}`;
		case 'lobby.friends.resultAccepted': return `${vars?.handle} ya es tu amigo.`;
		case 'lobby.friends.resultDeclined': return `Has rechazado a ${vars?.handle}.`;
		default: return key;
	}
};

function harness() {
	document.body.innerHTML = `
		<div id="view-friends">
			<div class="friends-surface" role="application">
				<ul id="friends-list" role="list"></ul>
			</div>
			<p id="friends-empty" hidden></p>
			<ul id="friends-requests-list" role="list"></ul>
			<p id="friends-requests-empty" hidden></p>
			<p id="friends-status" role="status" aria-live="polite"></p>
		</div>`;
	const list = document.getElementById('friends-list') as HTMLElement;
	const calls: Array<{ url: string; method: string }> = [];
	return {
		list,
		calls,
		empty: document.getElementById('friends-empty') as HTMLElement,
		status: document.getElementById('friends-status') as HTMLElement,
		rows: () => Array.from(list.querySelectorAll<HTMLElement>('.friend-row')),
		lineOf: (row: HTMLElement) => row.querySelector('.friend-row__line')?.textContent,
		buttonsOf: (row: HTMLElement) =>
			Array.from(row.querySelectorAll<HTMLElement>('.friend-row__btn')),
		requestRows: () => Array.from(
			document.querySelectorAll<HTMLElement>('#friends-requests-list .friend-row')),
		build: (fetchImpl: typeof fetch) => new FriendsList({
			list,
			empty: document.getElementById('friends-empty'),
			requestsList: document.getElementById('friends-requests-list'),
			requestsEmpty: document.getElementById('friends-requests-empty'),
			status: document.getElementById('friends-status'),
			t: translate,
			fetchImpl,
		}),
		server: (...pages: unknown[]) => {
			let index = 0;
			return (async (url: string, init?: RequestInit) => {
				calls.push({ url, method: init?.method ?? 'GET' });
				if (init?.method && init.method !== 'GET') return { ok: true, status: 204 };
				const page = pages[Math.min(index++, pages.length - 1)];
				return { ok: true, json: async () => page };
			}) as unknown as typeof fetch;
		},
	};
}

const answering = (friends: unknown) => (async () => ({
	ok: true, json: async () => friends,
}) as unknown as Response) as unknown as typeof fetch;

test('the rows that want something from you come first, then everybody in one alphabet', () => {
	const sorted = sortFriends([
		{ handle: 'zoe', relationship: 'Friends' },
		{ handle: 'ana', relationship: 'RequestSent' },
		{ handle: 'berto', relationship: 'RequestReceived' },
		{ handle: 'cora', relationship: 'Friends' },
		{ handle: 'alba', relationship: 'RequestReceived' },
	]);

	assert.deepEqual(sorted.map(entry => entry.handle),
		['alba', 'berto', 'cora', 'zoe', 'ana']);
});

test('a person reads as one flowing line: the name, and where the two of you stand', () => {
	assert.equal(
		describeFriend({ handle: 'berto', relationship: 'RequestReceived' }, translate),
		'berto. Te ha pedido amistad.');
	assert.equal(
		describeFriend({ handle: 'ana', relationship: 'Friends' }, translate),
		'ana. Tu amigo.');
});

// People you are something to in one tab; things waiting on an answer in the other. A request you
// SENT belongs with the people — it is somebody you are waiting on, not something to answer.
test('the two tabs split people from things to answer', async () => {
	const h = harness();
	await h.build(answering({
		friends: [
			{ handle: 'berto', relationship: 'RequestReceived' },
			{ handle: 'ana', relationship: 'Friends' },
			{ handle: 'cora', relationship: 'RequestSent' },
		],
	})).refresh();

	assert.deepEqual(h.rows().map(h.lineOf), ['ana. Tu amigo.', 'cora. Le pediste amistad.']);
	assert.deepEqual(h.requestRows().map(h.lineOf), ['berto. Te ha pedido amistad.']);

	// Each list is its own single tab stop.
	assert.deepEqual(h.rows().map(row => row.tabIndex), [0, -1]);
	assert.deepEqual(h.requestRows().map(row => row.tabIndex), [0]);

	assert.deepEqual(h.rows().map(row => h.buttonsOf(row).map(b => b.textContent)), [
		['Dejar de ser amigo de ana'],
		// Waiting on somebody is not a thing you can act on.
		[],
	]);
	assert.deepEqual(h.requestRows().map(row => h.buttonsOf(row).map(b => b.textContent)), [
		['Aceptar a berto', 'Rechazar a berto'],
	]);
});

test('answering re-reads the list rather than guessing the new state', async () => {
	const h = harness();
	const list = h.build(h.server(
		{ friends: [{ handle: 'berto', relationship: 'RequestReceived' }] },
		{ friends: [{ handle: 'berto', relationship: 'Friends' }] },
	));
	await list.refresh();

	h.buttonsOf(h.requestRows()[0])[0].click();
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.deepEqual(h.calls.map(c => `${c.method} ${c.url}`), [
		'GET /api/friends',
		'POST /api/friends/requests/accept',
		'GET /api/friends',
	]);
	// Answered, so they move out of the things-to-answer tab and into the people.
	assert.deepEqual(h.requestRows(), []);
	assert.equal(h.lineOf(h.rows()[0]), 'berto. Tu amigo.');
	assert.equal(h.status.textContent, 'berto ya es tu amigo.');
});

// The count is in the BUTTON's name, not a badge: a badge is invisible to the people this whole
// surface exists for.
test('how many answers are waiting is counted from the list itself', () => {
	assert.equal(FriendsList.waiting([
		{ handle: 'a', relationship: 'RequestReceived' },
		{ handle: 'b', relationship: 'Friends' },
		{ handle: 'c', relationship: 'RequestReceived' },
		{ handle: 'd', relationship: 'RequestSent' },
	]), 2);
	assert.equal(FriendsList.waiting([]), 0);
});

test('an empty list says so, and a refused one is the same quiet outcome', async () => {
	const h = harness();
	await h.build(answering({ friends: [] })).refresh();
	assert.equal(h.empty.hidden, false);
	assert.equal(h.list.textContent, '');

	const unauthorized = (async () => ({ ok: false, json: async () => ({}) }) as unknown as Response
	) as unknown as typeof fetch;
	assert.deepEqual(await h.build(unauthorized).refresh(), []);
	assert.equal(h.empty.hidden, false);
});

test('the list never speaks on its own', async () => {
	const h = harness();
	await h.build(answering({ friends: [{ handle: 'ana', relationship: 'Friends' }] })).refresh();

	assert.equal(h.list.hasAttribute('aria-live'), false);
	assert.equal(h.list.getAttribute('role'), 'list');
	assert.equal(h.rows()[0].hasAttribute('aria-live'), false);
});

test('a refreshed list keeps the row the keyboard is standing on', async () => {
	const h = harness();
	const list = h.build(answering({
		friends: [
			{ handle: 'ana', relationship: 'Friends' },
			{ handle: 'berto', relationship: 'Friends' },
		],
	}));
	await list.refresh();
	h.rows()[1].focus();
	const before = h.rows()[1];

	await list.refresh();

	assert.equal(h.rows()[1], before);
	assert.equal(document.activeElement, before);
});
