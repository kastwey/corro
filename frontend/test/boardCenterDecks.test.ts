import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { Board } from '../src/board.js';
import type { Player, Square } from '../src/models.js';

// The center of the board shows the two card-deck piles (Fortune / Treasury) as a
// purely-visual, aria-hidden decoration. They double as the launch point of the card-draw
// flight, so the board also exposes their viewport rect (getDeckRect) and the drawing
// player's token rect (getTokenRect). These tests pin that wiring; the flight animation
// itself is visual (Web Animations API) and lives in cardFlight.

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	document.body.innerHTML = '';
});

function squares(n: number): Square[] {
	return Array.from({ length: n }, (_, i) => ({ id: i, name: `S${i}`, type: 'property', x: i % 11, y: 0 } as Square));
}

function makeBoard(sqs: Square[], freeParkingJackpot = false, pot = 0, decks: { id: string; label: string }[] = []):
	{ board: Board; el: HTMLElement; setPot: (n: number) => void } {
	const el = document.createElement('div');
	el.id = 'board';
	document.body.appendChild(el);
	let potValue = pot;
	const board = new Board(el, 11, () => [], () => sqs, {
		getFreeParkingPot: () => potValue,
		isFreeParkingJackpot: () => freeParkingJackpot,
		getDecks: () => decks,
	} as any);
	return { board, el, setPot: (n: number) => { potValue = n; } };
}

function player(over: Partial<Player>): Player {
	return { id: 'a', name: 'Ann', token: 'car' as any, position: 0, money: 0, properties: [], releasePasses: 0, ...over };
}

test('rendering the board draws both center deck piles, aria-hidden', () => {
	const { board, el } = makeBoard(squares(5));

	board.render();

	const chance = el.querySelector('.deck--chance');
	const community = el.querySelector('.deck--community');
	assert.ok(chance, 'the Chance deck pile is rendered');
	assert.ok(community, 'the Treasury deck pile is rendered');
	// The whole center is aria-hidden, so the decks never reach the screen reader.
	assert.equal(el.querySelector('.board-center')!.getAttribute('aria-hidden'), 'true');
});

test('the centre Free Parking pot shows only when the jackpot house rule is active', () => {
	const off = makeBoard(squares(5), false);
	off.board.render();
	assert.equal(off.el.querySelector('.free-parking'), null, 'no pot when the rule is off');

	const on = makeBoard(squares(5), true);
	on.board.render();
	assert.ok(on.el.querySelector('.free-parking'), 'pot rendered when the rule is on');
	assert.ok(on.el.querySelector('[data-free-parking-amount]'), 'pot amount element present');
	// The decks are always present regardless of the pot.
	assert.ok(on.el.querySelector('.deck--chance') && on.el.querySelector('.deck--community'));
});

test('the centre pot shows when money is present even if the rule flag is absent', () => {
	// A game restored from before the rule flag reached the client: the flag reads false, but
	// the pot already holds money — which only the jackpot rule could have produced — so it must
	// still be shown rather than hidden.
	const { board, el } = makeBoard(squares(5), false, 250);
	board.render();
	assert.ok(el.querySelector('.free-parking'), 'pot shown because money is present');
	assert.equal(el.querySelector('[data-free-parking-amount]')!.textContent, '250€');
});

test('the pot UI appears when money arrives after an empty render', () => {
	const { board, el, setPot } = makeBoard(squares(5), false, 0);
	board.render();
	assert.equal(el.querySelector('.free-parking'), null, 'no pot at an empty start with the rule off');

	setPot(120);
	board.updateFreeParkingPot(120);
	assert.ok(el.querySelector('.free-parking'), 'pot appears once money arrives');
	assert.equal(el.querySelector('[data-free-parking-amount]')!.textContent, '120€');
});

test('getDeckRect returns a rect for each deck once rendered, null before', () => {
	const { board } = makeBoard(squares(5));
	assert.equal(board.getDeckRect('chance'), null, 'no rect before render');

	board.render();

	assert.ok(board.getDeckRect('chance'), 'chance deck has a rect after render');
	assert.ok(board.getDeckRect('community'), 'community deck has a rect after render');
});

test('a package game labels the center piles with its own decks and resolves them by id', () => {
	const { board, el } = makeBoard(squares(5), false, 0, [
		{ id: 'fortune', label: 'Quantum Anomaly' },
		{ id: 'blackmarket', label: 'Black Market' },
	]);
	board.render();

	const labels = Array.from(el.querySelectorAll('.deck__label')).map(l => l.textContent);
	assert.deepEqual(labels, ['Quantum Anomaly', 'Black Market'], 'piles use the package deck names');
	assert.ok(board.getDeckRect('fortune'), 'rect resolves by the package deck id');
	assert.ok(board.getDeckRect('blackmarket'));
	assert.equal(board.getDeckRect('chance'), null, 'classic ids are absent in a package game');
});

test('center deck labels from a package are HTML-escaped (the upload is untrusted)', () => {
	const { board, el } = makeBoard(squares(5), false, 0, [
		{ id: 'x', label: '<img src=x onerror=alert(1)>' },
	]);
	board.render();

	const label = el.querySelector('.deck__label')!;
	assert.equal(label.querySelector('img'), null, 'no element is injected from the label');
	assert.ok(label.textContent!.includes('<img'), 'the markup is shown as inert text');
});

test('getTokenRect resolves the drawing player\'s token, null for an absent player', () => {
	const { board } = makeBoard(squares(5));
	board.render();
	board.renderPlayers([player({ id: 'a', position: 2 })], (k) => k);

	assert.ok(board.getTokenRect('a'), 'the placed token has a rect');
	assert.equal(board.getTokenRect('ghost'), null, 'an unknown player has no token rect');
});
