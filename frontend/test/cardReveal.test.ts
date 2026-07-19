import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { cardReveal } from '../src/cardReveal.js';
import type { CardDrawnNotification } from '../src/models.js';

before(() => {
	setupDom();
	// The "extra" keys mimic a package's i18n merged over the app's.
	installFakeI18next('en', {
		'cards.greeting': 'English text',
		'cards.evil': '<img src=x onerror=alert(1)>',
	});
	const w = (globalThis as any).window;
	w.matchMedia = w.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});

test('a package card reveals its text resolved from its i18n key', () => {
	const card: CardDrawnNotification = {
		playerId: 'a', playerName: 'Ana', cardId: 'c1', deckType: 'blackmarket',
		titleKey: '', descriptionKey: 'cards.greeting', descriptionVars: {},
	};

	cardReveal.show(card);

	const desc = document.querySelector('.card-reveal__desc');
	assert.ok(desc, 'the reveal rendered');
	assert.equal(desc!.textContent, 'English text'); // resolved from the (merged) package key
	// No translation-key title for a package card.
	assert.equal(document.querySelector('.card-reveal__title'), null);
	cardReveal.hide();
});

test('a package card text is HTML-escaped (the upload is untrusted)', () => {
	const card: CardDrawnNotification = {
		playerId: 'a', playerName: 'Ana', cardId: 'evil', deckType: 'blackmarket',
		titleKey: '', descriptionKey: 'cards.evil', descriptionVars: {},
	};

	cardReveal.show(card);

	const desc = document.querySelector('.card-reveal__desc')!;
	assert.equal(desc.querySelector('img'), null, 'no element is injected from the card text');
	assert.ok(desc.textContent!.includes('<img'), 'the markup is shown as inert text');
	cardReveal.hide();
});

test('a classic card still reveals via its translation keys', () => {
	const card: CardDrawnNotification = {
		playerId: 'a', playerName: 'Ana', cardId: 'chance_send_to_holding', deckType: 'chance',
		titleKey: 'game.chance_send_to_holding_title', descriptionKey: 'game.chance_send_to_holding_desc',
		descriptionVars: {},
	};

	cardReveal.show(card);

	const title = document.querySelector('.card-reveal__title');
	assert.ok(title && title.textContent && title.textContent.length > 0, 'classic title comes from its key');
	cardReveal.hide();
});
