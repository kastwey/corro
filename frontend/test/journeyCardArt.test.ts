import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyCardArtHtml, journeyCardBackHtml, journeyKindIconSvg } from '../src/journeyCardArt.js';
import type { JourneyCardDef } from '../src/models.js';

// Engine-rendered card faces: every package gets a visual deck for free from its
// cards.json data. Pure string building — no DOM. Everything it emits is aria-hidden
// decoration; the accessible card stays the hand row's aria-label.

function def(over: Partial<JourneyCardDef>): JourneyCardDef {
	return { id: 'x', type: 'attack', value: 0, count: 1, nameKey: 'cards.x', ...over } as JourneyCardDef;
}

test('a distance card shows its kilometres big, framed in the distance colour', () => {
	const html = journeyCardArtHtml(def({ type: 'distance', value: 100 }), '100 kilómetros');
	assert.match(html, /jcard--distance/);
	assert.match(html, /jcard__value">100</);
	assert.match(html, /jcard__unit">km</);
	assert.match(html, /100 kilómetros/);
});

test('the classic kinds get real signs; attack and remedy faces differ', () => {
	const attack = journeyCardArtHtml(def({ type: 'attack', kind: 'stop' }), 'Semáforo rojo');
	const remedy = journeyCardArtHtml(def({ type: 'remedy', kind: 'stop' }), 'Semáforo verde');
	assert.match(attack, /jcard--attack/);
	assert.match(remedy, /jcard--remedy/);
	assert.match(attack, /#ef5350/); // the red lamp lit
	assert.match(remedy, /#66bb6a/); // the green lamp lit
});

test('the speed-limit sign wears the ACTUAL cap from the game rules', () => {
	const html = journeyCardArtHtml(def({ type: 'attack', kind: 'speedLimit' }), 'Límite', { limitCap: 80 });
	assert.match(html, />80</);
});

test('unknown kinds fall back by TYPE (warning triangle / wrench), never break', () => {
	assert.equal(journeyKindIconSvg('ghost', 'attack'), null);
	const attack = journeyCardArtHtml(def({ type: 'attack', kind: 'ghost' }), 'Fantasma');
	const remedy = journeyCardArtHtml(def({ type: 'remedy', kind: 'ghost' }), 'Antifantasma');
	assert.match(attack, /<svg/); // the warning triangle
	assert.match(remedy, /<svg/); // the wrench
	assert.notEqual(attack, remedy);
});

test('immunities wear the golden shield; names are HTML-escaped', () => {
	const html = journeyCardArtHtml(def({ type: 'immunity' }), '<b>Prioridad</b>');
	assert.match(html, /jcard--immunity/);
	assert.match(html, /&lt;b&gt;Prioridad&lt;\/b&gt;/);
	assert.doesNotMatch(html, /<b>Prioridad/);
});

test('the card back carries its optional big label (the deck count)', () => {
	const html = journeyCardBackHtml('82');
	assert.match(html, /jcard--back/);
	assert.match(html, /jcard__back-label">82</);
	assert.doesNotMatch(journeyCardBackHtml(), /jcard__back-label/);
});
