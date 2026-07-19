import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/boardHelp.js';

// The board guide is shipped as Markdown by the package and rendered to HTML here. The renderer
// supports the subset a guide needs and is XSS-safe: package content is untrusted (uploads), so raw
// markup must never pass through.

test('headings, paragraphs and lists render to HTML', () => {
	const html = renderMarkdown('# Title\n\nIntro line.\n\n- one\n- two\n\n1. first\n2. second');
	assert.match(html, /<h1>Title<\/h1>/);
	assert.match(html, /<p>Intro line\.<\/p>/);
	assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
	assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
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
