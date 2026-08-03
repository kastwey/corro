import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { initPrivacyNotice, loadPrivacyNotice, privacyPagePath } from '../src/privacyNotice.js';

/**
 * A deployment that stores an email address owes a notice saying who receives it. That obligation
 * belongs to whoever RUNS the server, not to Corro, so the notice appears only when they have said
 * who they are — and an unanswered "Privacy" link would be worse than none, because it looks like
 * an answer.
 */

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	document.body.innerHTML = `
		<footer>
			<ul>
				<li id="privacy-link-item" hidden>
					<a id="privacy-link" href="/privacy/">Privacy</a>
				</li>
			</ul>
		</footer>`;
});

const item = () => document.getElementById('privacy-link-item') as HTMLElement;
const link = () => document.getElementById('privacy-link') as HTMLAnchorElement;

test('a deployment that has said nothing offers no notice at all', async () => {
	await initPrivacyNotice(async () => ({ configured: false }));

	assert.equal(item().hidden, true, 'no door into an empty room');
});

test('a configured deployment reveals a real link to the built-in document page', async () => {
	await initPrivacyNotice(async () => ({ configured: true, markdown: '# Privacy\n\nHello.' }));

	assert.equal(item().hidden, false);
	assert.equal(link().tagName, 'A');
	assert.equal(link().getAttribute('href'), '/privacy/');
});

// A host who already has a privacy page points at it directly rather than routing through a
// document that claims to be theirs.
test('a host with their own policy gets its URL on the anchor', async () => {
	await initPrivacyNotice(async () => ({ configured: true, url: 'https://example.test/privacy' }));

	assert.equal(item().hidden, false);
	assert.equal(link().href, 'https://example.test/privacy');
});

test('the built-in page has one stable route per language', () => {
	assert.equal(privacyPagePath('en'), '/privacy/');
	assert.equal(privacyPagePath('es'), '/es/privacy/');
	assert.equal(privacyPagePath('unknown'), '/privacy/');
});

// Never throws: "there is no notice" is a state the lobby renders, not an error it reports. A
// footer link is not worth breaking a page load over.
test('a server that cannot answer is simply a deployment without a notice', async () => {
	const failing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;

	assert.deepEqual(await loadPrivacyNotice(failing), { configured: false });

	const notOk = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
	assert.deepEqual(await loadPrivacyNotice(notOk), { configured: false });
});

// A body that says nothing useful is the same as no body: a "configured" flag with no text and no
// URL would expose a link to an empty page.
test('a malformed answer is treated as no notice', async () => {
	const empty = (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;

	assert.deepEqual(await loadPrivacyNotice(empty), { configured: false });
});
