import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { wireLanguageSelector } from '../src/languageSelector.js';

/**
 * The language control, shared by the lobby and the privacy notice. The privacy page used to have
 * a row of links instead: the same job in a different shape, which is one more thing to learn and
 * had no name for what those links WERE until you read them.
 *
 * The markup lives in each page's HTML on purpose (every page ships pre-translated, so a control
 * assembled at runtime would arrive late and in the wrong language). What is shared, and what this
 * pins, is the behaviour: applying a language is a NAVIGATION to the page built in it, and the
 * choice is recorded even when there is nowhere to go.
 */

setupDom();

function selector(): { select: HTMLSelectElement; apply: HTMLButtonElement } {
	document.body.innerHTML = `
		<div class="language-selector">
			<label for="language-selector">Select language</label>
			<div class="language-controls">
				<select id="language-selector">
					<option value="en">English</option>
					<option value="es">Spanish</option>
				</select>
				<button type="button" id="language-apply-btn">Apply</button>
			</div>
		</div>`;
	return {
		select: document.getElementById('language-selector') as HTMLSelectElement,
		apply: document.getElementById('language-apply-btn') as HTMLButtonElement,
	};
}

const privacyPathFor = (language: string) => (language === 'es' ? '/es/privacy/' : '/privacy/');

test('the control opens on the language the page was BUILT in', () => {
	installFakeI18next('en');
	document.documentElement.lang = 'es';
	const { select } = selector();

	wireLanguageSelector({ pathFor: privacyPathFor });

	// Not the runtime language: this page IS the Spanish one, whatever i18next happens to hold.
	assert.equal(select.value, 'es');
});

test('applying another language navigates to the page built in it, and records the choice', () => {
	installFakeI18next('es');
	document.documentElement.lang = 'es';
	const { select, apply } = selector();
	const visited: string[] = [];
	window.history.replaceState({}, '', '/es/privacy/');

	wireLanguageSelector({ pathFor: privacyPathFor, navigate: url => visited.push(url) });
	select.value = 'en';
	apply.click();

	assert.deepEqual(visited, ['/privacy/']);
});

// Somebody who arrived on /es/ from a shared link and pressed Apply has just told us where to send
// them from the root next time — so the choice is recorded even though nothing moves.
test('applying the language you are already reading records it and stays put', () => {
	installFakeI18next('es');
	document.documentElement.lang = 'es';
	const { select, apply } = selector();
	const visited: string[] = [];
	window.history.replaceState({}, '', '/es/privacy/');

	wireLanguageSelector({ pathFor: privacyPathFor, navigate: url => visited.push(url) });
	select.value = 'es';
	apply.click();

	assert.deepEqual(visited, [], 'no reload under the reader');
});

test('index.html and the directory form are the same page', () => {
	installFakeI18next('en');
	document.documentElement.lang = 'en';
	const { select, apply } = selector();
	const visited: string[] = [];
	window.history.replaceState({}, '', '/privacy/index.html');

	wireLanguageSelector({ pathFor: privacyPathFor, navigate: url => visited.push(url) });
	select.value = 'en';
	apply.click();

	assert.deepEqual(visited, [], '/privacy/index.html already IS /privacy/');
});

test('the lobby carries its invite link across; a document page has none to carry', () => {
	installFakeI18next('en');
	document.documentElement.lang = 'en';
	const lobbyPathFor = (language: string) => (language === 'es' ? '/es/' : '/');
	window.history.replaceState({}, '', '/?code=ABCD#top');

	const withLocation: string[] = [];
	selector();
	wireLanguageSelector({
		pathFor: lobbyPathFor, preserveLocation: true, navigate: url => withLocation.push(url),
	});
	(document.getElementById('language-selector') as HTMLSelectElement).value = 'es';
	(document.getElementById('language-apply-btn') as HTMLButtonElement).click();
	assert.deepEqual(withLocation, ['/es/?code=ABCD#top']);

	const without: string[] = [];
	selector();
	wireLanguageSelector({ pathFor: lobbyPathFor, navigate: url => without.push(url) });
	(document.getElementById('language-selector') as HTMLSelectElement).value = 'es';
	(document.getElementById('language-apply-btn') as HTMLButtonElement).click();
	assert.deepEqual(without, ['/es/'], 'a notice has no invite code and no anchor to keep');
});

test('a page with no language control is a normal page, not an error', () => {
	document.body.innerHTML = '<p>nothing here</p>';
	assert.equal(wireLanguageSelector({ pathFor: privacyPathFor }), false);
});
