import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_RESERVED_CHORDS, TYPING_COMMAND_PREFIX } from '../src/shortcuts.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

/** Every key spec the engine keymap binds. */
function keymapSpecs(): string[] {
	const keymap = JSON.parse(
		readFileSync(join(repoRoot, 'server', 'Config', 'keymap.json'), 'utf8'));
	return Object.keys(keymap);
}

/**
 * Every `keys:` literal any family declares for its own surface.
 *
 * The whole source tree, not a list of files to keep in step: a guard that has to be told about
 * each new family is a guard that silently stops covering the next one — which is precisely the
 * failure it exists to prevent.
 */
function familyShortcutSpecs(): { spec: string; where: string }[] {
	const src = join(here, '..', 'src');
	const found: { spec: string; where: string }[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) { walk(full); continue; }
			if (!entry.name.endsWith('.ts')) continue;
			const source = readFileSync(full, 'utf8');
			for (const match of source.matchAll(/\bkeys:\s*'([^']+)'/g)) {
				found.push({ spec: match[1], where: relative(src, full) });
			}
		}
	};
	walk(src);
	return found;
}

/**
 * Bindings that predate this rule and are on the reserved list anyway. Every one of them is
 * shipped, so each is a decision for the game that published it rather than something to rebind
 * in passing — and each is recorded HERE rather than quietly dropped from the list, because a
 * guard that shrinks to fit its violations stops meaning anything.
 *
 * What each one is actually up against:
 *  - Ctrl+T (trade builder) opens a tab, and Ctrl+Shift+J (release pass) the developer console:
 *    Chrome answers both before the page is asked, so they are almost certainly dead there.
 *  - Ctrl+Shift+R (chat input) is a hard reload in both browsers — it throws the page away.
 *  - Ctrl+Shift+A (action bar) is Firefox's add-ons manager and Chrome's tab search;
 *    Ctrl+Shift+B (re-enter auction) the bookmarks toolbar; Ctrl+Shift+M (manage properties)
 *    Chrome's profile menu; Ctrl+Shift+H (chat) Firefox's library.
 *  - The four Ctrl+Alt bindings (sound, voice panel, voice mute, voice speakers) are AltGr on
 *    Windows and the VoiceOver modifier on macOS.
 *
 * Adding to this list is not a way to pass the test: it is a note that something already shipped
 * broken. A NEW binding belongs on neither list.
 */
const KNOWN_PRE_EXISTING = new Set([
	'ctrl+t', 'ctrl+shift+j',
	'ctrl+shift+r', 'ctrl+shift+a', 'ctrl+shift+b', 'ctrl+shift+m', 'ctrl+shift+h',
	'ctrl+alt+m', 'ctrl+alt+v', 'ctrl+alt+x', 'ctrl+alt+a',
]);

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
		assert.match(chord, /^(ctrl|ctrl\+shift|ctrl\+alt)\+[a-z]$/, chord);
		assert.equal(chord, chord.toLowerCase(), chord);
	}
	assert.equal(new Set(BROWSER_RESERVED_CHORDS).size, BROWSER_RESERVED_CHORDS.length);
	// Ctrl+Alt is barred as a SPACE, not letter by letter: on Windows the layout turns it into
	// AltGr, so which letters type a character depends on the keyboard in front of the player.
	for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
		assert.ok(BROWSER_RESERVED_CHORDS.includes(`ctrl+alt+${letter}`), `ctrl+alt+${letter}`);
	}
});

test('every exemption is a real one, so the list cannot be padded to pass', () => {
	const reserved = new Set(BROWSER_RESERVED_CHORDS);
	const bound = new Set([
		...keymapSpecs().map(spec => spec.toLowerCase()),
		...familyShortcutSpecs().map(entry => entry.spec.toLowerCase()),
	]);

	for (const chord of KNOWN_PRE_EXISTING) {
		assert.ok(reserved.has(chord), `${chord} is exempted from a list it is not on`);
		// The day somebody rebinds one of these, its exemption has to go with it — otherwise the
		// debt list outlives the debt and nobody can tell which entries still mean anything.
		assert.ok(bound.has(chord), `${chord} is no longer bound: drop it from KNOWN_PRE_EXISTING`);
	}
});

test('the typing command prefix is free, and is not a letter', () => {
	assert.equal(BROWSER_RESERVED_CHORDS.includes(TYPING_COMMAND_PREFIX), false);
	// A letter would collide with a shortcut in the same modifier space (S and Shift+S would
	// both want Ctrl+Shift+S) and would move around with the keyboard layout. Space does not.
	assert.equal(TYPING_COMMAND_PREFIX, 'ctrl+shift+space');
	// The one key it must never be mistaken for: nothing else in the app may claim it, or a
	// keystroke would both arm the prefix and do something else.
	assert.equal(keymapSpecs().includes(TYPING_COMMAND_PREFIX), false);
	assert.deepEqual(familyShortcutSpecs().filter(e => e.spec === TYPING_COMMAND_PREFIX), []);
});
