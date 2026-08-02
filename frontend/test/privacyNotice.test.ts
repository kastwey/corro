import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { initPrivacyNotice, loadPrivacyNotice } from '../src/privacyNotice.js';

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
					<button type="button" id="privacy-link">Privacy</button>
				</li>
			</ul>
		</footer>`;
});

const item = () => document.getElementById('privacy-link-item') as HTMLElement;

test('a deployment that has said nothing offers no notice at all', async () => {
	await initPrivacyNotice(async () => ({ configured: false }));

	assert.equal(item().hidden, true, 'no door into an empty room');
});

test('a configured deployment reveals the notice', async () => {
	await initPrivacyNotice(async () => ({ configured: true, markdown: '# Privacy\n\nHello.' }));

	assert.equal(item().hidden, false);
});

// A host who already has a privacy page points at it, and we link out rather than showing a
// notice that claims to be theirs.
test('a host with their own policy gets a link to it, not our text', async () => {
	const opened: string[] = [];
	(globalThis as { window?: { open?: unknown } }).window!.open =
		((url: string) => { opened.push(url); return null; }) as never;

	await initPrivacyNotice(async () => ({ configured: true, url: 'https://example.test/privacy' }));
	(document.getElementById('privacy-link') as HTMLButtonElement).click();

	assert.deepEqual(opened, ['https://example.test/privacy']);
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
// URL would open an empty dialog.
test('a malformed answer is treated as no notice', async () => {
	const empty = (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;

	assert.deepEqual(await loadPrivacyNotice(empty), { configured: false });
});
