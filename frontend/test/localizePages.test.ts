import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { localizePages, flatten, localePath, DEFAULT_LOCALE, LOCALES } =
	require('../localizePages.js') as typeof import('../localizePages.js');

const root = join(import.meta.dirname, '..');

/** Builds the pages into a throwaway directory from real sources, unless overridden. */
function build(overrides: { indexHtml?: string; locales?: Record<string, unknown> } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'corro-localize-'));
	const srcDir = join(dir, 'src');
	const distDir = join(dir, 'dist');
	const localesDir = join(dir, 'locales');
	[srcDir, distDir, localesDir].forEach(d => mkdirSync(d, { recursive: true }));

	writeFileSync(join(srcDir, 'index.html'),
		overrides.indexHtml ?? readFileSync(join(root, 'src/index.html'), 'utf-8'));
	for (const locale of LOCALES) {
		writeFileSync(join(localesDir, `${locale}.json`), JSON.stringify(
			overrides.locales?.[locale] ?? JSON.parse(readFileSync(join(root, `i18n/locales/${locale}.json`), 'utf-8'))));
	}

	localizePages({ srcDir, distDir, localesDir });
	return {
		read: (file: string) => readFileSync(join(distDir, file), 'utf-8'),
		exists: (file: string) => existsSync(join(distDir, file)),
	};
}

test('the default language is served at the root and Spanish from its own path', () => {
	const out = build();

	assert.match(out.read('index.html'), /<html lang="en"/);
	assert.match(out.read('es/index.html'), /<html lang="es"/);
});

test('the Spanish page carries Spanish copy, not the English fallback it was built from', () => {
	const out = build();
	const spanish = out.read('es/index.html');
	const english = out.read('index.html');

	const strings = flatten(JSON.parse(readFileSync(join(root, 'i18n/locales/es.json'), 'utf-8')));
	const englishStrings = flatten(JSON.parse(readFileSync(join(root, 'i18n/locales/en.json'), 'utf-8')));
	// A key whose two languages genuinely differ, so the assertion cannot pass by coincidence.
	// Read from the locale files rather than spelled out here: the copy is the product's to
	// reword, and a test that pins the words breaks every time somebody improves them.
	assert.notEqual(strings['lobby.createGame'], undefined);
	assert.notEqual(strings['lobby.createGame'], englishStrings['lobby.createGame']);
	assert.match(spanish, new RegExp(strings['lobby.createGame'] as string));
	assert.doesNotMatch(spanish, new RegExp(englishStrings['lobby.createGame'] as string));
	// …and the English page is untouched by the Spanish pass.
	assert.match(english, new RegExp(englishStrings['lobby.createGame'] as string));
});

test('translated attributes are applied too, not just element text', () => {
	// aria-labels are the ones a screen-reader user actually hears; leaving them English while
	// the visible text is Spanish is the worst of both.
	const out = build();
	const spanish = out.read('es/index.html');
	const strings = flatten(JSON.parse(readFileSync(join(root, 'i18n/locales/es.json'), 'utf-8')));

	assert.match(spanish, new RegExp(`aria-label="${strings['language.selectLabel'] as string}"`));
});

test('copy that waited for the locale is revealed, since there is nothing left to wait for', () => {
	const out = build({
		indexHtml: '<html><head><title>t</title></head><body>'
			+ '<p data-i18n="lobby.createGame" data-i18n-defer hidden>Create New Game</p></body></html>',
	});

	const spanish = out.read('es/index.html');
	assert.doesNotMatch(spanish, /data-i18n-defer/);
	assert.doesNotMatch(spanish, /hidden/);
});

test('every language version cross-links the others, including an x-default', () => {
	const out = build();

	for (const file of ['index.html', 'es/index.html']) {
		const html = out.read(file);
		for (const locale of LOCALES) {
			assert.match(html, new RegExp(`hreflang="${locale}" href="${localePath(locale)}"`),
				`${file} does not point at ${locale}`);
		}
		assert.match(html, new RegExp(`hreflang="x-default" href="${localePath(DEFAULT_LOCALE)}"`),
			`${file} declares no x-default`);
	}
});

test('only the default page redirects, and only on the saved cookie', () => {
	const out = build();

	// A crawler sends no cookie, so it always reaches the page it asked for and can index it.
	assert.match(out.read('index.html'), /corro_language/);
	assert.match(out.read('index.html'), /location\.replace/);
	// The Spanish page must NOT redirect: two pages bouncing at each other is an infinite loop.
	assert.doesNotMatch(out.read('es/index.html'), /location\.replace/);
});

test('the subdirectory page resolves its assets and its board link from the site root', () => {
	// Without this, /es/ would ask for /es/dist/app.js and /es/board.html — neither exists.
	const out = build();

	assert.match(out.read('es/index.html'), /<base href="\/">/);
	assert.doesNotMatch(out.read('index.html'), /<base href/);
});

test('a key missing from one language fails the build instead of shipping half a page', () => {
	// The whole point of generating this: drift becomes a red build, not a page that is
	// English in the places somebody forgot.
	assert.throws(
		() => build({
			indexHtml: '<html><head><title>t</title></head><body><p data-i18n="nope.missing">x</p></body></html>',
			locales: { en: { nope: { missing: 'x' } }, es: {} },
		}),
		/missing from es\.json: nope\.missing/);
});
