import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { copyToClipboard } from '../src/lobby/ui.js';

before(() => {
	setupDom();
	installFakeI18next('es');
});

beforeEach(() => {
	// Reset clipboard + execCommand state between tests.
	delete (globalThis.navigator as any).clipboard;
	delete (globalThis.document as any).execCommand;
	document.body.innerHTML = '';
});

test('uses the async Clipboard API when available and writes the given text', async () => {
	let written: string | undefined;
	(globalThis.navigator as any).clipboard = {
		writeText: async (t: string) => { written = t; }
	};

	const ok = await copyToClipboard('https://game/?code=ABC');

	assert.equal(ok, true);
	assert.equal(written, 'https://game/?code=ABC');
});

test('falls back to execCommand when the Clipboard API is missing (plain-HTTP LAN)', async () => {
	// navigator.clipboard is undefined in a non-secure context.
	let copiedViaExec = false;
	(globalThis.document as any).execCommand = (cmd: string) => {
		if (cmd === 'copy') copiedViaExec = true;
		return true;
	};

	const ok = await copyToClipboard('https://game/?code=ABC');

	assert.equal(ok, true);
	assert.equal(copiedViaExec, true);
	// The transient textarea must be cleaned up.
	assert.equal(document.querySelector('textarea'), null);
});

test('falls back to execCommand when the Clipboard API throws (e.g. not focused)', async () => {
	(globalThis.navigator as any).clipboard = {
		writeText: async () => { throw new Error('Document is not focused'); }
	};
	let copiedViaExec = false;
	(globalThis.document as any).execCommand = (cmd: string) => {
		copiedViaExec = cmd === 'copy';
		return true;
	};

	const ok = await copyToClipboard('text');

	assert.equal(ok, true);
	assert.equal(copiedViaExec, true);
});

test('returns false when both paths fail', async () => {
	(globalThis.document as any).execCommand = () => false;

	const ok = await copyToClipboard('text');

	assert.equal(ok, false);
	assert.equal(document.querySelector('textarea'), null);
});

test('on success shows transient feedback on the button', async () => {
	(globalThis.document as any).execCommand = () => true;
	const btn = document.createElement('button');
	btn.id = 'copy-link-btn';
	btn.textContent = 'Copiar enlace';
	document.body.appendChild(btn);

	const ok = await copyToClipboard('text', 'copy-link-btn');

	assert.equal(ok, true);
	assert.equal(btn.textContent, '¡Copiado!');
});
