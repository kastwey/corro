import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import {
	initializeSiteMetrics, parseSiteMetrics, renderActivity,
} from '../src/siteMetrics.js';

/**
 * The footer's "is anyone else here?" line. Three properties matter more than the numbers: a
 * deployment that has not turned it on says NOTHING (rather than showing zeros, which read as
 * "empty" instead of "quiet"), the two counts are one sentence and travel together, and the line
 * is never a live region — a footer that talks over somebody reading the page is worse than a
 * footer with one fact fewer.
 */

setupDom();

/** Stands in for the translation layer, including the plural selection i18next does from `count`. */
const translate = (key: string, vars?: Record<string, unknown>) => {
	const count = vars?.count as number | undefined;
	switch (key) {
		case 'footer.activeTables':
			return count === 1 ? '1 mesa activa' : `${count} mesas activas`;
		case 'footer.connectedPlayers':
			return count === 1 ? '1 jugador conectado' : `${count} jugadores conectados`;
		case 'footer.activity':
			return `${vars?.tables}, ${vars?.players}.`;
		default:
			return key;
	}
};

function footer(): HTMLElement {
	document.body.innerHTML = '<p id="site-activity" hidden></p>';
	return document.getElementById('site-activity') as HTMLElement;
}

test('a published deployment states both facts as one flowing line', () => {
	const element = footer();

	assert.equal(renderActivity(element, { activeTables: 7, connectedPlayers: 12 }, translate), true);

	assert.equal(element.hidden, false);
	assert.equal(element.textContent, '7 mesas activas, 12 jugadores conectados.');
});

// "1 mesas activas, 1 jugadores conectados" is the kind of line that tells a reader nobody
// listened to it. Each half carries its own singular.
test('one of each reads as one of each', () => {
	const element = footer();
	renderActivity(element, { activeTables: 1, connectedPlayers: 1 }, translate);
	assert.equal(element.textContent, '1 mesa activa, 1 jugador conectado.');
});

test('a deployment that publishes nothing shows nothing — not zeros', () => {
	const element = footer();

	assert.equal(
		renderActivity(element, { activeTables: null, connectedPlayers: null }, translate), false);

	assert.equal(element.hidden, true);
	assert.equal(element.textContent, '');
});

// An empty server is a real, publishable answer: the host asked for the numbers, so they get them.
test('zero is a number like any other when the host asked for it', () => {
	const element = footer();
	renderActivity(element, { activeTables: 0, connectedPlayers: 0 }, translate);
	assert.equal(element.hidden, false);
	assert.equal(element.textContent, '0 mesas activas, 0 jugadores conectados.');
});

test('the line is never a live region, however it is filled', () => {
	const element = footer();
	renderActivity(element, { activeTables: 5, connectedPlayers: 9 }, translate);

	// Not aria-live, not role=status/alert, not aria-atomic: this is read when the reader
	// arrives at the footer, never spoken over whatever they are doing.
	assert.equal(element.hasAttribute('aria-live'), false);
	assert.equal(element.hasAttribute('aria-atomic'), false);
	assert.equal(element.getAttribute('role'), null);
});

test('only whole, non-negative counts are believed', () => {
	assert.deepEqual(
		parseSiteMetrics({ activeTables: 3, connectedPlayers: 4 }),
		{ activeTables: 3, connectedPlayers: 4 });
	assert.deepEqual(
		parseSiteMetrics({ activeTables: 0, connectedPlayers: 0 }),
		{ activeTables: 0, connectedPlayers: 0 });

	// Anything else is the same safe outcome as a host who never turned the setting on — and half
	// a payload drops the other half with it, because half a sentence is worse than none.
	for (const payload of [
		{ activeTables: null, connectedPlayers: null },
		{ activeTables: 7 },
		{ connectedPlayers: 7 },
		{ activeTables: 7, connectedPlayers: '12' },
		{ activeTables: 2.5, connectedPlayers: 3 },
		{ activeTables: -1, connectedPlayers: 3 },
		{},
		null,
		'not an object',
	]) {
		assert.deepEqual(
			parseSiteMetrics(payload),
			{ activeTables: null, connectedPlayers: null },
			JSON.stringify(payload));
	}
});

test('the lobby asks once, and a server that will not answer costs it nothing', async () => {
	const element = footer();
	const calls: string[] = [];
	const ok = async (url: string) => {
		calls.push(url);
		return {
			ok: true,
			json: async () => ({ activeTables: 12, connectedPlayers: 30 }),
		} as unknown as Response;
	};

	assert.deepEqual(
		await initializeSiteMetrics(element, translate, ok as unknown as typeof fetch),
		{ activeTables: 12, connectedPlayers: 30 });
	assert.deepEqual(calls, ['/api/config/metrics'], 'asked once, and only once');
	assert.equal(element.textContent, '12 mesas activas, 30 jugadores conectados.');

	// Offline, a 500, a body that is not JSON: the footer says nothing and the lobby is unaffected.
	for (const broken of [
		async () => { throw new Error('offline'); },
		async () => ({ ok: false, json: async () => ({}) }) as unknown as Response,
		async () => ({ ok: true, json: async () => { throw new Error('not json'); } }) as unknown as Response,
	]) {
		const quiet = footer();
		assert.deepEqual(
			await initializeSiteMetrics(quiet, translate, broken as unknown as typeof fetch),
			{ activeTables: null, connectedPlayers: null });
		assert.equal(quiet.hidden, true);
	}
});

test('a missing element is not an error — a page without the footer line just has none', () => {
	assert.equal(renderActivity(null, { activeTables: 4, connectedPlayers: 8 }, translate), false);
});
