import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { focusHelpFragment, renderMarkdown } from '../src/boardHelp.js';
import { setupDom } from './helpers/dom.js';

// The board guide is shipped as Markdown by the package and rendered to HTML here. The renderer
// supports the subset a guide needs and is XSS-safe: package content is untrusted (uploads), so raw
// markup must never pass through.

test('headings, paragraphs and lists render to HTML', () => {
	const html = renderMarkdown('# Title\n\nIntro line.\n\n- one\n- two\n\n1. first\n2. second');
	assert.match(html, /<h1 id="title" tabindex="-1">Title<\/h1>/);
	assert.match(html, /<p>Intro line\.<\/p>/);
	assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
	assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
});

test('a bullet wrapped over several lines keeps its whole sentence', () => {
	// Reported from the shipped guides: authors wrap long bullets, which is ordinary Markdown.
	// The renderer used to cut the item at the line break, close the list and leave the tail as a
	// stray paragraph — so a three-point list was heard as three one-item lists.
	const html = renderMarkdown('- **5** — a ship launches\n  to your start sector.\n- **6** — roll again.');
	assert.match(html, /<ul><li><strong>5<\/strong> — a ship launches to your start sector\.<\/li>/);
	assert.match(html, /<li><strong>6<\/strong> — roll again\.<\/li><\/ul>/);
	assert.doesNotMatch(html, /<p>to your start sector/);
});

test('an unindented line after a list still starts a paragraph', () => {
	const html = renderMarkdown('- one\n- two\nA new sentence.');
	assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
	assert.match(html, /<p>A new sentence\.<\/p>/);
});

test('a nested list stays inside its parent item, and the numbering does not restart', () => {
	const html = renderMarkdown('1. Roll.\n2. Where you land:\n   - Free planet: buy it.\n   - Taxes: pay up.\n3. Doubles roll again.');
	// One list, not three: the steps after the nested block used to open a second <ol> that
	// started again at 1, so steps 3 and 4 of a turn were read out as 1 and 2.
	assert.equal(html.match(/<ol>/g)?.length, 1);
	assert.match(html, /<li>Where you land:<ul><li>Free planet: buy it\.<\/li><li>Taxes: pay up\.<\/li><\/ul><\/li>/);
	assert.match(html, /<li>Doubles roll again\.<\/li><\/ol>/);
});

test('a table renders as a table with column headers, not as a paragraph of pipes', () => {
	const html = renderMarkdown('| Squadron | Launches at |\n|---|---|\n| Red | 5 |\n| Blue | 22 |');
	assert.match(html, /<table class="board-help__table">/);
	assert.match(html, /<thead><tr><th scope="col">Squadron<\/th><th scope="col">Launches at<\/th><\/tr><\/thead>/);
	assert.match(html, /<tbody><tr><td>Red<\/td><td>5<\/td><\/tr><tr><td>Blue<\/td><td>22<\/td><\/tr><\/tbody>/);
	assert.doesNotMatch(html, /<p>[^<]*\|/);
});

test('table cells are escaped and formatted like any other text', () => {
	const html = renderMarkdown('| Who | What |\n|---|---|\n| **Red** | <img src=x onerror=alert(1)> |');
	assert.match(html, /<td><strong>Red<\/strong><\/td>/);
	assert.doesNotMatch(html, /<img/);
	assert.match(html, /&lt;img/);
});

test('a lone pipe line is not mistaken for a table', () => {
	const html = renderMarkdown('| not a table, no separator row');
	assert.doesNotMatch(html, /<table/);
	assert.match(html, /<p>\| not a table/);
});

test('inline bold, italic and code render', () => {
	const html = renderMarkdown('A **bold** and *italic* and `code` word.');
	assert.match(html, /<strong>bold<\/strong>/);
	assert.match(html, /<em>italic<\/em>/);
	assert.match(html, /<code>code<\/code>/);
});

test('http links render with safe rel/target; other schemes do not', () => {
	const ok = renderMarkdown('See [the rules](https://example.com/rules).');
	assert.match(ok, /<a href="https:\/\/example\.com\/rules" target="_blank" rel="noopener noreferrer">the rules<\/a>/);
	// A javascript: URL is not matched by the http(s)-only link rule, so it stays inert text.
	const bad = renderMarkdown('[x](javascript:alert(1))');
	assert.doesNotMatch(bad, /<a /);
});

test('raw HTML in the source is escaped, never passed through', () => {
	const html = renderMarkdown('Danger <img src=x onerror=alert(1)> and <script>bad()</script>');
	assert.doesNotMatch(html, /<img|<script/);
	assert.match(html, /&lt;img/);
	assert.match(html, /&lt;script&gt;/);
});

test('a horizontal rule renders', () => {
	assert.match(renderMarkdown('above\n\n---\n\nbelow'), /<hr>/);
});

test('a linked contents list is generated from H2 sections with stable, collision-safe ids', () => {
	const html = renderMarkdown(
		'# Guía\n\nIntroducción.\n\n## Cómo jugar\n\nTexto.\n\n## Cómo jugar\n\nMás.',
		'Contenido',
	);
	assert.match(html, /<h2 id="help-contents" tabindex="-1">Contenido<\/h2>/);
	assert.match(html, /<a href="#como-jugar">Cómo jugar<\/a>/);
	assert.match(html, /<a href="#como-jugar-2">Cómo jugar<\/a>/);
	assert.match(html, /<h2 id="como-jugar" tabindex="-1">Cómo jugar<\/h2>/);
	assert.match(html, /<h2 id="como-jugar-2" tabindex="-1">Cómo jugar<\/h2>/);
	assert.ok(html.indexOf('Introducción.') < html.indexOf('board-help__contents'),
		'the contents follows the intro and precedes the first section');
});

test('fragment links are safe and focus their heading without accepting arbitrary selectors', () => {
	setupDom();
	const root = document.createElement('div');
	root.innerHTML = renderMarkdown('# Title\n\n## Screen-reader help');
	document.body.appendChild(root);
	const heading = root.querySelector<HTMLElement>('#screen-reader-help')!;

	assert.equal(focusHelpFragment(root, '#screen-reader-help'), true);
	assert.equal(document.activeElement, heading);
	assert.equal(focusHelpFragment(root, '#missing'), false);
	assert.equal(focusHelpFragment(root, '#x"] body'), false);
	assert.doesNotMatch(renderMarkdown('[bad](javascript:alert(1))'), /<a /);
});

test('every physical package guide has help discovery, screen-reader guidance and valid contents links', () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const packagesRoot = join(here, '..', '..', 'server', 'Packages');
	const cardFamilies = new Set(['journey', 'assembly', 'draft', 'shedding', 'exploding']);

	for (const packageName of readdirSync(packagesRoot).sort()) {
		const packageDir = join(packagesRoot, packageName);
		if (!statSync(packageDir).isDirectory()) continue;
		const manifest = JSON.parse(readFileSync(join(packageDir, 'manifest.json'), 'utf8'));
		for (const lang of manifest.locales as string[]) {
			const guidePath = join(packageDir, `help.${lang}.md`);
			const guide = readFileSync(guidePath, 'utf8');
			const context = `${packageName}/help.${lang}.md`;
			const screenReaderHeading = lang === 'es'
				? '## Cómo jugar con lector de pantalla'
				: '## Playing with a screen reader';

			assert.ok(guide.includes(screenReaderHeading), `${context}: missing screen-reader section`);
			for (const shortcut of ['**F1**', '**Ctrl+F1**', '**Ctrl+Shift+F1**', '**Ctrl+F6**', '**Ctrl+Shift+R**']) {
				assert.ok(guide.includes(shortcut), `${context}: missing ${shortcut}`);
			}
			if (cardFamilies.has(manifest.gameType)) {
				assert.ok(guide.includes('**Shift+F1**'), `${context}: missing focused-card help`);
			}

			const html = renderMarkdown(guide, lang === 'es' ? 'Contenido' : 'Contents');
			// No table may survive as prose: a row that never became a table reaches a screen
			// reader as a run of vertical bars.
			assert.doesNotMatch(html, /<p>[^<]*\|/, `${context}: a table row rendered as a paragraph`);
			// Consecutive sibling lists are the signature of a bullet cut at its line break:
			// every wrapped item used to close the list and open a new one.
			assert.doesNotMatch(html, /<\/(ul|ol)>\n<(ul|ol)>/, `${context}: a list was split in two`);

			const fragments = [...html.matchAll(/<a href="#([a-z0-9][a-z0-9-]*)">/g)].map(m => m[1]);
			assert.ok(fragments.length > 0, `${context}: generated no contents links`);
			for (const fragment of fragments) {
				assert.ok(html.includes(`id="${fragment}"`), `${context}: #${fragment} has no target`);
			}
		}
	}
});
