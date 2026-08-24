import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';

let renderAccountSettings: typeof import('../src/accountSettings.js').renderAccountSettings;
let methodLineText: typeof import('../src/accountSettings.js').methodLineText;
let linkResultMessage: typeof import('../src/accountSettings.js').linkResultMessage;
let dialogManager: typeof import('../src/dialogManager.js').dialogManager;

/**
 * The "your account" settings, now a tab of the settings screen rather than a dialog. The behaviours worth pinning are the ones with consequences: adding a
 * provider is a LINK because it navigates away, removing one is a button because it posts, and the
 * last remaining sign-in method is refused with a spoken reason instead of a `disabled` attribute
 * that would leave a screen-reader user at a control that silently does nothing.
 */

before(async () => {
	setupDom();
	installFakeI18next('en');
	({ renderAccountSettings, methodLineText, linkResultMessage } = await import('../src/accountSettings.js'));
	({ dialogManager } = await import('../src/dialogManager.js'));
});

beforeEach(() => {
	document.body.innerHTML = '';
	// The body reset detached the dialog singleton's cached element: drop the cache so it
	// rebuilds fresh (same convention as the other dialog tests).
	(dialogManager as any).dialog = null;
	(dialogManager as any).nonModalDialog = null;
	dialogManager.init();
	installFakeI18next('en');
});

function sessionBody(identities: { issuer: string; email: string | null }[], displayName: string | null = 'Ana') {
	return { signedIn: true, user: { userId: 'u1', displayName, email: 'ana@example.com', identities } };
}

/** A fetch double with per-route status control, so each refusal can be exercised. */
function fakeFetch(routes: Record<string, { status?: number; body?: unknown }>) {
	const calls: { url: string; method: string; body?: string }[] = [];
	const impl = (async (url: string, init?: RequestInit) => {
		calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
		const route = routes[url.split('?')[0]] ?? { status: 404 };
		const status = route.status ?? 200;
		return { ok: status >= 200 && status < 300, status, json: async () => route.body ?? {} };
	}) as unknown as typeof fetch;
	return { impl, calls };
}

const BOTH = { providers: ['google', 'microsoft'] };

async function open(overrides: {
	identities?: { issuer: string; email: string | null }[];
	routes?: Record<string, { status?: number; body?: unknown }>;
	options?: Record<string, unknown>;
} = {}) {
	const identities = overrides.identities ?? [{ issuer: 'google', email: 'ana@example.com' }];
	const { impl, calls } = fakeFetch({
		'/api/auth/providers': { body: BOTH },
		'/api/auth/me': { body: sessionBody(identities) },
		...overrides.routes,
	});
	// Mounted into a container, the way the settings screen's profile tab does it.
	const mount = document.createElement('div');
	document.body.appendChild(mount);
	await renderAccountSettings(mount, { fetchImpl: impl, returnUrl: '/', ...overrides.options });
	return { calls, dialog: document.querySelector('.account-settings') as HTMLElement };
}

/** Settles the microtask queue so a click handler's awaits complete. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// ── wording ──────────────────────────────────────────────────────────────

test('a sign-in method reads as one flowing sentence', () => {
	// A screen reader speaks a row as a single line, so the provider and the account it points at
	// are joined with words, never bare juxtaposition.
	assert.equal(methodLineText('google', 'ana@example.com'), 'Google, linked to ana@example.com.');
	assert.equal(methodLineText('google', null), 'Google, linked to this account.');
});

test('every link outcome has its own sentence, including the unknown one', () => {
	assert.match(linkResultMessage({ code: 'linked', provider: 'microsoft' }), /Microsoft is now linked/);
	assert.match(linkResultMessage({ code: 'already_linked', provider: 'microsoft' }), /was already linked/);
	assert.match(linkResultMessage({ code: 'provider_in_use', provider: 'microsoft' }), /already uses a different/);
	assert.match(linkResultMessage({ code: 'claimed', provider: 'microsoft' }), /belongs to another account/);
	// An unrecognized code must still say something true rather than render as a raw key.
	assert.match(linkResultMessage({ code: 'wat', provider: 'microsoft' }), /did not finish/);
});

// ── the methods list ─────────────────────────────────────────────────────

test('linked providers offer removal and unlinked ones offer a link that navigates', async () => {
	const { dialog } = await open();

	const unlink = dialog.querySelector('button.account-unlink-btn[data-provider="google"]');
	assert.ok(unlink, 'the linked provider offers a button, because removing posts');
	assert.equal(unlink!.textContent, 'Remove Google');

	const add = dialog.querySelector('a.account-link-provider[data-provider="microsoft"]');
	assert.ok(add, 'the unlinked provider offers a link, because it navigates away');
	assert.equal(add!.getAttribute('href'), '/api/auth/link/microsoft?returnUrl=%2F');
	// Never a button for something that leaves the page.
	assert.equal(dialog.querySelectorAll('button.account-link-provider').length, 0);
});

test('the only sign-in method is refused with a spoken reason, never a disabled attribute', async () => {
	// The project rule: a control that will not act stays focusable and says why.
	const { dialog } = await open();

	const unlink = dialog.querySelector('button.account-unlink-btn') as HTMLButtonElement;
	assert.equal(unlink.hasAttribute('disabled'), false);
	assert.equal(unlink.getAttribute('aria-disabled'), 'true');
	const describedBy = unlink.getAttribute('aria-describedby')!;
	const reason = dialog.querySelector(`#${describedBy}`)!;
	assert.equal(reason.hasAttribute('hidden'), false);
	assert.match(reason.textContent!, /only way to sign in/);
});

test('activating the refused control explains itself instead of doing nothing', async () => {
	const { dialog, calls } = await open();

	(dialog.querySelector('button.account-unlink-btn') as HTMLButtonElement).click();
	await settle();

	assert.match(dialog.querySelector('.account-settings-status')!.textContent!, /only way to sign in/);
	assert.equal(calls.some(c => c.url.startsWith('/api/auth/unlink')), false, 'nothing was sent');
});

test('with two methods linked, either can be removed', async () => {
	const { dialog } = await open({
		identities: [
			{ issuer: 'google', email: 'ana@gmail.com' },
			{ issuer: 'microsoft', email: 'ana@outlook.com' },
		],
	});

	const buttons = dialog.querySelectorAll('button.account-unlink-btn');
	assert.equal(buttons.length, 2);
	for (const button of buttons) {
		assert.equal(button.getAttribute('aria-disabled'), null);
	}
	assert.equal(dialog.querySelector('#account-last-method-hint')!.hasAttribute('hidden'), true);
});

test('a provider the deployment no longer offers is still listed while it is linked', async () => {
	// Otherwise it would vanish from the account that still depends on it, with no way to remove it.
	const { dialog } = await open({
		identities: [{ issuer: 'google', email: 'a@b.c' }, { issuer: 'okta', email: 'a@b.c' }],
		routes: { '/api/auth/providers': { body: { providers: ['google', 'microsoft'] } } },
	});

	assert.ok(dialog.querySelector('button.account-unlink-btn[data-provider="okta"]'));
});

test('removing a provider reports it and refreshes the list', async () => {
	let identities = [
		{ issuer: 'google', email: 'ana@gmail.com' },
		{ issuer: 'microsoft', email: 'ana@outlook.com' },
	];
	const { impl } = fakeFetch({
		'/api/auth/providers': { body: BOTH },
		get '/api/auth/me'() { return { body: sessionBody(identities) }; },
		'/api/auth/unlink/microsoft': { status: 204 },
	});
	let changed = 0;
	await renderAccountSettings(
		document.body.appendChild(document.createElement('div')),
		{ fetchImpl: impl, returnUrl: '/', onChanged: () => changed++ });
	const dialog = document.querySelector('.account-settings') as HTMLElement;

	identities = [{ issuer: 'google', email: 'ana@gmail.com' }];
	(dialog.querySelector('button.account-unlink-btn[data-provider="microsoft"]') as HTMLButtonElement).click();
	await settle();

	assert.match(dialog.querySelector('.account-settings-status')!.textContent!, /Microsoft is no longer linked/);
	assert.equal(dialog.querySelectorAll('button.account-unlink-btn').length, 1);
	assert.equal(changed, 1);
});

test('a server refusal to remove the last method is reported in the player\'s language', async () => {
	// The client guard and the server guard must agree; this covers the server having the last word.
	const { dialog } = await open({
		identities: [{ issuer: 'google', email: 'a@b.c' }, { issuer: 'microsoft', email: 'a@b.c' }],
		routes: { '/api/auth/unlink/microsoft': { status: 409 } },
	});

	(dialog.querySelector('button.account-unlink-btn[data-provider="microsoft"]') as HTMLButtonElement).click();
	await settle();

	assert.match(dialog.querySelector('.account-settings-status')!.textContent!, /only way to sign in/);
});

// ── the name ─────────────────────────────────────────────────────────────

test('the name field starts from the current name and is capped', async () => {
	const { dialog } = await open();

	const input = dialog.querySelector('#account-name-input') as HTMLInputElement;
	assert.equal(input.value, 'Ana');
	assert.equal(input.maxLength, 40);
	// The hint explaining that clearing it restores the provider name is announced with the field.
	assert.ok(dialog.querySelector(`#${input.getAttribute('aria-describedby')}`));
});

test('saving the name confirms it and tells the host page to refresh', async () => {
	let changed = 0;
	const { dialog, calls } = await open({
		routes: { '/api/auth/me': { body: sessionBody([{ issuer: 'google', email: 'a@b.c' }]) } },
		options: { onChanged: () => changed++ },
	});

	(dialog.querySelector('#account-name-input') as HTMLInputElement).value = 'Ana la Roja';
	(dialog.querySelector('#account-name-save') as HTMLButtonElement).click();
	await settle();

	const patch = calls.find(c => c.method === 'PATCH')!;
	assert.deepEqual(JSON.parse(patch.body!), { displayName: 'Ana la Roja' });
	assert.match(dialog.querySelector('.account-settings-status')!.textContent!, /name is saved/);
	assert.equal(changed, 1);
});

test('an empty name is allowed, because it restores the provider name', async () => {
	const { dialog, calls } = await open();

	(dialog.querySelector('#account-name-input') as HTMLInputElement).value = '';
	(dialog.querySelector('#account-name-save') as HTMLButtonElement).click();
	await settle();

	assert.deepEqual(JSON.parse(calls.find(c => c.method === 'PATCH')!.body!), { displayName: '' });
});

// ── erasing ──────────────────────────────────────────────────────────────

test('erasing asks first, and the safe answer holds focus', async () => {
	// Irreversible, so the confirmation defaults to keeping the account.
	const { dialog, calls } = await open();

	(dialog.querySelector('#account-delete-btn') as HTMLButtonElement).click();

	const cancel = dialog.querySelector('#account-delete-cancel') as HTMLButtonElement;
	assert.ok(cancel, 'a confirmation appears');
	assert.ok(dialog.querySelector('#account-delete-confirm'));
	assert.equal(document.activeElement, cancel, 'focus lands on keeping the account');
	assert.equal(calls.some(c => c.method === 'DELETE'), false, 'nothing was erased yet');

	// Same regression as the sign-in list: the group used to be named from the question inside it,
	// which made VoiceOver read that question twice — once as the group's name, once as the
	// paragraph. The group says what it IS; the question stays the thing you read, said once.
	const group = dialog.querySelector('.account-erase-confirm')!;
	assert.equal(group.getAttribute('aria-labelledby'), null);
	assert.equal(group.getAttribute('aria-label'), 'Confirm erasing your account');
	assert.equal(group.querySelector('p')?.textContent, 'Erase your account for good?');
});

test('backing out of erasing restores the button and returns focus to it', async () => {
	const { dialog } = await open();

	(dialog.querySelector('#account-delete-btn') as HTMLButtonElement).click();
	(dialog.querySelector('#account-delete-cancel') as HTMLButtonElement).click();

	const eraseBtn = dialog.querySelector('#account-delete-btn') as HTMLButtonElement;
	assert.ok(eraseBtn);
	assert.equal(dialog.querySelector('#account-delete-confirm'), null);
	assert.equal(document.activeElement, eraseBtn);
});

test('confirming erases the account and reports the session is over', async () => {
	let signedOut = 0;
	const { dialog, calls } = await open({
		routes: { '/api/auth/me': { body: sessionBody([{ issuer: 'google', email: 'a@b.c' }]) } },
		options: { onSignedOut: () => signedOut++ },
	});

	(dialog.querySelector('#account-delete-btn') as HTMLButtonElement).click();
	(dialog.querySelector('#account-delete-confirm') as HTMLButtonElement).click();
	await settle();

	assert.ok(calls.some(c => c.method === 'DELETE' && c.url === '/api/auth/me'));
	assert.equal(signedOut, 1);
});

// ── opening ──────────────────────────────────────────────────────────────

test('a link that just came back reports itself the moment the dialog opens', async () => {
	// The outcome travelled through a full page navigation, so this is the only place left to say it.
	const { dialog } = await open({
		options: { linkReturn: { code: 'claimed', provider: 'microsoft' } },
	});

	assert.match(
		dialog.querySelector('.account-settings-status')!.textContent!,
		/belongs to another account/);
});

test('the settings never open for somebody who is not signed in', async () => {
	let signedOut = 0;
	const { impl } = fakeFetch({
		'/api/auth/providers': { body: BOTH },
		'/api/auth/me': { body: { signedIn: false } },
	});

	await renderAccountSettings(
		document.body.appendChild(document.createElement('div')),
		{ fetchImpl: impl, onSignedOut: () => signedOut++ });

	assert.equal(document.querySelector('.account-settings'), null);
	assert.equal(signedOut, 1);
});

test('the outcome region is a status that survives the list being rebuilt', async () => {
	// A screen reader announces changes to an EXISTING region; recreating it per render would
	// silently drop every message.
	const { dialog } = await open({
		identities: [{ issuer: 'google', email: 'a@b.c' }, { issuer: 'microsoft', email: 'a@b.c' }],
		routes: { '/api/auth/unlink/microsoft': { status: 204 } },
	});
	const before = dialog.querySelector('.account-settings-status');
	assert.equal(before!.getAttribute('role'), 'status');

	(dialog.querySelector('button.account-unlink-btn[data-provider="microsoft"]') as HTMLButtonElement).click();
	await settle();

	assert.equal(dialog.querySelector('.account-settings-status'), before, 'the same node still holds it');
});
