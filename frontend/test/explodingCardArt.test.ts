import test from 'node:test';
import assert from 'node:assert/strict';
import {
	explodingCardArtHtml, explodingCardBackHtml, explodingEmptyCardHtml,
} from '../src/explodingCardArt.js';
import type { ExplodingCardDef } from '../src/models.js';

function def(type: string, svg?: string): ExplodingCardDef {
	return { id: 'content-owned-id', type, count: 1, nameKey: 'cards.name', svg, artColor: '#8E3041' };
}

test('every exploding mechanic receives a neutral face without package knowledge', () => {
	const roles: Array<[string, string]> = [
		['bomb', 'bomb'], ['defuse', 'defuse'], ['nope', 'nope'], ['attack', 'attack'],
		['skip', 'skip'], ['favor', 'favor'], ['shuffle', 'shuffle'],
		['seeFuture', 'future'], ['cat', 'cat'],
	];
	for (const [type, face] of roles) {
		const html = explodingCardArtHtml(def(type), `Name ${type}`);
		assert.match(html, new RegExp(`xcard--${face}`));
		assert.match(html, /data-card-art="neutral"/);
		assert.match(html, new RegExp(`Name ${type}`));
	}
});

test('package path-data overrides the neutral drawing without changing the frame or name', () => {
	const html = explodingCardArtHtml(def('cat', 'M4 4h56v56z'), 'Package character');
	assert.match(html, /xcard--cat/);
	assert.match(html, /data-card-art="package"/);
	assert.match(html, /--xcard-accent:#8e3041/);
	assert.match(html, /d="M4 4h56v56z"/);
	assert.match(html, /Package character/);
	assert.doesNotMatch(html, /data-card-art="neutral"/);
});

test('unknown roles still get a safe neutral fallback and names are escaped', () => {
	const html = explodingCardArtHtml(def('future-package-role'), '<img src=x onerror=alert(1)>');
	assert.match(html, /xcard--mystery/);
	assert.match(html, /data-card-art="neutral"/);
	assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	assert.doesNotMatch(html, /<img/);
});

test('the deck back supports a count while the empty discard stays card-shaped', () => {
	assert.match(explodingCardBackHtml('37'), /xcard--back/);
	assert.match(explodingCardBackHtml('37'), /xcard__back-label">37</);
	assert.doesNotMatch(explodingCardBackHtml(), /xcard__back-label/);
	assert.match(explodingEmptyCardHtml(), /xcard--empty/);
	assert.match(explodingEmptyCardHtml(), /xcard__empty-label">—</);
});
