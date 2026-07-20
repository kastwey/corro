import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyCardArtHtml, journeyCardBackHtml, journeyHazardIconSvg, journeyShieldIconSvg } from '../src/journeyCardArt.js';
import type { JourneyCardDef } from '../src/models.js';

function def(over: Partial<JourneyCardDef>): JourneyCardDef {
	return { id: 'content-id', type: 'attack', value: 0, count: 1, nameKey: 'cards.x', ...over } as JourneyCardDef;
}

test('a distance fallback shows its kilometres without requiring package art', () => {
	const html = journeyCardArtHtml(def({ type: 'distance', value: 100 }), '100 kilómetros');
	assert.match(html, /jcard--distance/);
	assert.match(html, /jcard__value">100</);
	assert.match(html, /jcard__unit">km</);
	assert.match(html, /100 kilómetros/);
});

test('generic attack, remedy and immunity mechanics receive distinct neutral icons', () => {
	const attack = journeyCardArtHtml(def({ type: 'attack', kind: 'package-kind-a' }), 'Attack');
	const otherAttack = journeyCardArtHtml(def({ type: 'attack', kind: 'package-kind-b' }), 'Other');
	const remedy = journeyCardArtHtml(def({ type: 'remedy', kind: 'package-kind-a' }), 'Remedy');
	const immunity = journeyCardArtHtml(def({ type: 'immunity' }), 'Immunity');
	assert.match(attack, /jcard--attack/);
	assert.match(remedy, /jcard--remedy/);
	assert.match(immunity, /jcard--immunity/);
	assert.equal(
		attack.replace('Attack', 'same'),
		otherAttack.replace('Other', 'same'),
		'package-defined hazard ids do not alter engine artwork',
	);
	assert.notEqual(attack, remedy);
	assert.notEqual(remedy, immunity);
});

test('package SVG geometry replaces the neutral journey picture', () => {
	const html = journeyCardArtHtml(def({ type: 'attack', svg: 'M4 4h56v56z', artColor: '#A52D32' }), 'Package art');
	assert.match(html, /data-card-art="package"/);
	assert.match(html, /journey-package-art/);
	assert.match(html, /d="M4 4h56v56z"/);
	assert.match(html, /--jcard-accent:#a52d32/);
	assert.doesNotMatch(html, /data-card-art="neutral"/);
});

test('public hazard badges also prefer package geometry and otherwise stay neutral', () => {
	assert.match(journeyHazardIconSvg('M5 5h54v54z'), /data-card-art="package"/);
	assert.match(journeyShieldIconSvg('M6 6h52v52z'), /data-card-art="package"/);
	const fallback = journeyHazardIconSvg();
	assert.match(fallback, /<svg/);
	assert.doesNotMatch(fallback, /data-card-art="package"/);
});

test('names are escaped and the card back carries its optional count', () => {
	const html = journeyCardArtHtml(def({ type: 'immunity' }), '<b>Priority</b>');
	assert.match(html, /&lt;b&gt;Priority&lt;\/b&gt;/);
	assert.doesNotMatch(html, /<b>Priority/);
	assert.match(journeyCardBackHtml('82'), /jcard__back-label">82</);
	assert.doesNotMatch(journeyCardBackHtml(), /jcard__back-label/);
});
