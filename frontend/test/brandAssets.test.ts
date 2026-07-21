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

test('the lobby exposes one textual heading and keeps both visual logo variants decorative', () => {
	const document = readDocument(`${SRC_DIR}index.html`);
	const header = document.querySelector('main > header.lobby-header');
	const heading = document.querySelector('h1.brand-heading');
	const images = heading?.querySelectorAll('img') ?? [];

	assert.ok(header);
	assert.ok(heading);
	assert.equal(header.firstElementChild, heading, 'the brand leads the lobby header');
	assert.equal(heading.querySelector('.sr-only[data-i18n="lobby.title"]')?.textContent, 'Corro');
	assert.equal(images.length, 2);
	for (const image of images) assert.equal(image.getAttribute('alt'), '');
	assert.equal(heading.querySelector('.brand-logo')?.getAttribute('aria-hidden'), 'true');

	const preferences = header.querySelector('.language-selector');
	assert.ok(preferences, 'language and theme preferences belong below the brand');
	assert.equal(header.lastElementChild, preferences);
	assert.equal(preferences.closest('nav'), null, 'preferences are controls, not site navigation');
});

for (const page of ['index.html', 'board.html']) {
	test(`${page} offers matching light and dark SVG favicons`, () => {
		const document = readDocument(`${SRC_DIR}${page}`);
		const icons = [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')];

		assert.deepEqual(
			icons.map(icon => ({ href: icon.getAttribute('href'), media: icon.media, type: icon.type })),
			[
				{
					href: 'assets/brand/corro-favicon-light.svg',
					media: '(prefers-color-scheme: light)',
					type: 'image/svg+xml',
				},
				{
					href: 'assets/brand/corro-favicon-dark.svg',
					media: '(prefers-color-scheme: dark)',
					type: 'image/svg+xml',
				},
			],
		);
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