import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { OnlineList, describePlayer, parseOnlinePlayers } from '../src/onlinePlayers.js';

/**
 * The list of who is connected. What matters here is what it says and what it refuses to say: a
 * handle, a coarse activity and where the reader stands with that person — never a display name and
 * never which table. The question it answers is "is anyone around, and can I interrupt them?", not
 * "where are they".
 *
 * And, like every roster in this app, it is one tab stop with arrows inside it, and it never speaks
 * on its own — with one exception, which is the reader's OWN action.
 */

setupDom();

const translate = (key: string, vars?: Record<string, unknown>) => {
	switch (key) {
		case 'lobby.online.row': return `${vars?.handle}, ${vars?.activity}.`;
		case 'lobby.online.activityInLobby': return 'en el lobby';
		case 'lobby.online.activityAtTable': return 'en una mesa';
		case 'lobby.online.activityPlaying': return 'jugando';
		case 'lobby.online.failed': return 'No se pudo cargar la lista de jugadores.';
		case 'lobby.online.actionsFor': return `Acciones para ${vars?.handle}`;
		case 'lobby.friends.stateFriends': return 'Tu amigo.';
		case 'lobby.friends.stateSent': return 'Le pediste amistad.';
		case 'lobby.friends.stateReceived': return 'Te ha pedido amistad.';
		case 'lobby.friends.stateSelf': return 'Eres tú.';
		case 'lobby.friends.actionRequest': return `Pedir amistad a ${vars?.handle}`;
		case 'lobby.friends.actionAccept': return `Aceptar a ${vars?.handle}`;
		case 'lobby.friends.actionDecline': return `Rechazar a ${vars?.handle}`;
		case 'lobby.friends.actionRemove': return `Dejar de ser amigo de ${vars?.handle}`;
		case 'lobby.friends.resultSent': return `Se envió tu solicitud a ${vars?.handle}.`;
		case 'lobby.friends.resultAccepted': return `${vars?.handle} ya es tu amigo.`;
		default: return key;
	}
};

function harness() {
	document.body.innerHTML = `
		<div id="view-online">
			<div class="online-surface" role="application">
				<ul id="online-list" role="list"></ul>
			</div>
			<p id="online-empty" hidden></p>
			<p id="online-error" role="status" aria-live="polite"></p>
			<p id="online-status" role="status" aria-live="polite"></p>
		</div>`;
	const list = document.getElementById('online-list') as HTMLElement;
	const calls: Array<{ url: string; method: string; body?: string }> = [];
	return {
		list,
		calls,
		empty: document.getElementById('online-empty') as HTMLElement,
		error: document.getElementById('online-error') as HTMLElement,
		status: document.getElementById('online-status') as HTMLElement,
		rows: () => Array.from(list.querySelectorAll<HTMLElement>('.online-player')),
		lineOf: (row: HTMLElement) => row.querySelector('.online-player__line')?.textContent,
		buttonsOf: (row: HTMLElement) =>
			Array.from(row.querySelectorAll<HTMLElement>('.online-player__btn')),
		build: (fetchImpl: typeof fetch) => new OnlineList({
			list,
			empty: document.getElementById('online-empty'),
			error: document.getElementById('online-error'),
			status: document.getElementById('online-status'),
			t: translate,
			fetchImpl,
		}),
		/** A server that answers the presence list from a queue, and records every write. */
		server: (...pages: unknown[]) => {
			let index = 0;
			return (async (url: string, init?: RequestInit) => {
				calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string });
				if (init?.method && init.method !== 'GET') return { ok: true, status: 204 };
				const page = pages[Math.min(index++, pages.length - 1)];
				return { ok: true, json: async () => page };
			}) as unknown as typeof fetch;
		},
	};
}

const answering = (players: unknown) => (async () => ({
	ok: true, json: async () => players,
}) as unknown as Response) as unknown as typeof fetch;

test('a person reads as one flowing line: the name, what they are doing, and where you stand', () => {
	assert.equal(
		describePlayer({ handle: 'kastwey', activity: 'Playing', relationship: 'None' }, translate),
		'kastwey, jugando.');
	// The standing is IN the line: somebody arrowing down the list hears it without stepping into
	// the row to find out.
	assert.equal(
		describePlayer({ handle: 'ana', activity: 'AtTable', relationship: 'Friends' }, translate),
		'ana, en una mesa. Tu amigo.');
	assert.equal(
		describePlayer({ handle: 'ana', activity: 'InLobby', relationship: 'RequestSent' }, translate),
		'ana, en el lobby. Le pediste amistad.');
	// An activity the server has not taught this client yet is not a broken row: they are here.
	assert.equal(
		describePlayer({ handle: 'ana', activity: 'Inventing', relationship: 'None' }, translate),
		'ana, en el lobby.');
});

test('only whole entries are believed', () => {
	assert.deepEqual(
		parseOnlinePlayers({ players: [{ handle: 'a', activity: 'Playing', relationship: 'Friends' }] }),
		[{ handle: 'a', activity: 'Playing', relationship: 'Friends' }]);
	// A relationship this client does not know is a stranger, not a broken row.
	assert.deepEqual(
		parseOnlinePlayers({ players: [{ handle: 'a', activity: 'Playing', relationship: 'Betrothed' }] }),
		[{ handle: 'a', activity: 'Playing', relationship: 'None' }]);
	// Anything malformed is an empty room, which is a safe thing to show and never an error.
	for (const payload of [
		{ players: [{ handle: '', activity: 'Playing' }] },
		{ players: [{ handle: 'a' }] },
		{ players: 'nope' },
		{},
		null,
	]) {
		assert.deepEqual(parseOnlinePlayers(payload), [], JSON.stringify(payload));
	}
});

test('the list is one tab stop, and every row is a person', async () => {
	const h = harness();
	await h.build(answering({
		players: [
			{ handle: 'ana', activity: 'InLobby', relationship: 'None' },
			{ handle: 'kastwey', activity: 'Playing', relationship: 'Friends' },
		],
	})).refresh();

	assert.deepEqual(h.rows().map(h.lineOf),
		['ana, en el lobby.', 'kastwey, jugando. Tu amigo.']);
	// Exactly one way in, and the arrows do the rest — the same bargain the other two rosters make.
	assert.deepEqual(h.rows().map(row => row.tabIndex), [0, -1]);
	// The row's label IS its line, so what is read and what is shown cannot diverge.
	assert.equal(h.rows()[0].getAttribute('aria-label'), 'ana, en el lobby.');
	assert.equal(h.empty.hidden, true);
});

test('arrows move between people; the list is not a pile of tab stops', async () => {
	const h = harness();
	await h.build(answering({
		players: [
			{ handle: 'ana', activity: 'InLobby', relationship: 'None' },
			{ handle: 'berto', activity: 'AtTable', relationship: 'None' },
			{ handle: 'cora', activity: 'Playing', relationship: 'None' },
		],
	})).refresh();

	h.rows()[0].focus();
	const press = (key: string) => (document.activeElement as HTMLElement).dispatchEvent(
		new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

	press('ArrowDown');
	assert.equal(document.activeElement, h.rows()[1]);
	press('End');
	assert.equal(document.activeElement, h.rows()[2]);
	press('Home');
	assert.equal(document.activeElement, h.rows()[0]);
});

// What a row offers is decided entirely by where the two of them already stand.
test('each row offers exactly what its relationship allows', async () => {
	const h = harness();
	await h.build(answering({
		players: [
			{ handle: 'astranger', activity: 'InLobby', relationship: 'None' },
			{ handle: 'basked', activity: 'InLobby', relationship: 'RequestReceived' },
			{ handle: 'cfriend', activity: 'InLobby', relationship: 'Friends' },
			{ handle: 'dwaiting', activity: 'InLobby', relationship: 'RequestSent' },
			{ handle: 'eme', activity: 'InLobby', relationship: 'Self' },
		],
	})).refresh();

	const labels = h.rows().map(row => h.buttonsOf(row).map(b => b.textContent));
	assert.deepEqual(labels, [
		['Pedir amistad a astranger'],
		['Aceptar a basked', 'Rechazar a basked'],
		['Dejar de ser amigo de cfriend'],
		// A request you sent is not a thing you keep hold of — there is nothing to press.
		[],
		// Your own row is there so you can tell your visibility is on. It does nothing.
		[],
	]);
	// The buttons never take a tab stop of their own: the row is the only way in.
	assert.deepEqual(
		h.rows().flatMap(row => h.buttonsOf(row).map(b => (b as HTMLButtonElement).tabIndex)),
		[-1, -1, -1, -1]);
});

test('asking someone re-reads the list rather than guessing the new state', async () => {
	const h = harness();
	const list = h.build(h.server(
		{ players: [{ handle: 'berto', activity: 'InLobby', relationship: 'None' }] },
		{ players: [{ handle: 'berto', activity: 'InLobby', relationship: 'RequestSent' }] },
	));
	await list.refresh();

	h.buttonsOf(h.rows()[0])[0].click();
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.deepEqual(h.calls.map(c => `${c.method} ${c.url}`), [
		'GET /api/presence/online',
		'POST /api/friends/requests',
		'GET /api/presence/online',
	]);
	assert.equal(h.calls[1].body, JSON.stringify({ handle: 'berto' }));
	// The server decided what they now are, and the row says so — with nothing left to press.
	assert.equal(h.lineOf(h.rows()[0]), 'berto, en el lobby. Le pediste amistad.');
	assert.deepEqual(h.buttonsOf(h.rows()[0]), []);
});

// The reader's own action is theirs to hear. Somebody else arriving in the room is not.
test('what you did is said once, in the status region', async () => {
	const h = harness();
	const list = h.build(h.server(
		{ players: [{ handle: 'berto', activity: 'InLobby', relationship: 'RequestReceived' }] },
		{ players: [{ handle: 'berto', activity: 'InLobby', relationship: 'Friends' }] },
	));
	await list.refresh();

	h.buttonsOf(h.rows()[0])[0].click();
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.equal(h.status.textContent, 'berto ya es tu amigo.');
	assert.equal(h.list.hasAttribute('aria-live'), false);
});

test('an empty room says so, and says nothing about who chose to stay hidden', async () => {
	const h = harness();
	await h.build(answering({ players: [] })).refresh();

	assert.deepEqual(h.rows(), []);
	assert.equal(h.empty.hidden, false);
	// No count of hidden players anywhere: opting out has to leave no trace at all.
	assert.equal(h.list.textContent, '');
});

test('a server that will not answer says so once, and never blames the reader', async () => {
	const h = harness();
	const broken = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;

	const players = await h.build(broken).refresh();

	assert.deepEqual(players, []);
	assert.equal(h.error.textContent, 'No se pudo cargar la lista de jugadores.');
});

test('a refused list is the same quiet outcome as an empty one', async () => {
	const h = harness();
	const unauthorized = (async () => ({
		ok: false, json: async () => ({}),
	}) as unknown as Response) as unknown as typeof fetch;

	assert.deepEqual(await h.build(unauthorized).refresh(), []);
	assert.equal(h.empty.hidden, false);
});

// People arriving and leaving is a stream of changes nobody asked to be read. The list is a page
// you visit, not a ticker that talks over you.
test('the list never speaks on its own', async () => {
	const h = harness();
	await h.build(answering({
		players: [{ handle: 'ana', activity: 'InLobby', relationship: 'None' }],
	})).refresh();

	assert.equal(h.list.hasAttribute('aria-live'), false);
	assert.equal(h.list.getAttribute('role'), 'list');
	assert.equal(h.rows()[0].hasAttribute('aria-live'), false);
});

test('a refreshed list keeps the row the keyboard is standing on', async () => {
	const h = harness();
	const list = h.build(answering({
		players: [
			{ handle: 'ana', activity: 'InLobby', relationship: 'None' },
			{ handle: 'berto', activity: 'InLobby', relationship: 'None' },
		],
	}));
	await list.refresh();
	h.rows()[1].focus();
	const before = h.rows()[1];

	await list.refresh();

	// Reconciled, not rebuilt: the same node survives, so a screen reader is not thrown back to
	// the top of a list somebody was reading.
	assert.equal(h.rows()[1], before);
	assert.equal(document.activeElement, before);
});
