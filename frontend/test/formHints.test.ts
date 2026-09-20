import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const CSS_DIR = fileURLToPath(new URL('../css/', import.meta.url));

/**
 * Some sources are stored as UTF-16. Read as UTF-8 their text becomes invisible to a scan like
 * the one below — every letter separated by a NUL — so the file would silently pass.
 */
function readText(file: string): string {
	const bytes = readFileSync(file);
	return bytes.includes(0) ? bytes.toString('utf16le') : bytes.toString('utf8');
}

function sourceFiles(dir: string, extensions: string[]): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(full, extensions);
		return extensions.includes(path.extname(entry.name)) ? [full] : [];
	});
}

/**
 * A hint is a hint wherever it sits: the paragraph under a field and the paragraph under a block
 * heading are the same kind of line, and the lobby showed them in two different greys for as long
 * as there were two classes for them. One class, `form-hint`, so whatever is worked out about how
 * a hint should read reaches all of them at once.
 *
 * The arrivals hint is the one deliberate exception: it belongs to the account settings screen,
 * which styles its own hints (`account-settings-hint`, smaller) everywhere else it renders them.
 */
test('every hint a lobby field points at is the lobby hint', () => {
	const document = new JSDOM(readText(path.join(SRC_DIR, 'index.html'))).window.document;
	const exceptions = new Set(['settings-arrivals-hint']);

	const described = [...document.querySelectorAll('input, select')]
		.flatMap(field => (field.getAttribute('aria-describedby') ?? '').split(/\s+/))
		.filter(id => id && !exceptions.has(id));
	assert.ok(described.length >= 3, 'the lobby fields still name their hints');

	for (const id of described) {
		const hint = document.getElementById(id);
		assert.ok(hint, `#${id} is named by a field but does not exist`);
		if (hint.tagName !== 'P') continue; // sr-only spans and live regions are not hints
		assert.ok(hint.classList.contains('form-hint'),
			`#${id} is a hint paragraph, so it belongs to form-hint rather than `
			+ `"${hint.className}" — two classes mean two looks on one form`);
	}
});

/**
 * ::placeholder styled a hint that no longer exists: the three fields that had one now carry a
 * paragraph instead. Rules left behind by a change are the ones nobody dares delete later,
 * because nothing says whether they still matter — so the rule and its reason go together.
 */
test('no stylesheet dresses a placeholder while nothing has one', () => {
	const markup = sourceFiles(SRC_DIR, ['.html', '.ts'])
		.map(readText)
		.join('\n');
	const placeholders = /placeholder\s*=\s*["']|\.placeholder\s*=|setAttribute\(\s*['"]placeholder/
		.test(markup);
	if (placeholders) return;

	for (const sheet of [...sourceFiles(CSS_DIR, ['.css']), fileURLToPath(new URL('../styles.css', import.meta.url))]) {
		assert.doesNotMatch(readText(sheet), /::placeholder/,
			`${path.basename(sheet)} styles ::placeholder, and no field asks for one`);
	}
});
