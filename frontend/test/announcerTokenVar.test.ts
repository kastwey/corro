import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTokenVar } from '../src/announcer.js';

// The token-var convention: a server announcement carrying `tokenId` gets `{{token}}`
// resolved client-side to the piece's localized name ("Llenas el tanque de tu camión"),
// per listener language. Everything else passes through untouched.

const t = (key: string) => key === 'tokens.camion' ? 'camión' : key;

test('tokenId resolves into the localized token name', () => {
	const vars = resolveTokenVar({ player: 'Ana', tokenId: 'camion' }, t)!;
	assert.equal(vars.token, 'camión');
	assert.equal(vars.player, 'Ana'); // the rest is untouched
});

test('announcements without a tokenId (or with an explicit token) pass through', () => {
	const plain = { player: 'Ana' };
	assert.equal(resolveTokenVar(plain, t), plain);

	const explicit = { tokenId: 'camion', token: 'ya puesto' };
	assert.equal(resolveTokenVar(explicit, t)!.token, 'ya puesto');

	const empty = { tokenId: '' };
	assert.equal(resolveTokenVar(empty, t), empty);

	assert.equal(resolveTokenVar(undefined, t), undefined);
});
