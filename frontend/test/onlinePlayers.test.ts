import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { OnlineList, describePlayer, parseOnlinePlayers } from '../src/onlinePlayers.js';

/**
 * The list of who is connected. What matters here is what it says and what it refuses to say: a
 * handle and a coarse activity, never a display name and never which table — the question it
 * answers is "is anyone around, and can I interrupt them?", not "where are they".
 *
 * And, like every roster in this app, it is one tab stop with arrows inside it rather than a pile
 * of focus stops, and it never speaks on its own.
 */

setupDom();

const translate = (key: string, vars?: Record<string, unknown>) => {
	switch (key) {
		case 'lobby.online.row': return `${vars?.handle}, ${vars?.activity}.`;
		case 'lobby.online.activityInLobby': return 'en el lobby';
		case 'lobby.online.activityAtTable': return 'en una mesa';
		case 'lobby.online.activityPlaying': return 'jugando';
		case 'lobby.online.failed': return 'No se pudo cargar la lista de jugadores.';
		default: return key;
	}
};

function harness() {
	document.body.innerHTML = `
		<div class="online-surface" role="application">
			<ul id="online-list" role="list"></ul>
		</div>
		<p id="online-empty" hidden></p>
		<p id="online-error" role="status" aria-live="polite"></p>`;
	const list = document.getElementById('online-list') as HTMLElement;
	return {
		list,
		empty: document.getElementById('online-empty') as HTMLElement,
		error: document.getElementById('online-error') as HTMLElement,
		rows: () => Array.from(list.querySelectorAll<HTMLElement>('.online-player')),
		build: (fetchImpl: typeof fetch) => new OnlineList({
			list,
			empty: document.getElementById('online-empty'),
			error: document.getElementById('online-error'),
			t: translate,
			fetchImpl,
		}),
	};
}

const answering = (players: unknown) => (async () => ({
	ok: true, json: async () => players,
}) as unknown as Response) as unknown as typeof fetch;

test('a person reads as one flowing line: the name, and what they are doing', () => {
	assert.equal(
		describePlayer({ handle: 'kastwey', activity: 'Playing' }, translate),
		'kastwey, jugando.');
	assert.equal(
		describePlayer({ handle: 'ana', activity: 'AtTable' }, translate),
		'ana, en una mesa.');
	// An activity the server has not taught this client yet is not a broken row: they are here.
	assert.equal(
		describePlayer({ handle: 'ana', activity: 'Inventing' }, translate),
		'ana, en el lobby.');
});

test('only whole entries are believed', () => {
	assert.deepEqual(
		parseOnlinePlayers({ players: [{ handle: 'a', activity: 'Playing' }] }),
		[{ handle: 'a', activity: 'Playing' }]);
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
			{ handle: 'ana', activity: 'InLobby' },
			{ handle: 'kastwey', activity: 'Playing' },
		],
	})).refresh();

	assert.deepEqual(h.rows().map(row => row.textContent),
		['ana, en el lobby.', 'kastwey, jugando.']);
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
			{ handle: 'ana', activity: 'InLobby' },
			{ handle: 'berto', activity: 'AtTable' },
			{ handle: 'cora', activity: 'Playing' },
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
	await h.build(answering({ players: [{ handle: 'ana', activity: 'InLobby' }] })).refresh();

	assert.equal(h.list.hasAttribute('aria-live'), false);
	assert.equal(h.list.getAttribute('role'), 'list');
	assert.equal(h.rows()[0].hasAttribute('aria-live'), false);
});

test('a refreshed list keeps the row the keyboard is standing on', async () => {
	const h = harness();
	const list = h.build(answering({
		players: [
			{ handle: 'ana', activity: 'InLobby' },
			{ handle: 'berto', activity: 'InLobby' },
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
