import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import {
	parseSession, parseProviders, signInPath, linkPath, providerName, signedInText,
	fetchSession, fetchProviders, signOut, initAccountBar, SIGNED_OUT,
	unlinkProvider, renameAccount, deleteAccount, MAX_DISPLAY_NAME_LENGTH,
} from '../src/account.js';

/**
 * The optional account control. Two things it must never do, whatever the server answers: stop the
 * lobby from working, or claim somebody is signed in when they are not. Most of these tests are
 * about the degraded paths, because those are the ones that would otherwise break playing WITHOUT
 * an account — which is the supported default, not a fallback.
 */

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	document.body.innerHTML = '';
	installFakeI18next('en');
});

/** A fetch double routing the two account endpoints; anything else is a 404. */
function fakeFetch(routes: Record<string, unknown>, options: { failOn?: string } = {}) {
	const calls: { url: string; method: string }[] = [];
	const impl = (async (url: string, init?: RequestInit) => {
		calls.push({ url, method: init?.method ?? 'GET' });
		const path = url.split('?')[0];
		if (options.failOn === path) throw new Error('network down');
		if (!(path in routes)) return { ok: false, status: 404, json: async () => ({}) };
		return { ok: true, status: 200, json: async () => routes[path] };
	}) as unknown as typeof fetch;
	return { impl, calls };
}

const BOTH_PROVIDERS = { '/api/auth/providers': { providers: ['google', 'microsoft'] } };
const SIGNED_IN_BODY = {
	signedIn: true,
	user: {
		userId: 'u1',
		displayName: 'Ana',
		email: 'ana@example.com',
		identities: [{ issuer: 'google', email: 'ana@example.com' }],
	},
};

// ── parsing ──────────────────────────────────────────────────────────────

test('parseSession reads a signed-in payload', () => {
	const session = parseSession(SIGNED_IN_BODY);
	assert.equal(session.signedIn, true);
	assert.equal(session.user?.userId, 'u1');
	assert.equal(session.user?.displayName, 'Ana');
	assert.deepEqual(session.user?.identities, [{ issuer: 'google', email: 'ana@example.com' }]);
});

test('parseSession treats anything unexpected as signed out', () => {
	// Claiming a session that does not exist is the one failure mode with real consequences, so
	// every malformed shape has to land on "signed out".
	for (const raw of [null, undefined, 'nope', {}, { signedIn: true }, { signedIn: 'yes', user: { userId: 'u1' } },
		{ signedIn: true, user: {} }, { signedIn: true, user: { userId: '' } }] as unknown[]) {
		assert.deepEqual(parseSession(raw), SIGNED_OUT, `for ${JSON.stringify(raw)}`);
	}
});

test('parseSession normalizes a blank name to null so the client can localize it', () => {
	const session = parseSession({ signedIn: true, user: { userId: 'u1', displayName: '', identities: [] } });
	assert.equal(session.user?.displayName, null);
});

test('parseSession survives an identities field that is not a list', () => {
	const session = parseSession({ signedIn: true, user: { userId: 'u1', identities: 'google' } });
	assert.deepEqual(session.user?.identities, []);
});

test('parseSession drops identity entries with no issuer and normalizes a blank address', () => {
	const session = parseSession({
		signedIn: true,
		user: { userId: 'u1', identities: [{ issuer: 'google', email: '' }, { email: 'x@y.z' }, null] },
	});
	assert.deepEqual(session.user?.identities, [{ issuer: 'google', email: null }]);
});

test('parseProviders keeps only non-empty strings', () => {
	assert.deepEqual(parseProviders({ providers: ['google', '', 7, null, 'microsoft'] }), ['google', 'microsoft']);
	assert.deepEqual(parseProviders({}), []);
	assert.deepEqual(parseProviders(null), []);
});

// ── links and wording ────────────────────────────────────────────────────

test('signInPath encodes the return destination', () => {
	// The return trip carries a query string of its own; leaving it unencoded would truncate it.
	assert.equal(
		signInPath('google', '/?game=ABC123'),
		'/api/auth/signin/google?returnUrl=%2F%3Fgame%3DABC123');
});

test('providerName falls back to the slug when it has no label yet', () => {
	assert.equal(providerName('google'), 'Google');
	assert.equal(providerName('okta'), 'okta');
});

test('the signed-in line reads as one sentence, with or without a name', () => {
	// A screen reader speaks this as a single line, so it has to stay a sentence when the provider
	// gave us no name to put in it.
	assert.equal(
		signedInText({ signedIn: true, user: { userId: 'u1', displayName: 'Ana', email: null, providers: [] } }),
		'Signed in as Ana.');
	assert.equal(
		signedInText({ signedIn: true, user: { userId: 'u1', displayName: null, email: null, providers: [] } }),
		'Signed in.');
});

// ── network degradation ──────────────────────────────────────────────────

test('a failing session endpoint reads as signed out rather than throwing', async () => {
	const { impl } = fakeFetch({}, { failOn: '/api/auth/me' });
	assert.deepEqual(await fetchSession(impl), SIGNED_OUT);
});

test('a failing providers endpoint offers nothing rather than throwing', async () => {
	const { impl } = fakeFetch({}, { failOn: '/api/auth/providers' });
	assert.deepEqual(await fetchProviders(impl), []);
});

/** A fetch double that answers every call with one status, for the outcome-mapping tests. */
function respondWith(status: number) {
	const calls: { url: string; method: string; body?: string }[] = [];
	const impl = (async (url: string, init?: RequestInit) => {
		calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
		return { ok: status >= 200 && status < 300, status, json: async () => ({}) };
	}) as unknown as typeof fetch;
	return { impl, calls };
}

test('linkPath points at the link route, not the sign-in one', () => {
	// Confusing the two would sign the visitor in as the provider's owner instead of adding it to
	// the account they are already using.
	assert.equal(linkPath('microsoft', '/'), '/api/auth/link/microsoft?returnUrl=%2F');
});

test('unlink maps each server answer to a distinct outcome', async () => {
	// The refusal to remove the last sign-in method has to stay distinguishable from a transient
	// failure: one is explained to the player, the other invites a retry.
	assert.equal(await unlinkProvider(respondWith(204).impl, 'google'), 'ok');
	assert.equal(await unlinkProvider(respondWith(409).impl, 'google'), 'last_sign_in_method');
	assert.equal(await unlinkProvider(respondWith(404).impl, 'google'), 'not_linked');
	assert.equal(await unlinkProvider(respondWith(401).impl, 'google'), 'signed_out');
	assert.equal(await unlinkProvider(respondWith(500).impl, 'google'), 'failed');
});

test('unlink posts to the provider route', async () => {
	const { impl, calls } = respondWith(204);
	await unlinkProvider(impl, 'microsoft');
	assert.deepEqual(calls, [{ url: '/api/auth/unlink/microsoft', method: 'POST', body: undefined }]);
});

test('rename patches the account and maps its answers', async () => {
	const { impl, calls } = respondWith(200);
	assert.equal(await renameAccount(impl, 'Ana la Roja'), 'ok');
	assert.equal(calls[0].method, 'PATCH');
	assert.equal(calls[0].url, '/api/auth/me');
	assert.deepEqual(JSON.parse(calls[0].body!), { displayName: 'Ana la Roja' });

	assert.equal(await renameAccount(respondWith(400).impl, 'x'), 'name_too_long');
	assert.equal(await renameAccount(respondWith(401).impl, 'x'), 'signed_out');
	assert.equal(await renameAccount(respondWith(500).impl, 'x'), 'failed');
});

test('erasing the account deletes it', async () => {
	const { impl, calls } = respondWith(204);
	assert.equal(await deleteAccount(impl), 'ok');
	assert.deepEqual(calls, [{ url: '/api/auth/me', method: 'DELETE', body: undefined }]);
	assert.equal(await deleteAccount(respondWith(500).impl), 'failed');
});

test('every account operation survives the network failing outright', async () => {
	const dead = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
	assert.equal(await unlinkProvider(dead, 'google'), 'failed');
	assert.equal(await renameAccount(dead, 'Ana'), 'failed');
	assert.equal(await deleteAccount(dead), 'failed');
});

test('sign-out posts and reports whether it worked', async () => {
	const { impl, calls } = fakeFetch({ '/api/auth/signout': {} });
	assert.equal(await signOut(impl), true);
	assert.deepEqual(calls, [{ url: '/api/auth/signout', method: 'POST' }]);
});

// ── rendering ────────────────────────────────────────────────────────────

function mount(): HTMLElement {
	const el = document.createElement('div');
	el.id = 'account-bar';
	document.body.appendChild(el);
	return el;
}

test('a deployment with no provider renders no account UI at all', async () => {
	// Accounts are optional infrastructure: with none configured the lobby must look exactly as it
	// did before this feature existed.
	const el = mount();
	const { impl } = fakeFetch({ '/api/auth/providers': { providers: [] } });

	const session = await initAccountBar(el, { fetchImpl: impl });

	assert.equal(session.signedIn, false);
	assert.equal(el.hidden, true);
	assert.equal(el.childElementCount, 0);
});

test('signed out, it offers one link per provider', async () => {
	const el = mount();
	const { impl } = fakeFetch({ ...BOTH_PROVIDERS, '/api/auth/me': { signedIn: false } });

	await initAccountBar(el, { fetchImpl: impl, returnUrl: '/' });

	const links = el.querySelectorAll('a.account-signin-link');
	assert.equal(links.length, 2);
	assert.equal(links[0].getAttribute('href'), '/api/auth/signin/google?returnUrl=%2F');
	assert.equal(links[0].textContent, 'Sign in with Google');
	assert.equal(links[1].textContent, 'Sign in with Microsoft');
});

test('the sign-in affordances are links, because they navigate away', async () => {
	// Announcing "button" for something that leaves the page misleads a screen-reader user about
	// what is about to happen.
	const el = mount();
	const { impl } = fakeFetch({ ...BOTH_PROVIDERS, '/api/auth/me': { signedIn: false } });

	await initAccountBar(el, { fetchImpl: impl });

	assert.equal(el.querySelectorAll('button.account-signin-link').length, 0);
	assert.equal(el.querySelectorAll('a.account-signin-link').length, 2);
});

test('the provider links form one named group without adding a landmark', async () => {
	// The lobby's landmark tree has to stay flat, so this is a role="group", not a region.
	const el = mount();
	const { impl } = fakeFetch({ ...BOTH_PROVIDERS, '/api/auth/me': { signedIn: false } });

	await initAccountBar(el, { fetchImpl: impl });

	const group = el.querySelector('.account-providers')!;
	assert.equal(group.getAttribute('role'), 'group');
	const labelledBy = group.getAttribute('aria-labelledby')!;
	assert.ok(document.getElementById(labelledBy)?.textContent, 'the group label resolves to real text');
	assert.equal(el.querySelectorAll('section, [role="region"]').length, 0);
});

test('signed in, it names the player and offers sign-out', async () => {
	const el = mount();
	const { impl } = fakeFetch({ ...BOTH_PROVIDERS, '/api/auth/me': SIGNED_IN_BODY });

	const session = await initAccountBar(el, { fetchImpl: impl });

	assert.equal(session.signedIn, true);
	assert.equal(el.querySelector('.account-status')?.textContent, 'Signed in as Ana.');
	assert.equal(el.querySelector('#account-signout-btn')?.textContent, 'Sign out');
	assert.equal(el.querySelectorAll('a.account-signin-link').length, 0);
});

test('the manage affordance appears only when the host page can open the settings', async () => {
	// The bar stays free of the dialog layer: with no opener injected there is nothing to offer.
	const el = mount();
	const routes = { ...BOTH_PROVIDERS, '/api/auth/me': SIGNED_IN_BODY };

	await initAccountBar(el, { fetchImpl: fakeFetch(routes).impl });
	assert.equal(el.querySelector('#account-manage-btn'), null);

	let opened = 0;
	await initAccountBar(el, { fetchImpl: fakeFetch(routes).impl, onManageAccount: () => opened++ });
	const manage = el.querySelector('#account-manage-btn') as HTMLButtonElement;
	assert.equal(manage?.textContent, 'Your account');
	manage.click();
	assert.equal(opened, 1);
});

test('signing out returns to the signed-out control and notifies the host page', async () => {
	const el = mount();
	const { impl, calls } = fakeFetch({
		...BOTH_PROVIDERS,
		'/api/auth/me': SIGNED_IN_BODY,
		'/api/auth/signout': {},
	});
	let notified = 0;

	await initAccountBar(el, { fetchImpl: impl, onSignedOut: () => notified++ });
	(el.querySelector('#account-signout-btn') as HTMLButtonElement).click();
	await new Promise(resolve => setTimeout(resolve, 0));

	assert.equal(notified, 1);
	assert.ok(calls.some(c => c.url === '/api/auth/signout' && c.method === 'POST'));
	assert.equal(el.querySelectorAll('a.account-signin-link').length, 2);
	assert.equal(el.querySelector('.account-status'), null);
});

test('no control is left claiming a session when the server says signed out', async () => {
	const el = mount();
	const { impl } = fakeFetch({ ...BOTH_PROVIDERS }, { failOn: '/api/auth/me' });

	await initAccountBar(el, { fetchImpl: impl });

	assert.equal(el.querySelector('.account-status'), null);
	assert.equal(el.querySelectorAll('a.account-signin-link').length, 2);
});

test('a failed sign-in is announced and says playing without an account still works', async () => {
	const el = mount();
	const { impl } = fakeFetch({ ...BOTH_PROVIDERS, '/api/auth/me': { signedIn: false } });

	await initAccountBar(el, { fetchImpl: impl, signInFailed: true });

	const alert = el.querySelector('.account-error')!;
	assert.equal(alert.getAttribute('role'), 'alert');
	assert.match(alert.textContent!, /without an account/);
	// The player must still be able to retry.
	assert.equal(el.querySelectorAll('a.account-signin-link').length, 2);
});

test('a stale failure notice never appears over an established session', async () => {
	const el = mount();
	const { impl } = fakeFetch({ ...BOTH_PROVIDERS, '/api/auth/me': SIGNED_IN_BODY });

	await initAccountBar(el, { fetchImpl: impl, signInFailed: true });

	assert.equal(el.querySelector('.account-error'), null);
});

// ── shipped slugs and page wiring ────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

/**
 * The provider label key is built from the slug at runtime, so the translation parity scanner
 * cannot see it. Pin the shipped slugs here instead — these must match `AuthProviders` on the
 * server, since the slug travels from configuration to the client untouched.
 */
test('accountProviderLabels: every shipped provider slug is named in both locales', () => {
	for (const locale of ['en', 'es']) {
		const dict = JSON.parse(readFileSync(join(repoRoot, 'i18n', 'locales', `${locale}.json`), 'utf8'));
		for (const slug of ['google', 'microsoft', 'e2e']) {
			assert.ok(dict.account?.provider?.[slug], `${locale}.json names the "${slug}" provider`);
		}
	}
});

test('the name length cap matches the one the server enforces', () => {
	// The client uses it as the field's maxlength and the server rejects anything longer. If they
	// drifted apart, a player could type a name the form accepted and the server refused.
	const source = readFileSync(
		join(repoRoot, '..', 'server', 'Services', 'Accounts', 'UserAccountService.cs'),
		'utf8');
	const declared = source.match(/MaxDisplayNameLength\s*=\s*(\d+)/);

	assert.ok(declared, 'the server declares a display-name cap');
	assert.equal(Number(declared![1]), MAX_DISPLAY_NAME_LENGTH);
});

test('the lobby page mounts the account control hidden, above the preferences', () => {
	// Hidden by default matters: a deployment with no provider must render no account UI, and the
	// page must not flash one before the provider list arrives.
	const html = readFileSync(join(repoRoot, 'src', 'index.html'), 'utf8');
	const document = new JSDOM(html).window.document;

	const mount = document.getElementById('account-bar')!;
	assert.ok(mount, 'the lobby has an account mount');
	assert.ok(mount.hasAttribute('hidden'));
	assert.equal(mount.childElementCount, 0, 'the control is built at runtime, not baked in');

	const header = document.querySelector('main > header.lobby-header')!;
	assert.equal(mount.parentElement, header, 'the account control lives in the lobby header');
	const preferences = header.querySelector('.language-selector')!;
	assert.ok(
		mount.compareDocumentPosition(preferences) & 4 /* DOCUMENT_POSITION_FOLLOWING */,
		'who you are comes before how the page is displayed');
});

test('switching language re-translates the imperatively built labels', async () => {
	// Nothing here is built with data-i18n, so applyI18n never reaches it on a runtime switch.
	const el = mount();
	const { impl } = fakeFetch({ ...BOTH_PROVIDERS, '/api/auth/me': SIGNED_IN_BODY });
	await initAccountBar(el, { fetchImpl: impl });
	assert.equal(el.querySelector('.account-status')?.textContent, 'Signed in as Ana.');

	installFakeI18next('es');
	document.dispatchEvent(new (globalThis as any).window.Event('languageChanged'));

	assert.equal(el.querySelector('.account-status')?.textContent, 'Sesión iniciada como Ana.');
	assert.equal(el.querySelector('#account-signout-btn')?.textContent, 'Cerrar sesión');
});
