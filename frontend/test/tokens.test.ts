import test from 'node:test';
import assert from 'node:assert/strict';
import {
	convertTokenToSnakeCase,
	getTokenName,
	getUsedTokens,
	renderTokenSelector
} from '../src/lobby/tokens.js';
import { tokenIconHtml, setPackageTokens } from '../src/tokenIcons.js';
import { setupDom } from './helpers/dom.js';
import type { GameInfo } from '../src/models.js';

// Every board ships its own tokens (the engine has no built-in set), so the selector/icons work off
// the registered package tokens.
const BOARD_TOKENS = [
	{ id: 'disc', svg: 'M7 3h10v12h-10z', nameKey: 'tokens.disc' },
	{ id: 'star', svg: 'M2 14l3-4h4z', nameKey: 'tokens.star' },
	{ id: 'cross', svg: 'M9 3h4v10z', nameKey: 'tokens.cross' },
];

test('convertTokenToSnakeCase converts PascalCase server tokens', () => {
	assert.equal(convertTokenToSnakeCase('Disc'), 'disc');
	assert.equal(convertTokenToSnakeCase('Star'), 'star');
	assert.equal(convertTokenToSnakeCase('Diamond'), 'diamond');
	assert.equal(convertTokenToSnakeCase('Cross'), 'cross');
});

test('each board token renders its own SVG path, never the generic fallback', () => {
	setPackageTokens(BOARD_TOKENS);
	const fallback = '<circle cx="12" cy="12" r="7"/>';
	for (const tk of BOARD_TOKENS) {
		const html = tokenIconHtml(tk.id);
		assert.match(html, /^<svg\b/, `${tk.id} should render an <svg> element`);
		assert.ok(html.includes(`<path d="${tk.svg}"/>`), `${tk.id} renders its own path`);
		assert.ok(!html.includes(fallback), `${tk.id} is falling back to the generic icon`);
	}
});

test('an unknown token id falls back to the neutral disc', () => {
	setPackageTokens([]);
	assert.ok(tokenIconHtml('nope').includes('<circle cx="12" cy="12" r="7"/>'));
});

test('getTokenName uses the package token nameKey, else the game.token_* key', () => {
	setPackageTokens([{ id: 'ufo', nameKey: 'tokens.ufo' }]);
	const t = (key: string, fallback?: string) =>
		key === 'tokens.ufo' ? 'OVNI'
			: key === 'game.token_star' ? 'Estrella'
				: (fallback ?? key);
	assert.equal(getTokenName('ufo', t), 'OVNI');          // package token -> its own nameKey
	assert.equal(getTokenName('star', t), 'Estrella');    // not a package token -> game.token_* key
});

test('getUsedTokens collects normalized tokens from players', () => {
	const gameInfo = {
		players: [
			{ token: 'Disc' },
			{ token: 'Star' }
		]
	} as unknown as GameInfo;

	const used = getUsedTokens(gameInfo);
	assert.ok(used.has('disc'));
	assert.ok(used.has('star'));
	assert.equal(used.size, 2);
});

test('getUsedTokens handles missing players list', () => {
	const used = getUsedTokens({} as unknown as GameInfo);
	assert.equal(used.size, 0);
});

test('renderTokenSelector offers the board tokens and highlights the selected one', () => {
	setupDom();
	setPackageTokens(BOARD_TOKENS);
	const t = (k: string, fallback?: string) => fallback ?? k;
	const container = document.createElement('ul');

	renderTokenSelector(container, t, BOARD_TOKENS[2].id);

	// The radio is a visually-hidden overlay nested INSIDE its label; the highlight CSS depends
	// on that nesting (the old sibling selector assumed input-then-label and never matched).
	const labels = container.querySelectorAll('.token-label');
	assert.equal(labels.length, BOARD_TOKENS.length);
	for (const label of labels) {
		assert.ok(label.querySelector('.token-radio'), 'each label contains its own radio');
	}

	// Exactly one label is highlighted, and it is the selected token's.
	const highlighted = container.querySelectorAll('.token-label:has(.token-radio:checked)');
	assert.equal(highlighted.length, 1);
	const checkedRadio = container.querySelector<HTMLInputElement>('.token-radio:checked')!;
	assert.equal(checkedRadio.value, BOARD_TOKENS[2].id);
	assert.ok(highlighted[0].contains(checkedRadio));
});

test('renderTokenSelector names the group as a radiogroup so VoiceOver announces the label', () => {
	setupDom();
	setPackageTokens(BOARD_TOKENS);
	const t = (k: string, fallback?: string) => k === 'lobby.selectToken' ? 'Elige tu ficha' : (fallback ?? k);
	const container = document.createElement('ul');

	renderTokenSelector(container, t);

	assert.equal(container.getAttribute('role'), 'radiogroup');
	assert.equal(container.getAttribute('aria-label'), 'Elige tu ficha');
	// The rows drop their list semantics so they don't fragment the radiogroup.
	for (const li of container.querySelectorAll('.token-item')) {
		assert.equal(li.getAttribute('role'), 'presentation');
	}
});

// Choosing a token is OPTIONAL (live-play question: on boards where the piece is a pure
// avatar, picking one is empty ceremony): exactly one arrives preselected on both forms.

test('with no prior selection the FIRST token arrives preselected (the create form)', () => {
	setupDom();
	setPackageTokens(BOARD_TOKENS);
	const container = document.createElement('ul');

	renderTokenSelector(container, (k, f) => f ?? k);

	const checked = container.querySelectorAll<HTMLInputElement>('.token-radio:checked');
	assert.equal(checked.length, 1);
	assert.equal(checked[0].value, BOARD_TOKENS[0].id);
});

test('the join form preselects the first FREE token, skipping the taken ones', () => {
	setupDom();
	setPackageTokens(BOARD_TOKENS);
	const container = document.createElement('ul');

	renderTokenSelector(container, (k, f) => f ?? k, null, new Set(['disc']));

	const checked = container.querySelectorAll<HTMLInputElement>('.token-radio:checked');
	assert.equal(checked.length, 1);
	assert.equal(checked[0].value, 'star'); // disc is taken: the next free one
});

test('a previous selection that became TAKEN falls back to the first free token', () => {
	setupDom();
	setPackageTokens(BOARD_TOKENS);
	const container = document.createElement('ul');

	renderTokenSelector(container, (k, f) => f ?? k, 'cross', new Set(['cross']));

	const checked = container.querySelectorAll<HTMLInputElement>('.token-radio:checked');
	assert.equal(checked.length, 1);
	assert.equal(checked[0].value, 'disc');
});
