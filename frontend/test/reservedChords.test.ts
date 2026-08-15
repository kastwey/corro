import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_RESERVED_CHORDS } from '../src/shortcuts.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

/** Every key spec the engine keymap binds. */
function keymapSpecs(): string[] {
	const keymap = JSON.parse(
		readFileSync(join(repoRoot, 'server', 'Config', 'keymap.json'), 'utf8'));
	return Object.keys(keymap);
}

/** Every `keys:` / `typingKeys:` literal a family declares for its own surface. */
function familyShortcutSpecs(): { spec: string; where: string }[] {
	const found: { spec: string; where: string }[] = [];
	for (const file of ['categoriesBoard.ts', 'forbiddenBoard.ts', 'cardBoardShell.ts', 'handPanel.ts']) {
		const source = readFileSync(join(here, '..', 'src', file), 'utf8');
		for (const match of source.matchAll(/\b(?:typingKeys|keys):\s*'([^']+)'/g)) {
			found.push({ spec: match[1], where: file });
		}
	}
	return found;
}

/**
 * Two bindings predate this rule and are almost certainly dead in Chrome, which answers both
 * before the page is asked: Ctrl+T opens a tab instead of the trade builder, and Ctrl+Shift+J
 * opens the developer console instead of spending a release pass. They are recorded here rather
 * than quietly dropped from the reserved list — the guard has to keep meaning what it says — and
 * rather than rebound in passing, because moving a shipped shortcut is the property game's call.
 */
const KNOWN_PRE_EXISTING = new Set(['ctrl+t', 'ctrl+shift+j']);

test('no shortcut is one the browser answers first, or one that edits text', () => {
	const reserved = new Set(BROWSER_RESERVED_CHORDS);
	const offenders = [
		...keymapSpecs().map(spec => ({ spec, where: 'server/Config/keymap.json' })),
		...familyShortcutSpecs(),
	]
		.filter(entry => reserved.has(entry.spec.toLowerCase()))
		.filter(entry => !KNOWN_PRE_EXISTING.has(entry.spec.toLowerCase()));

	assert.deepEqual(
		offenders,
		[],
		'A binding claims a chord the browser handles before the page sees it (new private window, '
		+ 'reopen tab, developer tools, bookmark manager…) or one that means something inside a '
		+ 'text box (paste as plain text, redo). Pick another; see BROWSER_RESERVED_CHORDS.');
});

test('the reserved list itself stays well-formed, so a typo cannot silently disable it', () => {
	for (const chord of BROWSER_RESERVED_CHORDS) {
		assert.match(chord, /^(ctrl|ctrl\+shift)\+[a-z]$/, chord);
		assert.equal(chord, chord.toLowerCase(), chord);
	}
	assert.equal(new Set(BROWSER_RESERVED_CHORDS).size, BROWSER_RESERVED_CHORDS.length);
});
