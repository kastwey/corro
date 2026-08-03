import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { initPrivacyPage, renderPrivacyBody } from '../src/privacyPage.js';

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	document.documentElement.lang = 'en';
	document.documentElement.removeAttribute('data-theme');
	try { localStorage.clear(); } catch { /* unavailable storage is a supported browser state */ }
	document.body.innerHTML = `
		<main id="privacy-main" aria-busy="true" data-contents-label="Contents">
			<div class="language-selector">
			<label for="language-selector">Select language</label>
			<div class="language-controls">
				<select id="language-selector"><option value="en">English</option><option value="es">Spanish</option></select>
				<button type="button" id="language-apply-btn">Apply</button>
			</div>
		</div>
			<span id="privacy-theme-toggle"
				data-theme-to-light="Use light" data-theme-to-dark="Use dark"></span>
			<p id="privacy-loading">Loading</p>
			<div id="privacy-document" hidden></div>
			<div id="privacy-unavailable" hidden></div>
			<div id="privacy-external" hidden>
				<a id="privacy-external-link" href="/">Read it</a>
			</div>
		</main>`;
});

const byId = (id: string) => document.getElementById(id) as HTMLElement;

test('the page shell owns the H1 while the rendered policy starts with its introduction', () => {
	const html = renderPrivacyBody(
		'# Privacy notice\n\n_Last updated today._\n\n## Playing without an account\n\nHello.',
		'Contents',
	);

	assert.doesNotMatch(html, /<h1/);
	assert.match(html, /Last updated today/);
	assert.match(html, /<h2 id="help-contents"/);
	assert.match(html, /<h2 id="playing-without-an-account"/);
});

test('a built-in notice becomes an ordinary document, never a dialog', async () => {
	let requestedLanguage = '';
	await initPrivacyPage(async (_request, language) => {
		requestedLanguage = language;
		return {
			configured: true,
			markdown: '# Privacy notice\n\nIntro.\n\n## Cookies\n\nDetails.',
		};
	});

	assert.equal(requestedLanguage, 'en');
	assert.equal(byId('privacy-loading').hidden, true);
	assert.equal(byId('privacy-document').hidden, false);
	assert.match(byId('privacy-document').innerHTML, /<h2 id="cookies"/);
	assert.equal(document.querySelector('dialog'), null);
	assert.equal(byId('privacy-main').getAttribute('aria-busy'), 'false');
});

test('an unavailable notice reveals the persistent page error', async () => {
	await initPrivacyPage(async () => ({ configured: false }));

	assert.equal(byId('privacy-loading').hidden, true);
	assert.equal(byId('privacy-unavailable').hidden, false);
	assert.equal(byId('privacy-document').hidden, true);
	assert.equal(byId('privacy-main').getAttribute('aria-busy'), 'false');
});

test('a direct visit still follows a host-provided external policy URL', async () => {
	await initPrivacyPage(async () => ({ configured: true, url: 'https://example.test/privacy' }));

	assert.equal(byId('privacy-external').hidden, false);
	assert.equal(
		(byId('privacy-external-link') as HTMLAnchorElement).href,
		'https://example.test/privacy',
	);
});

test('the standalone page uses its pre-translated theme action labels', async () => {
	await initPrivacyPage(async () => ({ configured: false }));
	const toggle = document.getElementById('theme-toggle') as HTMLButtonElement;

	assert.equal(toggle.getAttribute('aria-label'), 'Use dark');
	toggle.click();
	assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
	assert.equal(toggle.getAttribute('aria-label'), 'Use light');
});
