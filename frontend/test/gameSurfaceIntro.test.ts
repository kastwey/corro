import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import {
	GAME_SURFACE_INTRO_KEYS,
	gameSurfaceIntroKey,
	updateGameSurfaceIntro,
} from '../src/gameSurfaceIntro.js';

setupDom();

test('gameSurfaceIntroKey selects the spatial-board message for every board family and fallback', () => {
	for (const gameType of ['property', 'race', 'track', 'trivia', undefined, 'future-family']) {
		assert.equal(gameSurfaceIntroKey(gameType), GAME_SURFACE_INTRO_KEYS.board, String(gameType));
	}
});

test('gameSurfaceIntroKey selects the hand message for every card family', () => {
	for (const gameType of ['journey', 'assembly', 'draft', 'shedding', 'exploding']) {
		assert.equal(gameSurfaceIntroKey(gameType), GAME_SURFACE_INTRO_KEYS.hand, gameType);
	}
});

test('updateGameSurfaceIntro translates the selected message and keeps later state updates silent', () => {
	const intro = document.createElement('p');
	intro.setAttribute('data-i18n', 'game.surface_intro.loading');
	intro.textContent = 'Loading';
	let translations = 0;
	const translate = (key: string) => {
		translations++;
		return key === GAME_SURFACE_INTRO_KEYS.hand ? 'Your hand instructions' : 'Your board instructions';
	};

	assert.equal(updateGameSurfaceIntro(intro, 'journey', translate), true);
	assert.equal(intro.getAttribute('data-i18n'), GAME_SURFACE_INTRO_KEYS.hand);
	assert.equal(intro.textContent, 'Your hand instructions');
	assert.equal(translations, 1);

	assert.equal(updateGameSurfaceIntro(intro, 'journey', translate), false);
	assert.equal(translations, 1, 'an unchanged family must not rewrite the accessible paragraph');

	assert.equal(updateGameSurfaceIntro(intro, 'track', translate), true);
	assert.equal(intro.getAttribute('data-i18n'), GAME_SURFACE_INTRO_KEYS.board);
	assert.equal(intro.textContent, 'Your board instructions');
	assert.equal(translations, 2);
});

test('updateGameSurfaceIntro preserves readable fallback text when a translation is unavailable', () => {
	const intro = document.createElement('p');
	intro.setAttribute('data-i18n', 'game.surface_intro.loading');
	intro.textContent = 'Readable fallback';

	updateGameSurfaceIntro(intro, 'property', key => key);

	assert.equal(intro.getAttribute('data-i18n'), GAME_SURFACE_INTRO_KEYS.board);
	assert.equal(intro.textContent, 'Readable fallback');
});