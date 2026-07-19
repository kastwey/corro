import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import {
	playerDetailDialog,
	projectPlayerProperties,
	playerPropertyLabel,
	type PlayerDetailData,
} from '../src/playerDetailDialog.js';
import type { Square } from '../src/models.js';

/**
 * Tests for the player-detail modal. Pure helpers (projection + accessible label) are
 * DOM-free; the dialog tests reuse the shared jsdom + fake-i18next harness and assert the
 * roving-tabindex property list and the conditional "Propose trade" footer button.
 */

function sq(id: number, over: Partial<Square>): Square {
	return { id, name: `Sq${id}`, x: 0, y: 0, ...over };
}

// ── Pure helpers ────────────────────────────────────────────────────────────

test('projectPlayerProperties maps owned indices, skipping unknown squares', () => {
	const squares = [
		sq(0, { name: 'Go', type: 'go' }),
		sq(1, { name: 'Brown 1', color: 'brown', smallBuildings: 2 }),
		sq(2, { name: 'Station', mortgaged: true }),
	];
	const items = projectPlayerProperties(squares, [1, 2, 99]); // 99 is out of range
	assert.equal(items.length, 2);
	assert.deepEqual(items[0], { index: 1, name: 'Brown 1', color: 'brown', groupNameKey: undefined, smallBuildings: 2, bigBuildings: 0, mortgaged: false });
	assert.deepEqual(items[1], { index: 2, name: 'Station', color: undefined, groupNameKey: undefined, smallBuildings: 0, bigBuildings: 0, mortgaged: true });
});

test('projectPlayerProperties groups by colour in board order, colourless last', () => {
	// Board order: brown (pos 1-2), light blue (pos 3), red (pos 6). The owned indices are
	// given out of order and intermixed with colourless squares (a utility and a station);
	// the projection must regroup them by colour group (in the order the groups first appear
	// on the board) and push the colourless ones to the end, keeping board order within a
	// group.
	const squares = [
		sq(0, { name: 'Go', type: 'go' }),
		sq(1, { name: 'Brown 1', color: 'brown' }),
		sq(2, { name: 'Brown 2', color: 'brown' }),
		sq(3, { name: 'LightBlue 1', color: 'lightblue' }),
		sq(4, { name: 'Electric', type: 'utility' }),
		sq(5, { name: 'Station', type: 'railroad' }),
		sq(6, { name: 'Red 1', color: 'red' }),
	];
	const owned = [6, 5, 3, 1, 4, 2]; // deliberately scrambled
	const order = projectPlayerProperties(squares, owned).map(i => i.index);
	assert.deepEqual(order, [1, 2, 3, 6, 4, 5]);
});

test('playerPropertyLabel reads name, colour group, buildings and mortgage', () => {
	const translate = (k: string, v?: Record<string, any>) => {
		switch (k) {
			case 'color_brown': return 'Brown';
			case 'manage_state_hotel': return 'hotel';
			case 'manage_state_houses': return `${v!.count} house(s)`;
			case 'manage_state_mortgaged': return 'mortgaged';
			default: return k;
		}
	};
	assert.equal(
		playerPropertyLabel({ index: 1, name: 'Brown 1', color: 'brown', smallBuildings: 3, bigBuildings: 0, mortgaged: false }, translate),
		'Brown 1. Brown. 3 house(s)',
	);
	assert.equal(
		playerPropertyLabel({ index: 2, name: 'Brown 2', color: 'brown', smallBuildings: 0, bigBuildings: 1, mortgaged: true }, translate),
		'Brown 2. Brown. hotel. mortgaged',
	);
	assert.equal(
		playerPropertyLabel({ index: 5, name: 'Station', smallBuildings: 0, bigBuildings: 0, mortgaged: false }, translate),
		'Station',
	);
});

// ── Dialog (jsdom) ────────────────────────────────────────────────────────────

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	if (playerDetailDialog.isOpen()) playerDetailDialog.close();
});

const DATA: PlayerDetailData = {
	name: 'Bob',
	tokenName: 'Disc',
	money: 1200,
	positionName: 'Brown 1',
	held: true,
	releasePasses: 1,
	isBankrupt: false,
	properties: [
		{ index: 1, name: 'Brown 1', color: 'brown', smallBuildings: 2, bigBuildings: 0, mortgaged: false },
		{ index: 5, name: 'Station', smallBuildings: 0, bigBuildings: 0, mortgaged: true },
	],
};

function open(over: Partial<{ data: PlayerDetailData; canProposeTrade: boolean }> = {}): { trades: number } {
	const calls = { trades: 0 };
	playerDetailDialog.open({
		getData: () => over.data ?? DATA,
		canProposeTrade: over.canProposeTrade ?? false,
		onProposeTrade: () => { calls.trades++; },
	});
	return calls;
}

test('renders a summary and one navigable row per property', () => {
	open();
	const dialog = document.getElementById('player-detail-dialog')!;
	assert.ok(dialog);
	assert.equal(dialog.tagName, 'DIALOG');
	assert.ok(dialog.hasAttribute('open'));
	// Operated in focus mode (roving-tabindex summary + property lines): an application surface
	// so the reader keeps its virtual cursor off and arrow keys drive the navigation.
	assert.equal(dialog.getAttribute('role'), null);
	const application = dialog.querySelector('.player-detail-application')!;
	assert.equal(application.getAttribute('role'), 'application');
	assert.equal(application.getAttribute('aria-labelledby'), 'player-detail-title');
	assert.equal(dialog.querySelector('.player-detail-panel__header')?.tagName, 'DIV');
	assert.equal(dialog.getAttribute('aria-modal'), null);

	const rows = Array.from(document.querySelectorAll('.player-detail-item')) as HTMLElement[];
	assert.equal(rows.length, 2);
	assert.equal(rows[0].getAttribute('role'), 'listitem');
	assert.equal(rows[0].getAttribute('aria-label'), 'Brown 1. Brown. 2 buildings');
	assert.equal(rows[1].getAttribute('aria-label'), 'Station. mortgaged');
	// The visible label is hidden from the screen reader to avoid a double read.
	assert.equal(rows[0].querySelector('.player-detail-item__name')!.getAttribute('aria-hidden'), 'true');
});

test('renders the summary as a navigable, labelled roving list', () => {
	open();
	const lines = Array.from(document.querySelectorAll('.player-detail-summary__line')) as HTMLElement[];
	// token, money, position, in-holding, release-pass cards
	assert.equal(lines.length, 5);
	for (const li of lines) {
		assert.equal(li.getAttribute('role'), 'listitem');
		assert.ok((li.getAttribute('aria-label') ?? '').length > 0);
		// The visible text is hidden from the reader to avoid a double read.
		assert.equal(li.querySelector('.player-detail-summary__text')!.getAttribute('aria-hidden'), 'true');
	}
	// Exactly one tab stop in the summary list (roving tabindex).
	assert.equal(lines.filter(li => li.tabIndex === 0).length, 1);
});

test('opening focuses the first summary line (top of the read order)', () => {
	open();
	const first = document.querySelector('.player-detail-summary__line') as HTMLElement;
	assert.equal(document.activeElement, first);
	assert.equal(first.tabIndex, 0);
});

test('Up/Down arrows move focus between summary lines', () => {
	open();
	const lines = Array.from(document.querySelectorAll('.player-detail-summary__line')) as HTMLElement[];
	lines[0].dispatchEvent(new (globalThis as any).window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
	assert.equal(document.activeElement, lines[1]);
	lines[1].dispatchEvent(new (globalThis as any).window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
	assert.equal(document.activeElement, lines[0]);
});

test('the property list keeps exactly one tab stop so Tab reaches it', () => {
	open();
	const rows = Array.from(document.querySelectorAll('.player-detail-item')) as HTMLElement[];
	assert.equal(rows.filter(r => r.tabIndex === 0).length, 1);
});

test('Up/Down arrows move focus between property rows', () => {
	open();
	const rows = Array.from(document.querySelectorAll('.player-detail-item')) as HTMLElement[];
	rows[0].focus();
	rows[0].dispatchEvent(new (globalThis as any).window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
	assert.equal(document.activeElement, rows[1]);
	rows[1].dispatchEvent(new (globalThis as any).window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
	assert.equal(document.activeElement, rows[0]);
});

test('hides the Propose trade button unless canProposeTrade', () => {
	open({ canProposeTrade: false });
	assert.equal(document.querySelector('.player-detail-panel__trade'), null);
});

test('shows the Propose trade button and fires the callback, closing the modal', () => {
	const calls = open({ canProposeTrade: true });
	const tradeBtn = document.querySelector('.player-detail-panel__trade') as HTMLButtonElement;
	assert.ok(tradeBtn);
	tradeBtn.click();
	assert.equal(calls.trades, 1);
	assert.equal(playerDetailDialog.isOpen(), false);
});

test('a player with no properties shows the empty message and still focuses the summary', () => {
	open({ data: { ...DATA, properties: [] } });
	assert.ok(document.querySelector('.player-detail-panel__empty'));
	assert.equal(document.activeElement, document.querySelector('.player-detail-summary__line'));
});

test('the close button closes the modal', () => {
	open();
	(document.querySelector('.player-detail-panel__close') as HTMLButtonElement).click();
	assert.equal(playerDetailDialog.isOpen(), false);
});

test('a bankrupt player shows a bankruptcy line in the summary', () => {
	open({ data: { ...DATA, isBankrupt: true } });
	const lines = Array.from(document.querySelectorAll('.player-detail-summary__line'))
		.map(li => li.getAttribute('aria-label'));
	assert.ok(lines.some(l => l!.includes('Bankrupt')), 'summary voices the bankruptcy');
});

test('a solvent player shows no bankruptcy line', () => {
	open(); // DATA.isBankrupt === false
	const lines = Array.from(document.querySelectorAll('.player-detail-summary__line'))
		.map(li => li.getAttribute('aria-label'));
	assert.ok(!lines.some(l => l!.includes('Bankrupt')));
});
