import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every page applies the chosen theme itself, in <head>, before anything is painted.
 *
 * Nothing else does it. `initThemeToggle` only READS the theme, to decide what the button should
 * be called, so a page without this block loads light however dark the player set it — and the
 * button then says "switch to light theme" over a light page, which is a lie a screen reader has
 * no way to catch. Pressing it to check stores "light" over the saved choice and changes nothing
 * on screen, so the preference is quietly lost.
 */

const root = join(import.meta.dirname, '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf-8');
const headOf = (page: string) => {
	const html = read(page);
	return html.slice(0, html.indexOf('</head>'));
};

/** Every page a player can land on. The privacy page applies it from its own module. */
const PAGES = ['src/index.html', 'src/board.html', 'src/gallery.html'];

for (const page of PAGES) {
	test(`${page} applies the saved theme before its first paint`, () => {
		const head = headOf(page);

		// Inline and in <head>: a module import runs after the first paint, which is the whole
		// problem being avoided.
		assert.match(head, /corro-theme/, `${page} never reads the saved theme before paint`);
		assert.match(head, /setAttribute\('data-theme'/, `${page} never applies a theme`);
	});

	test(`${page} prefers the saved choice over the system preference, and validates it`, () => {
		const head = headOf(page);

		// The stored value is the player's explicit choice; the system preference is only the
		// fallback, so a light desktop with dark chosen must still open dark.
		assert.ok(head.indexOf('corro-theme') < head.indexOf('prefers-color-scheme'),
			`${page} consults the system before the player's own choice`);
		assert.match(head, /=== 'dark' \|\| \w+ === 'light'/,
			`${page} does not validate what it read from storage`);
	});

	test(`a failure in ${page}'s theme script never blocks the page`, () => {
		// Storage throws in a sandboxed context, and a page that fails to open is worse than a
		// page in the wrong theme.
		assert.match(headOf(page), /catch \(e\) \{/, `${page} lets a storage failure escape`);
	});
}
