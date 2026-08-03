import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import {
	initializeSiteMetrics, parseSiteMetrics, renderActiveTables,
} from '../src/siteMetrics.js';

/**
 * The footer's "is anyone else here?" line. Two properties matter more than the number itself: a
 * deployment that has not turned it on says NOTHING (rather than showing a zero, which reads as
 * "empty" instead of "quiet"), and the line is never a live region — a footer that talks over
 * somebody reading the page is worse than a footer with one fact fewer.
 */

setupDom();

const translate = (key: string, vars?: Record<string, unknown>) =>
	key === 'footer.activeTables' ? `Mesas activas: ${vars?.count}.` : key;

function footer(): HTMLElement {
	document.body.innerHTML = '<p id="active-tables" hidden></p>';
	return document.getElementById('active-tables') as HTMLElement;
}

test('a published count reaches the footer as one flowing line', () => {
	const element = footer();

	assert.equal(renderActiveTables(element, { activeTables: 27 }, translate), true);

	assert.equal(element.hidden, false);
	assert.equal(element.textContent, 'Mesas activas: 27.');
});

test('a deployment that publishes nothing shows nothing — not a zero', () => {
	const element = footer();

	assert.equal(renderActiveTables(element, { activeTables: null }, translate), false);

	assert.equal(element.hidden, true);
	assert.equal(element.textContent, '');
});

// An empty server is a real, publishable answer: the host asked for the number, so they get it.
test('zero is a number like any other when the host asked for it', () => {
	const element = footer();
	renderActiveTables(element, { activeTables: 0 }, translate);
	assert.equal(element.hidden, false);
	assert.equal(element.textContent, 'Mesas activas: 0.');
});

test('the line is never a live region, however it is filled', () => {
	const element = footer();
	renderActiveTables(element, { activeTables: 5 }, translate);

	// Not aria-live, not role=status/alert, not aria-atomic: this is read when the reader
	// arrives at the footer, never spoken over whatever they are doing.
	assert.equal(element.hasAttribute('aria-live'), false);
	assert.equal(element.hasAttribute('aria-atomic'), false);
	assert.equal(element.getAttribute('role'), null);
});

test('only a whole, non-negative count is believed', () => {
	assert.deepEqual(parseSiteMetrics({ activeTables: 3 }), { activeTables: 3 });
	assert.deepEqual(parseSiteMetrics({ activeTables: 0 }), { activeTables: 0 });
	// Anything else is the same safe outcome as a host who never turned the setting on.
	for (const payload of [
		{ activeTables: null },
		{ activeTables: '7' },
		{ activeTables: 2.5 },
		{ activeTables: -1 },
		{},
		null,
		'not an object',
	]) {
		assert.deepEqual(parseSiteMetrics(payload), { activeTables: null }, JSON.stringify(payload));
	}
});

test('the lobby asks once, and a server that will not answer costs it nothing', async () => {
	const element = footer();
	const calls: string[] = [];
	const ok = async (url: string) => {
		calls.push(url);
		return { ok: true, json: async () => ({ activeTables: 12 }) } as unknown as Response;
	};

	assert.deepEqual(
		await initializeSiteMetrics(element, translate, ok as unknown as typeof fetch),
		{ activeTables: 12 });
	assert.deepEqual(calls, ['/api/config/metrics'], 'asked once, and only once');
	assert.equal(element.textContent, 'Mesas activas: 12.');

	// Offline, a 500, a body that is not JSON: the footer says nothing and the lobby is unaffected.
	for (const broken of [
		async () => { throw new Error('offline'); },
		async () => ({ ok: false, json: async () => ({}) }) as unknown as Response,
		async () => ({ ok: true, json: async () => { throw new Error('not json'); } }) as unknown as Response,
	]) {
		const quiet = footer();
		assert.deepEqual(
			await initializeSiteMetrics(quiet, translate, broken as unknown as typeof fetch),
			{ activeTables: null });
		assert.equal(quiet.hidden, true);
	}
});

test('a missing element is not an error — a page without the footer line just has none', () => {
	assert.equal(renderActiveTables(null, { activeTables: 4 }, translate), false);
});
