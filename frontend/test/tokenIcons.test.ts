import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenIconHtml, setPackageTokens, packageTokenIds, packageTokenNameKey } from '../src/tokenIcons.js';

test('a registered package token renders its own drawing + exposes id/nameKey', () => {
	setPackageTokens([{ id: 'ufo', svg: '<path d="M3 14 h18 z" fill="#ffcc00"/><circle cx="12" cy="8" r="3"/>', nameKey: 'tokens.ufo' }]);
	assert.match(tokenIconHtml('ufo'), /<path d="M3 14 h18 z" fill="#ffcc00"\/><circle cx="12" cy="8" r="3"\/>/);
	assert.match(tokenIconHtml('ufo'), /fill="currentColor"/); // the wrapper: unfilled parts take the player colour
	assert.deepEqual(packageTokenIds(), ['ufo']);
	assert.equal(packageTokenNameKey('ufo'), 'tokens.ufo');
	setPackageTokens(undefined);
});

test('package token art is validated again (no markup injection) and legacy path data still draws', () => {
	setPackageTokens([
		{ id: 'evil', svg: '<path d="M0 0h1v1z"/><script>alert(1)</script>' },
		{ id: 'legacy-evil', svg: 'M0 0"/><script>alert(1)</script>' },
		{ id: 'legacy', svg: 'M7 3h10v12h-10z' },
	]);
	for (const id of ['evil', 'legacy-evil']) {
		const rejected = tokenIconHtml(id);
		assert.doesNotMatch(rejected, /<script/);
		assert.ok(!rejected.includes('alert'));
		assert.ok(rejected.includes('<circle cx="12" cy="12" r="7"/>')); // outside the subset: the neutral disc
	}
	assert.match(tokenIconHtml('legacy'), /<path d="M7 3h10v12h-10z"\/>/);
	setPackageTokens(undefined);
});

test('an unregistered token id renders the neutral disc fallback (no built-in set)', () => {
	setPackageTokens(undefined);
	const html = tokenIconHtml('disc');
	assert.match(html, /<svg[^>]*>.+<\/svg>/);
	assert.ok(html.includes('<circle cx="12" cy="12" r="7"/>')); // generic disc, not a built-in icon
	assert.deepEqual(packageTokenIds(), []);
});
