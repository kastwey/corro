import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenIconHtml, setPackageTokens, packageTokenIds, packageTokenNameKey } from '../src/tokenIcons.js';

test('a registered package token renders its own path + exposes id/nameKey', () => {
	setPackageTokens([{ id: 'ufo', svg: 'M3 14 h18 z', nameKey: 'tokens.ufo' }]);
	assert.match(tokenIconHtml('ufo'), /<path d="M3 14 h18 z"\/>/);
	assert.deepEqual(packageTokenIds(), ['ufo']);
	assert.equal(packageTokenNameKey('ufo'), 'tokens.ufo');
	setPackageTokens(undefined);
});

test('package token path data is sanitized (no markup injection)', () => {
	setPackageTokens([{ id: 'evil', svg: 'M0 0"/><script>alert(1)</script>' }]);
	const html = tokenIconHtml('evil');
	assert.doesNotMatch(html, /<script/);          // no injected element
	assert.ok(!html.includes('alert(1)'));         // the "(1)" parens were stripped
	const d = html.match(/d="([^"]*)"/)![1];        // the path data has no markup chars
	assert.doesNotMatch(d, /[<>"]/);
	setPackageTokens(undefined);
});

test('an unregistered token id renders the neutral disc fallback (no built-in set)', () => {
	setPackageTokens(undefined);
	const html = tokenIconHtml('disc');
	assert.match(html, /<svg[^>]*>.+<\/svg>/);
	assert.ok(html.includes('<circle cx="12" cy="12" r="7"/>')); // generic disc, not a built-in icon
	assert.deepEqual(packageTokenIds(), []);
});
