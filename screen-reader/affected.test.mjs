// affected.test.mjs — the decision that wakes the Windows runner, pinned down.
//
// Run with `node --test screen-reader/affected.test.mjs` (the workflow does, before deciding).

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
	ALWAYS, GALLERY_ENTRY, GALLERY_PAGE, REPO,
	decide, importGraph, linkedStylesheets, listenedFiles, resolveImport, runtimeImports,
} from './affected.mjs';

test('runtimeImports keeps static, side-effect and dynamic relative imports and drops the rest', () => {
	const source = `
import { a } from './a.js';
import b, { c } from '../b.js';
import type { T } from './types.js';
import './sideEffect.js';
export { d } from './d.js';
export type { U } from './u.js';
import i18next from 'i18next';
const m = await import('./lazy.js');
`;
	assert.deepEqual(runtimeImports(source).sort(), ['../b.js', './a.js', './d.js', './lazy.js', './sideEffect.js']);
});

test('resolveImport maps a compiled .js specifier back onto its .ts source', () => {
	assert.equal(resolveImport('frontend/src/gallery/stories/x.ts', '../../comboBox.js'), 'frontend/src/comboBox.ts');
	assert.equal(resolveImport('frontend/src/gallery/index.ts', './catalogue.js'), 'frontend/src/gallery/catalogue.ts');
});

test('importGraph walks every reachable file once and keeps a missing file as a leaf', () => {
	const files = {
		'a/entry.ts': "import './one.js'; import { x } from '../lib/two.js';",
		'a/one.ts': "import './entry.js'; import './gone.js';",
		'lib/two.ts': 'export const x = 1;',
	};
	const read = file => files[file] ?? null;
	assert.deepEqual(importGraph('a/entry.ts', read), ['a/entry.ts', 'a/gone.ts', 'a/one.ts', 'lib/two.ts']);
});

test('linkedStylesheets maps the page\'s link tags onto the css sources, whatever the attribute order', () => {
	const html = '<link rel="stylesheet" href="css/theme.css">\n<link href="css/x.css" rel="stylesheet">\n<link rel="icon" href="i.png">';
	assert.deepEqual(linkedStylesheets(html), ['frontend/css/theme.css', 'frontend/css/x.css']);
});

test('decide runs for a listened file or the suite\'s own files, and not otherwise', () => {
	const listened = ['frontend/src/comboBox.ts', GALLERY_PAGE];
	assert.deepEqual(decide(['docs/client.md', 'server/Program.cs'], listened), { run: false, reasons: [] });
	assert.deepEqual(decide(['frontend/src/comboBox.ts'], listened), { run: true, reasons: ['frontend/src/comboBox.ts'] });
	for (const prefix of ALWAYS) {
		const file = prefix.endsWith('/') ? `${prefix}x` : prefix;
		assert.equal(decide([file], listened).run, true, `${file} must always count`);
	}
	assert.equal(decide([], listened).run, false);
});

// The real repository: the derived list must reach the widgets the stories mount and the sheets
// the page wears. Changing a story's import or a page stylesheet must change this list by itself.
test('the real gallery graph reaches the widgets, the page and its stylesheets', () => {
	const read = file => {
		const absolute = path.join(REPO, file);
		return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
	};
	const listened = listenedFiles(read);
	for (const expected of [
		GALLERY_ENTRY,
		GALLERY_PAGE,
		'frontend/src/gallery/catalogue.ts',
		'frontend/src/popupMenu.ts',
		'frontend/src/tabs.ts',
		'frontend/src/comboBox.ts',
		'frontend/src/rovingToolbar.ts',
		'frontend/src/accessibleList.ts',
		'frontend/src/dialogManager.ts',
		'frontend/css/gallery.css',
		'frontend/css/action-bar.css',
		'frontend/css/theme.css',
	]) {
		assert.ok(listened.includes(expected), `${expected} should be listened to`);
	}
	// Every listened source exists: a stale path here would be a story importing a file that is
	// not there, which the build would also refuse.
	for (const file of listened) assert.ok(read(file) !== null, `${file} does not exist`);
	// And the walk stays inside the client: the server and the game surfaces are not the gallery.
	assert.ok(listened.every(file => file.startsWith('frontend/')));
	assert.ok(!listened.includes('frontend/src/app.ts'), 'the board entry is not reachable from the gallery');
});
