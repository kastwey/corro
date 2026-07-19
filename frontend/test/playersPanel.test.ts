import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { PlayerPanel, type PlayerPanelDeps } from '../src/playerPanel.js';
import type { Player, Square } from '../src/models.js';

/**
 * DOM tests for the always-visible, interactive players panel. Each player is a
 * roving-tabindex row (.player-card) with a per-row action toolbar (Information /
 * Propose trade / Go to player) reached with Right arrow / Shift+F10, mirroring the
 * manage-properties and notifications lists. Ctrl+P (panel.focus()) lands on the
 * current player's row. Actions fire their callback WITHOUT closing anything, since
 * the panel is persistent.
 */

function sq(id: number, name: string): Square {
	return { id, name, x: 0, y: 0 };
}

const SQUARES: Square[] = [sq(0, 'Go'), sq(1, 'Brown 1'), sq(2, 'Brown 2'), sq(3, 'Pink 1')];

function players(): Player[] {
	return [
		{ id: 'A', name: 'Ann', token: 'disc', position: 1, money: 1500, properties: [], releasePasses: 0 },
		{ id: 'B', name: 'Bob', token: 'cross', position: 3, money: 800, properties: [], releasePasses: 0, isHeld: true },
	];
}

let calls: { info: string[]; trade: string[]; goto: string[] };

function makePanel(over: Partial<PlayerPanelDeps> = {}, roster: Player[] = players()) {
	calls = { info: [], trade: [], goto: [] };
	const mount = document.createElement('div');
	document.body.appendChild(mount);
	const panel = new PlayerPanel();
	panel.init(mount, {
		getPlayers: () => roster,
		getSquares: () => SQUARES,
		getCurrentTurnId: () => 'A',
		getMyId: () => 'A',
		getTotalDebt: () => 0,
		isMyTurn: () => true,
		onShowInfo: (pid) => calls.info.push(pid),
		onProposeTrade: (pid) => calls.trade.push(pid),
		onGoToPlayer: (pid) => calls.goto.push(pid),
		...over,
	});
	return { panel, mount, roster };
}

function dispatchKey(target: Element, key: string, init: KeyboardEventInit = {}): Element {
	target.dispatchEvent(new (globalThis as any).window.KeyboardEvent('keydown', { key, bubbles: true, ...init }));
	return document.activeElement as Element;
}

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	document.body.innerHTML = '';
});

test('each player is a focusable row whose aria-label reads name, money, position and holding', () => {
	makePanel();
	const rows = Array.from(document.querySelectorAll('.player-card')) as HTMLElement[];
	assert.equal(rows.length, 2);
	assert.equal(rows[0].dataset.playerId, 'A');
	// Ann is me and the current turn.
	assert.equal(rows[0].getAttribute('aria-label'), 'Ann. (you). Current turn. Money: 1500 euros. Position: Brown 1');
	assert.equal(rows[0].getAttribute('aria-current'), 'true');
	// Bob is in holding → his accessible name surfaces it.
	assert.equal(rows[1].getAttribute('aria-label'), 'Bob. Money: 800 euros. Position: Pink 1. In holding');
});

test('the row holding the turn wears a visible (decorative) die; the others none', () => {
	// Live-play bug: the subtle glow alone didn't tell a sighted player who plays. The 🎲
	// glyph is aria-hidden — the row label + aria-current already carry it for a reader.
	makePanel();
	const rows = Array.from(document.querySelectorAll('.player-card')) as HTMLElement[];
	const die = rows[0].querySelector('.player-card__turn')!;
	assert.ok(die, 'the current-turn row shows the die');
	assert.equal(die.getAttribute('aria-hidden'), 'true');
	assert.equal(rows[1].querySelector('.player-card__turn'), null, 'other rows show none');
});

test('a player with no live connection shows a Disconnected tag and voices it in the row', () => {
	const roster = players();
	roster[1] = { ...roster[1], isHeld: false, isConnected: false };
	makePanel({}, roster);

	const rows = Array.from(document.querySelectorAll('.player-card')) as HTMLElement[];
	// Visual tag in the meta row…
	const tag = rows[1].querySelector('.player-tag--offline');
	assert.ok(tag, 'offline tag rendered');
	assert.equal(tag!.textContent, 'Disconnected');
	// …and the accessible row label says it too (what a screen reader reads).
	assert.match(rows[1].getAttribute('aria-label')!, /Bob. Disconnected\./);
});

test('the Disconnected tag disappears when the player reconnects (in-place update)', () => {
	const roster = players();
	roster[1] = { ...roster[1], isHeld: false, isConnected: false };
	const { panel } = makePanel({}, roster);
	assert.ok(document.querySelectorAll('.player-card')[1].querySelector('.player-tag--offline'));

	roster[1] = { ...roster[1], isConnected: true };
	panel.update();

	const row = document.querySelectorAll('.player-card')[1] as HTMLElement;
	assert.equal(row.querySelector('.player-tag--offline'), null, 'tag removed on reconnect');
	assert.doesNotMatch(row.getAttribute('aria-label')!, /Disconnected/);
});

test('the "go to player" action hides in the race family (several pieces, no single target)', () => {
	makePanel({ showGoToPlayer: () => false });
	const buttons = Array.from(document.querySelectorAll('.player-card__btn'))
		.map(b => b.getAttribute('data-action'));
	assert.ok(!buttons.includes('goto'), 'no goto action when the family gates it off');
	assert.ok(buttons.includes('info'), 'the other row actions survive');
});

test('the "go to player" action shows by default (property and track have one target)', () => {
	makePanel();
	const buttons = Array.from(document.querySelectorAll('.player-card__btn'))
		.map(b => b.getAttribute('data-action'));
	assert.ok(buttons.includes('goto'));
});

test('focus() lands on the current player row (roving tab stop)', () => {
	const { panel } = makePanel();
	assert.equal(panel.focus(), true);
	const ann = document.querySelector('.player-card') as HTMLElement;
	assert.equal(document.activeElement, ann);
	assert.equal(ann.tabIndex, 0);
});

test('focus() falls back to the first row when the current player is unknown', () => {
	const { panel } = makePanel({ getCurrentTurnId: () => null });
	assert.equal(panel.focus(), true);
	const rows = Array.from(document.querySelectorAll('.player-card')) as HTMLElement[];
	assert.equal(document.activeElement, rows[0]);
});

test('Right arrow enters the toolbar; Information / Go to player are always present', () => {
	const { panel } = makePanel();
	panel.focus();
	const ann = document.querySelector('.player-card') as HTMLElement;
	// The per-player toolbar names the player so a screen reader knows whose actions these are.
	assert.equal(ann.querySelector('.player-card__actions')!.getAttribute('aria-label'), 'Actions for Ann');
	const labels = Array.from(ann.querySelectorAll('.player-card__actions button')).map(b => b.textContent);
	// My turn, but Ann is me → no trade action; Information + Go to player only.
	assert.deepEqual(labels, ['Player information', 'Go to player']);

	const afterRight = dispatchKey(ann, 'ArrowRight');
	assert.equal((afterRight as HTMLElement).textContent, 'Player information');
});

test('Propose trade appears only for other players on my turn', () => {
	makePanel();
	const bob = Array.from(document.querySelectorAll('.player-card'))[1] as HTMLElement;
	const labels = Array.from(bob.querySelectorAll('.player-card__actions button')).map(b => b.textContent);
	assert.deepEqual(labels, ['Player information', 'Propose trade', 'Go to player']);
});

test('Propose trade is hidden when it is not my turn', () => {
	makePanel({ isMyTurn: () => false });
	const bob = Array.from(document.querySelectorAll('.player-card'))[1] as HTMLElement;
	const labels = Array.from(bob.querySelectorAll('.player-card__actions button')).map(b => b.textContent);
	assert.deepEqual(labels, ['Player information', 'Go to player']);
});

test('activating an action fires its callback and keeps the panel mounted', () => {
	makePanel();
	const rows = Array.from(document.querySelectorAll('.player-card')) as HTMLElement[];

	(rows[0].querySelector('.player-card__actions button') as HTMLButtonElement).click(); // Information
	assert.deepEqual(calls.info, ['A']);

	const bobButtons = rows[1].querySelectorAll('.player-card__actions button');
	(bobButtons[1] as HTMLButtonElement).click(); // Propose trade
	assert.deepEqual(calls.trade, ['B']);
	(bobButtons[2] as HTMLButtonElement).click(); // Go to player
	assert.deepEqual(calls.goto, ['B']);

	// The panel is persistent: the rows are still in the DOM.
	assert.equal(document.querySelectorAll('.player-card').length, 2);
});

test('Shift+F10 opens a context menu mirroring the focused row actions', () => {
	const { panel } = makePanel();
	panel.focus(); // lands on Ann (current turn)
	const ann = document.querySelector('.player-card') as HTMLElement;
	dispatchKey(ann, 'ArrowDown');
	const bob = Array.from(document.querySelectorAll('.player-card'))[1] as HTMLElement;
	assert.equal(document.activeElement, bob);
	dispatchKey(bob, 'F10', { shiftKey: true });
	const menu = document.querySelector('.player-context-menu')!;
	assert.ok(menu);
	const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map(i => i.textContent);
	assert.deepEqual(items, ['Player information', 'Propose trade', 'Go to player']);
});

test('update() reconciles rows in place, preserving the focused row', () => {
	const roster = players();
	const { panel } = makePanel({}, roster);
	panel.focus();
	const ann = document.querySelector('.player-card') as HTMLElement;
	assert.equal(document.activeElement, ann);

	roster[0].money = 1234; // Ann earns/pays something.
	panel.update();

	// The same <li> element is reused (focus preserved) and its label reflects the change.
	assert.equal(document.activeElement, ann);
	assert.equal(document.querySelector('.player-card') as HTMLElement, ann);
	assert.match(ann.getAttribute('aria-label')!, /Money: 1234 euros/);
});

test('update() drops rows for players that left the game', () => {
	const roster = players();
	const { panel } = makePanel({}, roster);
	assert.equal(document.querySelectorAll('.player-card').length, 2);

	roster.splice(1, 1); // Bob is bankrupt and leaves.
	panel.update();

	const rows = Array.from(document.querySelectorAll('.player-card')) as HTMLElement[];
	assert.equal(rows.length, 1);
	assert.equal(rows[0].dataset.playerId, 'A');
});

// ── Debt: net balance + debt colour ─────────────────────────────────────────────

test('a debt-free player shows their cash with no debt styling', () => {
	makePanel({ getTotalDebt: () => 0 });
	const money = document.querySelector('.player-card__money') as HTMLElement;
	assert.equal(money.textContent, '1500€');
	assert.ok(!money.classList.contains('player-card__money--debt'));
	const ann = document.querySelector('.player-card') as HTMLElement;
	assert.match(ann.getAttribute('aria-label')!, /Money: 1500 euros/);
});

test('an indebted player shows a negative net balance in the debt colour', () => {
	// Ann has 1500 cash but owes 1700 → net -200, short 200.
	makePanel({ getTotalDebt: (id) => (id === 'A' ? 1700 : 0) });
	const money = document.querySelector('.player-card__money') as HTMLElement;
	assert.equal(money.textContent, '-200€');
	assert.ok(money.classList.contains('player-card__money--debt'));

	const ann = document.querySelector('.player-card') as HTMLElement;
	const label = ann.getAttribute('aria-label')!;
	assert.match(label, /-200 euros/);     // net balance
	assert.match(label, /200 euros short/); // shortfall to clear the debt
});

test('clearing the debt re-renders the row back to a healthy positive figure', () => {
	const roster = players();
	const debts: Record<string, number> = { A: 1700 };
	const { panel } = makePanel({ getTotalDebt: (id) => debts[id] ?? 0 }, roster);

	let money = document.querySelector('.player-card__money') as HTMLElement;
	assert.ok(money.classList.contains('player-card__money--debt'));

	// Debt paid off and cash recovered; the next state update drops the debt styling.
	roster[0].money = 900;
	debts.A = 0;
	panel.update();

	money = document.querySelector('.player-card__money') as HTMLElement;
	assert.equal(money.textContent, '900€');
	assert.ok(!money.classList.contains('player-card__money--debt'));
});

// ── Surgical updates: never rebuild a row's subtree, only mutate what changed ─────

test('update() mutates a row in place: its child nodes keep their identity', () => {
	const roster = players();
	const { panel } = makePanel({}, roster);
	const ann = document.querySelector('.player-card') as HTMLElement;
	const token = ann.querySelector('.player-card__token');
	const money = ann.querySelector('.player-card__money');
	const toolbar = ann.querySelector('.player-card__actions');
	const infoBtn = ann.querySelector('.player-card__actions button');

	roster[0].money = 1234;
	roster[0].position = 3; // moves to Pink 1
	panel.update();

	// Same element instances — nothing was torn down and recreated.
	assert.equal(document.querySelector('.player-card'), ann);
	assert.equal(ann.querySelector('.player-card__token'), token);
	assert.equal(ann.querySelector('.player-card__money'), money);
	assert.equal(ann.querySelector('.player-card__actions'), toolbar);
	assert.equal(ann.querySelector('.player-card__actions button'), infoBtn);
	// …yet the content reflects the new state.
	assert.equal(money!.textContent, '1234€');
	assert.match(ann.getAttribute('aria-label')!, /Position: Pink 1/);
});

test('update() keeps focus on a surviving toolbar button', () => {
	const roster = players();
	const { panel } = makePanel({}, roster);
	// Focus Bob's "Go to player" button directly (a surviving action).
	const bob = Array.from(document.querySelectorAll('.player-card'))[1] as HTMLElement;
	const gotoBtn = Array.from(bob.querySelectorAll('.player-card__actions button'))
		.find(b => b.textContent === 'Go to player') as HTMLButtonElement;
	gotoBtn.focus();
	assert.equal(document.activeElement, gotoBtn);

	roster[1].money = 500; // unrelated change to Bob's row
	panel.update();

	// The very same button kept focus (it was updated in place, not recreated).
	assert.equal(document.activeElement, gotoBtn);
	assert.ok(gotoBtn.isConnected);
});

test('update() lands focus on the row when a focused action button disappears', () => {
	const roster = players();
	let myTurn = true;
	const { panel } = makePanel({ isMyTurn: () => myTurn }, roster);
	const bob = Array.from(document.querySelectorAll('.player-card'))[1] as HTMLElement;
	const tradeBtn = Array.from(bob.querySelectorAll('.player-card__actions button'))
		.find(b => b.textContent === 'Propose trade') as HTMLButtonElement;
	tradeBtn.focus();
	assert.equal(document.activeElement, tradeBtn);

	// It is no longer my turn → the Propose-trade button is removed on the next update.
	myTurn = false;
	panel.update();

	assert.ok(!tradeBtn.isConnected);
	// Focus is rescued onto the owning row rather than lost to <body>.
	assert.equal(document.activeElement, bob);
});

test('update() toggles the holding tag in place without rebuilding the row', () => {
	const roster = players();
	const { panel } = makePanel({}, roster);
	const bob = Array.from(document.querySelectorAll('.player-card'))[1] as HTMLElement;
	assert.ok(bob.querySelector('.player-tag--holding')); // Bob starts in holding

	roster[1].isHeld = false; // Bob escapes
	panel.update();
	assert.equal(document.querySelector('.player-card[data-player-id="B"]'), bob); // same row
	assert.ok(!bob.querySelector('.player-tag--holding'));
	assert.ok(!bob.getAttribute('aria-label')!.includes('In holding'));

	roster[1].isHeld = true; // …and is sent back
	panel.update();
	assert.ok(bob.querySelector('.player-tag--holding'));
});

test('a bankrupt player shows the bankrupt tag and announces it in the row label', () => {
	const roster = players();
	const { panel } = makePanel({}, roster);
	const ann = document.querySelector('.player-card[data-player-id="A"]') as HTMLElement;
	assert.ok(!ann.querySelector('.player-tag--bankrupt')); // solvent to begin with
	assert.ok(!ann.getAttribute('aria-label')!.includes('Bankrupt'));

	roster[0].isBankrupt = true; // Ann (the local player) goes bankrupt
	panel.update();
	assert.equal(document.querySelector('.player-card[data-player-id="A"]'), ann); // same row
	assert.ok(ann.querySelector('.player-tag--bankrupt'));
	assert.ok(ann.getAttribute('aria-label')!.includes('Bankrupt'));

	roster[0].isBankrupt = false; // (defensive: clears in place)
	panel.update();
	assert.ok(!ann.querySelector('.player-tag--bankrupt'));
});


// ── Race family: the row identity is the SQUADRON, not money ─────────────────

test('race mode shows the squadron name with a seat-colour marker instead of money', () => {
	const roster = players();
	roster[0] = { ...roster[0], color: '#e0402f' };
	makePanel({ getBoardIdentity: (pid) => (pid === 'A' ? 'Red Squadron' : 'Blue Squadron') }, roster);

	const rows = Array.from(document.querySelectorAll('.player-card')) as HTMLElement[];
	const seatLine = rows[0].querySelector('.player-card__seat') as HTMLElement;
	assert.ok(seatLine, 'seat identity line rendered where money normally sits');
	assert.equal(seatLine.textContent, 'Red Squadron');
	assert.equal(seatLine.style.getPropertyValue('--seat-color'), '#e0402f');
	assert.equal(seatLine.style.color, '', 'small identity text uses the theme text colour');
	// The accessible row label voices the squadron and NOT a money figure.
	assert.match(rows[0].getAttribute('aria-label')!, /Red Squadron/);
	assert.doesNotMatch(rows[0].getAttribute('aria-label')!, /Money/);
});

test('property games keep the money line untouched', () => {
	makePanel(); // no getBoardIdentity dep
	const rows = Array.from(document.querySelectorAll('.player-card')) as HTMLElement[];
	assert.equal(rows[0].querySelector('.player-card__seat'), null);
	assert.match(rows[0].getAttribute('aria-label')!, /Money: 1500 euros/);
});
