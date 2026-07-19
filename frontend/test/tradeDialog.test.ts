import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { tradeableProperties, summarizeSide, tradePropertyLabel, colorGroupSlug, tradeDialog, propertyTradeValue, tradeSideValue, tradeFairness, tradeValuationText, tradeReviewValuationText, amountInputIssue, RELEASE_PASS_TRADE_VALUE } from '../src/tradeDialog.js';
import { TradeProposedHandler, TradeResolvedHandler } from '../src/commands/TradeHandlers.js';
import type { Square, TradeSideDto } from '../src/models.js';
import type { CommandContext } from '../src/commands/index.js';

// ── Test data ────────────────────────────────────────────────────────────────

function sq(id: number, over: Partial<Square>): Square {
	return { id, name: `Sq${id}`, x: 0, y: 0, ...over };
}

// Board: two brown (1,2 owned by A), one lightblue (4 owned by A), a railroad (5 owned by A),
// a utility (6 owned by B), and an unowned property (3). One brown is built.
function board(): Square[] {
	return [
		sq(0, { type: 'go', name: 'Go' }),
		sq(1, { type: 'property', name: 'Brown 1', color: 'brown', ownerId: 'A' }),
		sq(2, { type: 'property', name: 'Brown 2', color: 'brown', ownerId: 'A' }),
		sq(3, { type: 'property', name: 'Pink 1', color: 'pink' }),
		sq(4, { type: 'property', name: 'Light 1', color: 'lightblue', ownerId: 'A' }),
		sq(5, { type: 'railroad', name: 'Station', ownerId: 'A' }),
		sq(6, { type: 'utility', name: 'Water', ownerId: 'B' })
	];
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

test('tradeableProperties returns owned, ownable squares as indexes', () => {
	const props = tradeableProperties(board(), 'A');
	const indexes = props.map(p => p.index).sort((a, b) => a - b);
	assert.deepEqual(indexes, [1, 2, 4, 5]); // includes railroad, excludes unowned/utility(B)
	assert.equal(props.find(p => p.index === 5)!.name, 'Station');
});

test('tradeableProperties includes PACKAGE ownables by behavior, whatever their type', () => {
	// Regression (imperio-galactico): stations are type "transit" — not in the legacy
	// property/railroad/utility triple — and vanished from every trade. Package squares
	// carry behavior: 'ownable', which must win over the type guess.
	const b = board();
	b.push(
		sq(7, { type: 'transit', behavior: 'ownable', name: 'Estación Andrómeda', ownerId: 'A', price: 200 }),
		sq(8, { type: 'wormhole', behavior: 'ownable', name: 'Agujero X', ownerId: 'A', price: 150 }),
		sq(9, { type: 'transit', behavior: 'start', name: 'Puerto Estelar', ownerId: 'A' }), // not ownable by data
	);
	const props = tradeableProperties(b, 'A');
	const names = props.map(p => p.name);
	assert.ok(names.includes('Estación Andrómeda'), 'the transit station trades');
	assert.ok(names.includes('Agujero X'), 'any package-named ownable trades');
	assert.ok(!names.includes('Puerto Estelar'), 'behavior wins: a non-ownable never trades');
});

test('tradeableProperties excludes a whole colour group when any square has buildings', () => {
	const b = board();
	b[1].smallBuildings = 1; // a house on Brown 1 freezes the entire brown group
	const props = tradeableProperties(b, 'A');
	const indexes = props.map(p => p.index).sort((a, b) => a - b);
	assert.deepEqual(indexes, [4, 5]); // both brown squares now excluded
});

test('tradeableProperties excludes group with a hotel', () => {
	const b = board();
	b[2].bigBuildings = 1;
	const props = tradeableProperties(b, 'A');
	assert.ok(!props.some(p => p.index === 1 || p.index === 2));
});

// Prosody (live-play): the reader hears the summary as ONE line, so it must flow as a
// sentence — a spoken connector before the last item, and money worded as cash so it is
// never mistaken for one more property price in a row of figures.
test('summarizeSide flows as one sentence: cash worded, last item connected', () => {
	const t = (k: string, v?: any) =>
		k === 'trade_release_passes_count' ? `${v.count} holding`
			: k === 'trade_cash' ? `${v.amount} cash`
				: k;
	const side: TradeSideDto = {
		properties: [{ index: 1, name: 'Brown 1' }, { index: 2, name: 'Brown 2' }],
		money: 250,
		releasePasses: 1
	};
	assert.equal(summarizeSide(side, t, 'en'), 'Brown 1, Brown 2, 250€ cash, and 1 holding');
	assert.equal(summarizeSide(side, t, 'es'), 'Brown 1, Brown 2, 250€ cash y 1 holding');
});

test('summarizeSide returns "nothing" for an empty side', () => {
	const t = (k: string) => k;
	assert.equal(summarizeSide({ properties: [], money: 0, releasePasses: 0 }, t), 'trade_nothing');
});

// Bug #4: the review must show each property's price (in the board currency), for EVERY property.
// Before, the server never sent a price so no property in a received trade showed one.
test('tradePropertyLabel appends the price in the board currency when known', () => {
	const fmt = (v: number) => `${v}₡`;
	assert.equal(tradePropertyLabel({ index: 19, name: 'Acería Tubal', price: 200 }, fmt), 'Acería Tubal (200₡)');
	assert.equal(tradePropertyLabel({ index: 6, name: 'Roca Tycho', price: 100 }, fmt), 'Roca Tycho (100₡)');
});

test('tradePropertyLabel is just the name when the price is unknown (0/undefined)', () => {
	const fmt = (v: number) => `${v}₡`;
	assert.equal(tradePropertyLabel({ index: 5, name: 'Station' }, fmt), 'Station');
	assert.equal(tradePropertyLabel({ index: 5, name: 'Station', price: 0 }, fmt), 'Station');
});

test('summarizeSide voices each property with its price so a screen reader hears the worth', () => {
	const t = (k: string, v?: any) => (k === 'trade_release_passes_count' ? `${v.count} holding` : k);
	const side: TradeSideDto = {
		properties: [{ index: 19, name: 'Acería Tubal', price: 200 }, { index: 6, name: 'Roca Tycho', price: 100 }],
		money: 0,
		releasePasses: 0
	};
	// money() defaults to "€" in tests (no board loaded); the point is BOTH properties carry a price.
	assert.equal(summarizeSide(side, t, 'en'), 'Acería Tubal (200€) and Roca Tycho (100€)');
});

test('colorGroupSlug sanitises a colour into a CSS-safe group slug', () => {
	assert.equal(colorGroupSlug('brown'), 'brown');
	assert.equal(colorGroupSlug('Light Blue'), 'lightblue');
	assert.equal(colorGroupSlug(undefined), '');
	assert.equal(colorGroupSlug(''), '');
});

// ── Trade valuation ("monetary justice") ──────────────────────────────────────

test('propertyTradeValue uses price, or half (mortgage value) when mortgaged', () => {
	assert.equal(propertyTradeValue(sq(1, { price: 200 })), 200);
	assert.equal(propertyTradeValue(sq(1, { price: 200, mortgaged: true })), 100);
	assert.equal(propertyTradeValue(sq(1, {})), 0); // no price
	assert.equal(propertyTradeValue(undefined), 0);
});

test('tradeSideValue sums properties, cash and release passes', () => {
	const squares = [sq(0, {}), sq(1, { price: 100 }), sq(2, { price: 60, mortgaged: true })];
	// props: 100 + 30 = 130; cash 200; one release pass.
	const value = tradeSideValue(squares, [1, 2], 200, 1);
	assert.equal(value, 130 + 200 + RELEASE_PASS_TRADE_VALUE);
});

test('tradeSideValue ignores negative cash and holding counts', () => {
	assert.equal(tradeSideValue([], [], -50, -3), 0);
});

test('tradeFairness flags favorable, fair and unfavorable from the proposer\'s view', () => {
	assert.equal(tradeFairness(500, 650), 'favorable');   // receive much more
	assert.equal(tradeFairness(650, 500), 'unfavorable'); // give much more
	assert.equal(tradeFairness(500, 505), 'fair');        // within tolerance
	assert.equal(tradeFairness(0, 0), 'fair');            // nothing for nothing
});

test('tradeValuationText embeds both values and the verdict', () => {
	const t = (k: string, v?: any) =>
		k === 'trade_verdict_favorable' ? 'You win' :
		k === 'trade_valuation_summary' ? `give ${v.give} get ${v.receive}: ${v.verdict}` : k;
	assert.equal(tradeValuationText(500, 650, t), 'give 500 get 650: You win');
});

// ── Handlers (emit-only) ───────────────────────────────────────────────────────

function ctx(myPlayerId: string | null, captured: Array<{ event: string; data: any }>): CommandContext {
	return {
		gameState: null,
		board: null,
		myPlayerId,
		announce: () => {},
		emit: (event, data) => captured.push({ event, data }),
		updateGameState: () => {},
		deferVisual: (run) => run(),
		armForMove: () => {}
	};
}

test('TradeProposedHandler flags isForMe for the target and isMine for the initiator', () => {
	const response: any = {
		type: 'TRADE_PROPOSED', tradeId: 'T1',
		initiatorId: 'A', initiatorName: 'Ann',
		targetId: 'B', targetName: 'Bob',
		offered: { properties: [], money: 100, releasePasses: 0 },
		requested: { properties: [], money: 0, releasePasses: 0 }
	};
	const handler = new TradeProposedHandler();

	const asTarget: Array<{ event: string; data: any }> = [];
	handler.handle(response, ctx('B', asTarget));
	assert.equal(asTarget[0].event, 'tradeProposed');
	assert.equal(asTarget[0].data.isForMe, true);
	assert.equal(asTarget[0].data.isMine, false);

	const asInitiator: Array<{ event: string; data: any }> = [];
	handler.handle(response, ctx('A', asInitiator));
	assert.equal(asInitiator[0].data.isForMe, false);
	assert.equal(asInitiator[0].data.isMine, true);

	const asBystander: Array<{ event: string; data: any }> = [];
	handler.handle(response, ctx('C', asBystander));
	assert.equal(asBystander[0].data.isForMe, false);
	assert.equal(asBystander[0].data.isMine, false);
});

test('TradeResolvedHandler flags involvesMe only for the two parties', () => {
	const response: any = {
		type: 'TRADE_RESOLVED', tradeId: 'T1', outcome: 'accepted',
		initiatorId: 'A', targetId: 'B'
	};
	const handler = new TradeResolvedHandler();

	for (const [me, expected] of [['A', true], ['B', true], ['C', false]] as const) {
		const captured: Array<{ event: string; data: any }> = [];
		handler.handle(response, ctx(me, captured));
		assert.equal(captured[0].event, 'tradeResolved');
		assert.equal(captured[0].data.involvesMe, expected);
	}
});

// ── Dialog (jsdom) ──────────────────────────────────────────────────────────────

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	tradeDialog.close();
});

test('openBuilder renders a partner select and the proposer\'s tradeable properties', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 1 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), onPropose: () => {} });

	const dialog = document.getElementById('trade-dialog')!;
	assert.ok(dialog.hasAttribute('open'));
	const target = dialog.querySelector<HTMLSelectElement>('#trade-target')!;
	assert.equal(target.options.length, 1);
	assert.equal(target.options[0].value, 'B');

	// My give side lists my four tradeable squares as checkboxes.
	const giveChecks = dialog.querySelectorAll('.trade-give-props input.trade-prop-check');
	assert.equal(giveChecks.length, 4);
});

test('refreshBuilder tracks the partner\'s live cash so the request-money cap grows on a mortgage', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 1 };
	let bobMoney = 800;
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({
		myPlayer, others: [bob], squares: board(),
		getPlayers: () => [myPlayer, { ...bob, money: bobMoney }], // live view of the partner
		onPropose: () => {},
	});

	const reqMoney = document.querySelector<HTMLInputElement>('#trade-req-money')!;
	assert.equal(reqMoney.max, '800', 'the request-money cap starts at the partner\'s cash');

	bobMoney = 1300; // the partner mortgaged something for cash mid-build
	tradeDialog.refreshBuilder();
	assert.equal(reqMoney.max, '1300', 'the cap tracks the live balance');
});

test('openBuilder collects the selection and invokes onPropose', () => {
	let received: any = null;
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 1 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({
		myPlayer, others: [bob], squares: board(),
		onPropose: (targetId, offered, requested) => { received = { targetId, offered, requested }; }
	});

	const dialog = document.getElementById('trade-dialog')!;
	(dialog.querySelector('#trade-give-prop-1') as HTMLInputElement).checked = true;
	(dialog.querySelector('#trade-give-money') as HTMLInputElement).value = '300';
	(dialog.querySelector('.trade-propose-btn') as HTMLButtonElement).click();

	assert.ok(received);
	assert.equal(received.targetId, 'B');
	assert.deepEqual(received.offered.properties, [1]);
	assert.equal(received.offered.money, 300);
});

test('openBuilder honours preselectedTargetId', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 1 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };
	const cas = { id: 'C', name: 'Cas', token: 'dog' as any, position: 0, money: 500, properties: [], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob, cas], squares: board(), preselectedTargetId: 'C', onPropose: () => {} });

	const target = document.querySelector<HTMLSelectElement>('#trade-target')!;
	assert.equal(target.value, 'C');
});

test('openBuilder ignores an unknown preselectedTargetId', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 1 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), preselectedTargetId: 'ZZ', onPropose: () => {} });

	const target = document.querySelector<HTMLSelectElement>('#trade-target')!;
	assert.equal(target.value, 'B'); // falls back to the first partner
});

test('the give property list is a single tab stop navigated with the arrow keys', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 1 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), onPropose: () => {} });

	const dialog = document.getElementById('trade-dialog')!;
	const checks = Array.from(dialog.querySelectorAll<HTMLInputElement>('.trade-give-props input.trade-prop-check'));
	assert.equal(checks.length, 4);
	// Exactly one tab stop across the whole list.
	assert.equal(checks.filter(c => c.tabIndex === 0).length, 1);
	assert.equal(checks[0].tabIndex, 0);

	// Arrow Down moves focus and the single tab stop to the next checkbox.
	checks[0].focus();
	checks[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
	assert.equal(document.activeElement, checks[1]);
	assert.equal(checks[1].tabIndex, 0);
	assert.equal(checks[0].tabIndex, -1);

	// Arrow Up returns to the first checkbox.
	checks[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
	assert.equal(document.activeElement, checks[0]);
});

test('the property checkboxes live in a real ul/li list so a reader can count them', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 1 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), onPropose: () => {} });

	const dialog = document.getElementById('trade-dialog')!;
	const list = dialog.querySelector('ul.trade-give-props')!;
	assert.ok(list, 'give side renders a <ul> list');
	// The list carries an aria-label so the reader names it without an extra group/legend.
	assert.equal(list.getAttribute('aria-label'), 'Properties');
	const items = list.querySelectorAll(':scope > li.trade-prop-row');
	assert.equal(items.length, 4); // one <li> per tradeable property
	// Each <li> hosts exactly one checkbox.
	assert.equal(list.querySelectorAll('li.trade-prop-row input.trade-prop-check').length, 4);
});

test('the monetary valuation is focusable so a reader can revisit it', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), onPropose: () => {} });

	const val = document.querySelector<HTMLElement>('.trade-valuation')!;
	assert.equal(val.tabIndex, 0);
	val.focus();
	assert.equal(document.activeElement, val);
});

test('the monetary valuation mirrors its text into aria-label so a focused reader voices it', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), onPropose: () => {} });

	const dialog = document.getElementById('trade-dialog')!;
	const val = dialog.querySelector<HTMLElement>('.trade-valuation')!;
	// role="status" exposes no accessible name on focus, so Tabbing onto this tab stop would read
	// nothing. The text is mirrored into aria-label so the focused line voices the full verdict.
	assert.ok((val.getAttribute('aria-label') ?? '').length > 0, 'has an aria-label');
	assert.equal(val.getAttribute('aria-label'), val.textContent);

	// ...and it stays in sync when the deal changes (so a re-focus reads the new verdict).
	const giveMoney = dialog.querySelector<HTMLInputElement>('#trade-give-money')!;
	giveMoney.value = '300';
	giveMoney.dispatchEvent(new window.Event('input', { bubbles: true }));
	assert.equal(val.getAttribute('aria-label'), val.textContent);
	assert.match(val.getAttribute('aria-label')!, /300/);
});

test('the builder shows a live monetary valuation that updates with the selection', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), onPropose: () => {} });

	const dialog = document.getElementById('trade-dialog')!;
	const val = dialog.querySelector<HTMLElement>('.trade-valuation')!;
	// Nothing on either side yet -> the deal reads as balanced.
	assert.match(val.textContent!, /balanced/i);

	// Offering 300€ with nothing in return makes it unfavorable for the proposer.
	const giveMoney = dialog.querySelector<HTMLInputElement>('#trade-give-money')!;
	giveMoney.value = '300';
	giveMoney.dispatchEvent(new window.Event('input', { bubbles: true }));
	assert.match(val.textContent!, /300/);
	assert.match(val.textContent!, /behind/i);
});

test('the monetary valuation is an aria-live region so changes are announced (not just re-readable)', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), onPropose: () => {} });

	const val = document.querySelector<HTMLElement>('.trade-valuation')!;
	// A live status region: the screen reader voices each recomputed verdict even while focus
	// stays on the input being edited (the whole sentence, thanks to aria-atomic).
	assert.equal(val.getAttribute('role'), 'status');
	assert.equal(val.getAttribute('aria-live'), 'polite');
	assert.equal(val.getAttribute('aria-atomic'), 'true');
});

test('the builder shows a plain-language give/receive summary that tracks the selection (bug #5)', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), onPropose: () => {} });

	const dialog = document.getElementById('trade-dialog')!;
	const giveSummary = dialog.querySelector<HTMLElement>('.trade-summary-give')!;
	const receiveSummary = dialog.querySelector<HTMLElement>('.trade-summary-receive')!;

	// Focusable, on-demand summary lines (deliberately NOT live regions, so they don't double-
	// announce with the valuation on every keystroke), each carrying the full sentence in
	// aria-label so a reader can revisit "what I give / receive" without re-scanning checkboxes.
	assert.equal(giveSummary.tabIndex, 0);
	assert.equal(receiveSummary.tabIndex, 0);
	assert.equal(giveSummary.getAttribute('aria-live'), null);

	// Nothing selected yet: both sides read "nothing".
	assert.match(giveSummary.textContent!, /You give:/);
	assert.match(giveSummary.textContent!, /nothing/i);
	assert.match(receiveSummary.textContent!, /You receive:/);

	// Check Brown 1 and offer 300 cash: the give summary enumerates them as one flowing sentence.
	const brown1 = dialog.querySelector('#trade-give-prop-1') as HTMLInputElement;
	brown1.checked = true;
	brown1.dispatchEvent(new window.Event('change', { bubbles: true }));
	const giveMoney = dialog.querySelector<HTMLInputElement>('#trade-give-money')!;
	giveMoney.value = '300';
	giveMoney.dispatchEvent(new window.Event('input', { bubbles: true }));

	assert.match(giveSummary.textContent!, /Brown 1/);
	assert.match(giveSummary.textContent!, /300/);
	// aria-label mirrors the visible text so the focused line voices the current deal.
	assert.equal(giveSummary.getAttribute('aria-label'), giveSummary.textContent);
});

test('the native trade dialog contains a named application surface for its keyboard model', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1, 2, 4, 5], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), onPropose: () => {} });

	const dialog = document.getElementById('trade-dialog')!;
	assert.equal(dialog.tagName, 'DIALOG');
	assert.equal(dialog.getAttribute('role'), null);
	const application = dialog.querySelector<HTMLElement>('.trade-application')!;
	assert.equal(application.getAttribute('role'), 'application');
	assert.equal(application.getAttribute('aria-labelledby'), 'trade-dialog-title');
});

test('openReview wires accept and decline buttons', () => {
	let accepted = false, declined = false;
	const offered: TradeSideDto = { properties: [{ index: 1, name: 'Brown 1' }], money: 0, releasePasses: 0 };
	const requested: TradeSideDto = { properties: [], money: 200, releasePasses: 0 };

	tradeDialog.openReview({
		initiatorName: 'Ann', offered, requested, squares: board(),
		onAccept: () => { accepted = true; },
		onDecline: () => { declined = true; }
	});

	const dialog = document.getElementById('trade-dialog')!;
	assert.ok(dialog.hasAttribute('open'));
	(dialog.querySelector('.trade-decline-btn') as HTMLButtonElement).click();
	assert.equal(declined, true);
	assert.equal(accepted, false);
});

test('declining closes the review dialog immediately rather than waiting for the server (bug 11)', () => {
	const offered: TradeSideDto = { properties: [{ index: 1, name: 'Brown 1' }], money: 0, releasePasses: 0 };
	const requested: TradeSideDto = { properties: [], money: 200, releasePasses: 0 };

	tradeDialog.openReview({
		initiatorName: 'Ann', offered, requested, squares: board(),
		onAccept: () => {}, onDecline: () => {}
	});

	const dialog = document.getElementById('trade-dialog')!;
	assert.ok(dialog.hasAttribute('open'));
	(dialog.querySelector('.trade-decline-btn') as HTMLButtonElement).click();
	// The modal is gone the moment the user declines — no lingering trapped focus.
	assert.equal(tradeDialog.isOpen(), false);
});

test('Enter on a review line (not a button) activates the default Accept button (bug #11)', () => {
	let accepted = 0;
	const offered: TradeSideDto = { properties: [{ index: 1, name: 'Brown 1' }], money: 0, releasePasses: 0 };
	const requested: TradeSideDto = { properties: [], money: 200, releasePasses: 0 };

	tradeDialog.openReview({
		initiatorName: 'Ann', offered, requested, squares: board(),
		onAccept: () => { accepted++; }, onDecline: () => {}
	});

	const dialog = document.getElementById('trade-dialog')!;
	const line = dialog.querySelector('.trade-review-line') as HTMLElement;
	line.focus();
	line.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	assert.equal(accepted, 1, 'Enter anywhere in the dialog fires the primary button');
});

test('a tradeable property reads its colour and price in the builder (bug 12)', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [], releasePasses: 0 };
	// A single brown property carrying a price.
	const squares: Square[] = [
		sq(0, { type: 'go', name: 'Go' }),
		sq(1, { type: 'property', name: 'Brown 1', color: 'brown', ownerId: 'A', price: 60 }),
	];

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares, onPropose: () => {} });

	const dialog = document.getElementById('trade-dialog')!;
	const label = dialog.querySelector('label[for="trade-give-prop-1"]')!;
	assert.equal(label.textContent, 'Brown 1. Brown. 60\u20ac');
});

test('openReview exposes the offer lines as focusable, labelled stops', async () => {
	const offered: TradeSideDto = { properties: [{ index: 1, name: 'Brown 1' }], money: 0, releasePasses: 0 };
	const requested: TradeSideDto = { properties: [], money: 200, releasePasses: 0 };

	tradeDialog.openReview({
		initiatorName: 'Ann', offered, requested, squares: board(),
		onAccept: () => {}, onDecline: () => {}
	});

	const lines = Array.from(document.querySelectorAll('.trade-review-line')) as HTMLElement[];
	assert.equal(lines.length, 3); // receive, give, and the valuation verdict
	// Each line is a Tab stop carrying the full phrase as its accessible name (so a
	// screen reader voices it under role="application", where browse mode is off).
	for (const line of lines) {
		assert.equal(line.getAttribute('tabindex'), '0');
		assert.ok((line.getAttribute('aria-label') ?? '').length > 0);
	}
	assert.ok(lines[0].getAttribute('aria-label')!.includes('Brown 1'));
	assert.ok(lines[1].getAttribute('aria-label')!.includes('200'));
	// Opening lands on the first offer line, not a button (focus is async via setTimeout).
	await new Promise(resolve => setTimeout(resolve, 70));
	assert.equal(document.activeElement, lines[0]);
});

test('openReview prefixes each property with its colour-group swatch (bug: trade colour)', () => {
	const offered: TradeSideDto = { properties: [{ index: 1, name: 'Brown 1', color: 'brown' }], money: 0, releasePasses: 0 };
	const requested: TradeSideDto = { properties: [{ index: 4, name: 'Light 1', color: 'Light Blue' }], money: 0, releasePasses: 0 };

	tradeDialog.openReview({
		initiatorName: 'Ann', offered, requested, squares: board(),
		onAccept: () => {}, onDecline: () => {}
	});

	const swatches = Array.from(document.querySelectorAll('.trade-review-line .trade-prop-swatch')) as HTMLElement[];
	assert.equal(swatches.length, 2);
	assert.ok(swatches[0].classList.contains('group-brown'));
	assert.ok(swatches[1].classList.contains('group-lightblue'));
	// Purely visual: hidden from assistive tech (the aria-label carries the name).
	for (const s of swatches) assert.equal(s.getAttribute('aria-hidden'), 'true');
});

test('openBuilder shows a colour-group swatch next to each tradeable property', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [], releasePasses: 0 };
	const squares: Square[] = [
		sq(0, { type: 'go', name: 'Go' }),
		sq(1, { type: 'property', name: 'Brown 1', color: 'brown', ownerId: 'A', price: 60 }),
	];

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares, onPropose: () => {} });

	const dialog = document.getElementById('trade-dialog')!;
	const swatch = dialog.querySelector('.trade-give-props .trade-prop-swatch') as HTMLElement;
	assert.ok(swatch);
	assert.ok(swatch.classList.contains('group-brown'));
	assert.equal(swatch.getAttribute('aria-hidden'), 'true');
});

test('openWaiting wires the cancel button and close() dismisses the modal', () => {
	let cancelled = false;
	tradeDialog.openWaiting({ targetName: 'Bob', onCancel: () => { cancelled = true; } });

	const dialog = document.getElementById('trade-dialog')!;
	assert.ok(dialog.hasAttribute('open'));
	(dialog.querySelector('.trade-cancel-btn') as HTMLButtonElement).click();
	assert.equal(cancelled, true);

	tradeDialog.close();
	assert.ok(!dialog.hasAttribute('open'));
});

// === Floating review/waiting: the decision needs the board ===

test('the review dialog floats (non-modal): the board stays reachable while deciding', () => {
	const offered: TradeSideDto = { properties: [{ index: 1, name: 'Brown 1' }], money: 0, releasePasses: 0 };
	const requested: TradeSideDto = { properties: [], money: 200, releasePasses: 0 };

	tradeDialog.openReview({
		initiatorName: 'Ann', offered, requested, squares: board(),
		onAccept: () => {}, onDecline: () => {}
	});

	const dialog = document.getElementById('trade-dialog') as HTMLDialogElement;
	assert.ok(dialog.open);
	// data-modal="false" is the contract the keyboard layer, CSS and panel navigation
	// read: the dialog is one more panel, not a focus trap.
	assert.equal(dialog.dataset.modal, 'false');
	// And it is draggable by its title, so it can be moved off the board.
	assert.ok(dialog.classList.contains('dialog--draggable'));
	tradeDialog.close();
});

test('the waiting dialog floats too: proposing does not lock you out of the board', () => {
	tradeDialog.openWaiting({ targetName: 'Bob', onCancel: () => {} });

	const dialog = document.getElementById('trade-dialog') as HTMLDialogElement;
	assert.ok(dialog.open);
	assert.equal(dialog.dataset.modal, 'false');
	tradeDialog.close();
});

test('the trade BUILDER stays modal (an editing surface, not a floating panel)', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), onPropose: () => {} });

	const dialog = document.getElementById('trade-dialog') as HTMLDialogElement;
	assert.equal(dialog.dataset.modal, 'true');
	tradeDialog.close();
});

// === Live-play 2026-07-12: the review must say the GROUP and the net verdict ===

test('tradePropertyLabel includes the colour group when known (live-play: "which group is it?")', () => {
	const fmt = (v: number) => `${v}₡`;
	// color path (EN fake i18next: localizeColor('brown') -> 'Brown')
	assert.equal(
		tradePropertyLabel({ index: 1, name: 'Brown 1', color: 'brown', price: 60 }, fmt),
		'Brown 1 (Brown, 60₡)');
	// no price, group only
	assert.equal(
		tradePropertyLabel({ index: 1, name: 'Brown 1', color: 'brown' }, fmt),
		'Brown 1 (Brown)');
});

test('tradeReviewValuationText judges from the TARGET side: receive = offered', () => {
	const tr = (k: string, v?: any) =>
		k === 'trade_valuation_summary' ? `give ${v.give} get ${v.receive}: ${v.verdict}` : k;
	const squares: Square[] = [sq(0, {}), sq(1, { price: 300 })];
	const offered: TradeSideDto = { properties: [{ index: 1, name: 'P', price: 300 }], money: 0, releasePasses: 0 };
	const requested: TradeSideDto = { properties: [], money: 50, releasePasses: 0 };
	// The target receives a 300 lot and gives 50 cash: clearly favorable for them.
	assert.equal(tradeReviewValuationText(squares, offered, requested, tr),
		'give 50 get 300: trade_verdict_favorable');
});

test('openReview shows a focusable valuation line with the verdict (live-play: win or lose?)', () => {
	const squares: Square[] = [sq(0, {}), sq(1, { price: 300 })];
	const offered: TradeSideDto = { properties: [{ index: 1, name: 'Brown 1', price: 300 }], money: 0, releasePasses: 0 };
	const requested: TradeSideDto = { properties: [], money: 50, releasePasses: 0 };

	tradeDialog.openReview({
		initiatorName: 'Ann', offered, requested, squares,
		onAccept: () => {}, onDecline: () => {}
	});

	const val = document.querySelector<HTMLElement>('.trade-review-content .trade-valuation')!;
	assert.ok(val, 'the review renders the valuation line');
	assert.equal(val.getAttribute('tabindex'), '0');
	// EN locale: receiving 300 for 50 reads as coming out ahead.
	assert.match(val.textContent!, /ahead/i);
	assert.equal(val.getAttribute('aria-label'), val.textContent);
});

test('openReview values a mortgaged lot at half its price in the verdict', () => {
	const squares: Square[] = [sq(0, {}), sq(1, { price: 300, mortgaged: true })];
	const offered: TradeSideDto = { properties: [{ index: 1, name: 'Brown 1', price: 300 }], money: 0, releasePasses: 0 };
	const requested: TradeSideDto = { properties: [], money: 150, releasePasses: 0 };

	tradeDialog.openReview({
		initiatorName: 'Ann', offered, requested, squares,
		onAccept: () => {}, onDecline: () => {}
	});

	// 150 (mortgage value) received vs 150 given: balanced, NOT ahead — the local board
	// squares (mortgage-aware) drive the estimate, not the DTO's face price.
	const val = document.querySelector<HTMLElement>('.trade-review-content .trade-valuation')!;
	assert.match(val.textContent!, /balanced/i);
});

// === Live-play 2026-07-12: no silent clamping — an over-cap amount blocks the proposal ===

test('amountInputIssue: usable, over-cap and malformed values', () => {
	assert.equal(amountInputIssue('0', 100), null);
	assert.equal(amountInputIssue('100', 100), null);
	assert.equal(amountInputIssue('', 100), null);      // empty while editing = 0
	assert.equal(amountInputIssue('  ', 100), null);
	assert.equal(amountInputIssue('101', 100), 'over');
	assert.equal(amountInputIssue('9999', 21), 'over'); // Eric's case
	assert.equal(amountInputIssue('-5', 100), 'invalid');
	assert.equal(amountInputIssue('1.5', 100), 'invalid');
	assert.equal(amountInputIssue('abc', 100), 'invalid');
});

test('asking for more money than the partner HAS shows an error and refuses to propose', () => {
	let proposed: any = null;
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 21, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({
		myPlayer, others: [bob], squares: board(),
		onPropose: (targetId, offered, requested) => { proposed = { targetId, offered, requested }; }
	});

	const dialog = document.getElementById('trade-dialog')!;
	const reqMoney = dialog.querySelector<HTMLInputElement>('#trade-req-money')!;
	reqMoney.value = '100'; // Bob only has 21
	reqMoney.dispatchEvent(new window.Event('input', { bubbles: true }));

	// The inline error names the partner and his real cash, and the input is flagged.
	const error = dialog.querySelector<HTMLElement>('#trade-req-money-error')!;
	assert.equal(error.hidden, false);
	assert.match(error.textContent!, /Bob only has 21/);
	assert.equal(reqMoney.getAttribute('aria-invalid'), 'true');
	assert.equal(reqMoney.getAttribute('aria-describedby'), 'trade-req-money-error');
	assert.ok(reqMoney.classList.contains('trade-input-invalid'));

	// Propose is REFUSED (nothing sent, nothing silently clamped) and focus lands on the input.
	(dialog.querySelector('.trade-propose-btn') as HTMLButtonElement).click();
	assert.equal(proposed, null, 'the trade must not go out clamped');
	assert.equal(document.activeElement, reqMoney);

	// Correcting the amount clears the error and the proposal goes out with the REAL value.
	reqMoney.value = '21';
	reqMoney.dispatchEvent(new window.Event('input', { bubbles: true }));
	assert.equal(error.hidden, true);
	assert.equal(reqMoney.getAttribute('aria-invalid'), null);
	(dialog.querySelector('.trade-propose-btn') as HTMLButtonElement).click();
	assert.ok(proposed);
	assert.equal(proposed.requested.money, 21);
});

test('offering more money than I have blocks the proposal too', () => {
	let proposed = false;
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 200, properties: [1], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob], squares: board(), onPropose: () => { proposed = true; } });

	const dialog = document.getElementById('trade-dialog')!;
	const giveMoney = dialog.querySelector<HTMLInputElement>('#trade-give-money')!;
	giveMoney.value = '500'; // I only have 200
	giveMoney.dispatchEvent(new window.Event('input', { bubbles: true }));

	const error = dialog.querySelector<HTMLElement>('#trade-give-money-error')!;
	assert.equal(error.hidden, false);
	assert.match(error.textContent!, /You only have 200/);
	(dialog.querySelector('.trade-propose-btn') as HTMLButtonElement).click();
	assert.equal(proposed, false);
});

test('switching partners re-checks the requested amount against the NEW cap', () => {
	const myPlayer = { id: 'A', name: 'Ann', token: 'car' as any, position: 0, money: 1500, properties: [1], releasePasses: 0 };
	const bob = { id: 'B', name: 'Bob', token: 'hat' as any, position: 0, money: 800, properties: [6], releasePasses: 0 };
	const cas = { id: 'C', name: 'Cas', token: 'dog' as any, position: 0, money: 50, properties: [], releasePasses: 0 };

	tradeDialog.openBuilder({ myPlayer, others: [bob, cas], squares: board(), onPropose: () => {} });

	const dialog = document.getElementById('trade-dialog')!;
	const reqMoney = dialog.querySelector<HTMLInputElement>('#trade-req-money')!;
	const error = dialog.querySelector<HTMLElement>('#trade-req-money-error')!;
	reqMoney.value = '500'; // fine for Bob (800)
	reqMoney.dispatchEvent(new window.Event('input', { bubbles: true }));
	assert.equal(error.hidden, true);

	// Switch to Cas (50): the same 500 is now over HIS cap and the error names him.
	const target = dialog.querySelector<HTMLSelectElement>('#trade-target')!;
	target.value = 'C';
	target.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.equal(error.hidden, false);
	assert.match(error.textContent!, /Cas only has 50/);
});
