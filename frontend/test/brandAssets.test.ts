import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const FRONTEND_DIR = fileURLToPath(new URL('../', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const BRAND_DIR = fileURLToPath(new URL('../assets/brand/', import.meta.url));

const readDocument = (file: string, contentType = 'text/html') => new JSDOM(
	readFileSync(file, 'utf8'),
	{ contentType },
).window.document;

for (const surface of ['light', 'dark']) {
	test(`the ${surface} logo preserves the equal-circle brand geometry`, () => {
		const document = readDocument(`${BRAND_DIR}corro-logo-on-${surface}.svg`, 'image/svg+xml');

		assert.equal(document.documentElement.getAttribute('viewBox'), '0 0 420 120');
		assert.equal(document.documentElement.getAttribute('width'), '420');
		assert.equal(document.documentElement.getAttribute('height'), '120');
		assert.equal(document.querySelectorAll('[data-participant]').length, 6);
		assert.equal(document.querySelectorAll('[data-spoke]').length, 6);
		assert.equal(document.querySelectorAll('[data-connection]').length, 1);
		assert.equal(document.querySelectorAll('[data-shared-centre]').length, 1);
		assert.equal(document.querySelectorAll('[data-wordmark]').length, 1);
		assert.equal(document.querySelector('title')?.textContent, 'Corro');
	});

	test(`the ${surface} favicon remains a self-contained square mark`, () => {
		const document = readDocument(`${BRAND_DIR}corro-favicon-${surface}.svg`, 'image/svg+xml');

		assert.equal(document.documentElement.getAttribute('viewBox'), '0 0 64 64');
		assert.equal(document.documentElement.getAttribute('width'), '64');
		assert.equal(document.documentElement.getAttribute('height'), '64');
		assert.equal(document.querySelectorAll('[data-participant]').length, 6);
		assert.equal(document.querySelectorAll('[data-spoke]').length, 6);
		assert.equal(document.querySelectorAll('[data-shared-centre]').length, 1);
		assert.ok(document.querySelector('rect[rx="15"]'), 'the favicon has a distinct rounded tile');
	});
}

test('the lobby ships an accessible configurable text identity and optional decorative logo mount', () => {
	const document = readDocument(`${SRC_DIR}index.html`);
	const header = document.querySelector('main > header.lobby-header');
	const heading = document.querySelector('h1.brand-heading');

	assert.ok(header);
	assert.ok(heading);
	assert.equal(header.firstElementChild?.querySelector('h1'), heading, 'the brand leads the lobby header');
	assert.equal(heading.querySelector('[data-site-title]')?.textContent, 'All Welcome');
	assert.equal(heading.querySelector('[data-site-logo]')?.getAttribute('aria-hidden'), 'true');
	assert.ok(heading.querySelector('[data-site-logo]')?.hasAttribute('hidden'));
	assert.equal(header.querySelector('[data-site-tagline]')?.textContent, 'Play together, play your way.');

	const preferences = header.querySelector('.language-selector');
	assert.ok(preferences, 'language and theme preferences belong below the brand');
	assert.equal(header.lastElementChild, preferences);
	assert.equal(preferences.closest('nav'), null, 'preferences are controls, not site navigation');
});

for (const page of ['index.html', 'board.html']) {
	test(`${page} does not mislabel an unconfigured host with the Corro favicon`, () => {
		const document = readDocument(`${SRC_DIR}${page}`);
		assert.equal(document.querySelectorAll('link[rel="icon"]').length, 0);
	});
}

test('all referenced brand files exist in the frontend asset pipeline', () => {
	for (const file of [
		'corro-logo-on-light.svg',
		'corro-logo-on-dark.svg',
		'corro-favicon-light.svg',
		'corro-favicon-dark.svg',
	]) {
		assert.ok(readFileSync(`${FRONTEND_DIR}assets/brand/${file}`).length > 0, `${file} is not empty`);
	}
});