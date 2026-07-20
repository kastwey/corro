import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { SheddingBoard, type SheddingBoardDeps } from '../src/sheddingBoard.js';
import { dialogManager } from '../src/dialogManager.js';
import type { GameState, SheddingSeatState } from '../src/models.js';

/**
 * The shedding surface: the hand renders my projected seat with server-mirrored
 * playability, Enter plays (wilds walk the colour picker), Space draws — and, mid
 * drawn-card pause, Space KEEPS while Enter plays the drawn card. S speaks my status,
 * Shift+S the rivals' counts and scores (the on-demand answer that replaces the classic
 * shout). The table region stays aria-hidden.
 */

before(() => setupDom());

const DECK = [
	{ id: 'red-5', type: 'number', color: 'red', value: 5, count: 2, nameKey: 'c.red5', svg: 'M5 5h54v54z' },
	{ id: 'red-7', type: 'number', color: 'red', value: 7, count: 2, nameKey: 'c.red7' },
	{ id: 'blue-7', type: 'number', color: 'blue', value: 7, count: 2, nameKey: 'c.blue7' },
	{ id: 'wild', type: 'wild', count: 2, nameKey: 'c.wild' },
	{ id: 'skip', type: 'skip', color: 'blue', count: 2, nameKey: 'c.skip' },
];

const inst = (cardId: string, n = 0) => ({ instanceId: `${cardId}@${n}`, cardId });

function seat(id: string, hand: string[] = [], over: Partial<SheddingSeatState> = {}): SheddingSeatState {
	return {
		playerId: id, hand: hand.map(inst), handCount: hand.length,
		score: 0, roundScores: [], ...over,
	};
}

let gs: GameState;
let boardEl: HTMLElement;
let view: SheddingBoard;
let played: Array<[string, string | null]>;
let drawn: number;
let kept: number;
let declared: number;
let caught: number;
let announced: string[];

function game(seats: SheddingSeatState[]): GameState {
	return {
		gameType: 'shedding',
		shedding: {
			round: 1, seats, drawPile: [], drawCount: 60,
			discardPile: [inst('red-5', 9)], discardCount: 1,
			currentColor: 'red', direction: 1,
		},
		sheddingDeck: DECK,
		sheddingRules: { handSize: 7, targetScore: 500, drawnCardPlayable: true, wildDrawRequiresNoMatch: true },
		players: seats.map(s => ({ id: s.playerId, name: `N-${s.playerId}`, color: '#e53935' })),
		bank: { money: 0 }, currentTurn: 'me', ownership: [], squares: [],
	} as unknown as GameState;
}

const t = (key: string, vars?: Record<string, unknown>) =>
	vars && Object.keys(vars).length ? `${key}(${Object.values(vars).join('|')})` : key;

function key(target: EventTarget, keyName: string, opts: Record<string, unknown> = {}): void {
	const w = (globalThis as any).window;
	target.dispatchEvent(new w.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...opts }));
}

function rows(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('.hand-card:not(.hand-card--info)'));
}

beforeEach(() => {
	try { (globalThis as any).window.localStorage.removeItem('corro.handPreferences'); } catch {}
	document.body.innerHTML = '<div id="board"></div>';
	boardEl = document.getElementById('board')!;
	played = []; announced = []; drawn = 0; kept = 0; declared = 0; caught = 0;
	gs = game([
		seat('me', ['red-7', 'blue-7', 'wild']),
		seat('r1', [], { handCount: 1, score: 240 }),
	]);
	const deps: SheddingBoardDeps = {
		getGameState: () => gs,
		getMyPlayerId: () => 'me',
		announce: text => announced.push(text),
		tSync: t,
		onIdle: () => {},
		motionDisabled: () => true,
		commands: {
			play: (id, color) => played.push([id, color ?? null]),
			draw: () => { drawn++; },
			keep: () => { kept++; },
			declareLastCard: () => { declared++; },
			catchLastCard: () => { caught++; },
		},
	};
	view = new SheddingBoard(boardEl, deps);
	view.update(gs);
});

test('the hand mirrors the server: colour match plays, a mismatch refuses ALOUD', () => {
	// Value sort: numbers by value desc, actions weight 10 — wild(10) then red-7, blue-7.
	const red7 = rows().find(r => r.getAttribute('aria-label')!.startsWith('c.red7'))!;
	red7.focus();
	key(red7, 'Enter');
	assert.deepEqual(played, [['red-7@0', null]]);

	const blue7 = rows().find(r => r.getAttribute('aria-label')!.includes('c.blue7'))!;
	assert.ok(blue7.getAttribute('aria-label')!.includes('game.hand_unplayable_tag'));
	assert.ok(red7.querySelector('[data-card-art="neutral"]'));
});

test('a wild walks the colour picker and the pick carries the colour', () => {
	const wild = rows().find(r => r.getAttribute('aria-label')!.startsWith('c.wild'))!;
	wild.focus();
	key(wild, 'Enter');

	const menu = document.querySelector('[role="menu"]');
	assert.ok(menu, 'the colour picker opened');
	const items = Array.from(menu!.querySelectorAll<HTMLElement>('[role="menuitem"]'));
	assert.deepEqual(items.map(i => i.textContent), ['colors.red', 'colors.blue']);
	items[1].click();
	assert.deepEqual(played, [['wild@2', 'blue']]);
});

test('Space draws on my turn — and KEEPS mid drawn-card pause; the drawn card leads', () => {
	rows()[0].focus();
	key(rows()[0], ' ');
	assert.equal(drawn, 1);

	// The server pauses on the drawn card: it announces itself in the hand…
	gs.shedding!.seats[0].hand.push(inst('red-5', 1));
	gs.shedding!.seats[0].handCount = 4;
	gs.shedding!.pendingDrawnPlay = { playerId: 'me', instanceId: 'red-5@1' };
	view.update(gs);
	const drawnRow = rows().find(r => r.getAttribute('aria-label')!.startsWith('game.shedding_card_drawn'))!;
	assert.ok(drawnRow);
	assert.ok(drawnRow.querySelector('[data-card-art="package"]'));
	// …the REST of the hand refuses with the pause's reason…
	const red7 = rows().find(r => r.getAttribute('aria-label')!.startsWith('c.red7'))!;
	assert.ok(red7.getAttribute('aria-label')!.includes('game.hand_unplayable_tag'));
	// …and Space now KEEPS instead of drawing again.
	key(drawnRow, ' ');
	assert.equal(kept, 1);
	assert.equal(drawn, 1);
});

test('off-turn everything refuses aloud', () => {
	gs.currentTurn = 'r1';
	view.update(gs);
	rows()[0].focus();
	key(rows()[0], 'Enter');
	key(rows()[0], ' ');
	assert.deepEqual(played, []);
	assert.equal(drawn, 0);
	assert.ok(announced.some(a => a === 'game.shedding_not_your_turn'));
});

test('S speaks MY status; Shift+S the rivals: counts and scores on demand', () => {
	key(boardEl, 's');
	assert.ok(announced[0].includes('game.shedding_status_top(c.red5|colors.red)'));

	key(boardEl, 'S', { shiftKey: true });
	assert.equal(announced[1], 'N-r1: game.shedding_status_cards_one, game.shedding_status_score(240)');
});

test('helpShortcuts reports the REAL wiring: Enter/Space + S/Shift+S, no discard', () => {
	// The single source for the help dialog — derived from what the hand actually wired
	// (play + draw, no discard in this genre) plus the shared status keys. The active-rules
	// dialog is the GLOBAL Ctrl+Shift+F1 command (keymap.json), not a board key.
	assert.deepEqual(view.helpShortcuts(), [
		{ keys: 'enter', descKey: 'game.help_cmd_play_card' },
		{ keys: 'space', descKey: 'game.help_cmd_shedding_draw' },
		{ keys: 'shift+f1', descKey: 'game.help_cmd_card_help' },
		{ keys: 's', descKey: 'game.help_cmd_status_mine' },
		{ keys: 'shift+s', descKey: 'game.help_cmd_status_rivals' },
		{ keys: 'c', descKey: 'game.help_cmd_shedding_top' },
		{ keys: 'r / g / b / y', descKey: 'game.help_cmd_shedding_colour_jump' },
		{ keys: 'shift + r / g / b / y', descKey: 'game.help_cmd_shedding_colour_jump_back' },
		{ keys: '0 – 9', descKey: 'game.help_cmd_shedding_number_jump' },
		{ keys: 'shift + 0 – 9', descKey: 'game.help_cmd_shedding_number_jump_back' },
		{ keys: 'i', descKey: 'game.help_cmd_shedding_special_jump' },
		{ keys: 'shift + i', descKey: 'game.help_cmd_shedding_special_jump_back' },
	]);
});

test('C reads just the top card and the colour in force (not the whole status)', () => {
	// The beforeEach board has red-5 on top, red in force. C announces only that.
	key(boardEl, 'c');
	const line = announced.at(-1) ?? '';
	assert.ok(line.startsWith('game.shedding_status_top'), 'the top-card line, on its own');
	assert.ok(!line.includes('shedding_status_score'), 'not the hand/score bundle S reads');
});

test('R/G/B/Y jump hand focus to the next card of that colour; wilds match nothing', () => {
	// Value order: wild(10), red-7, blue-7. Start on the wild; B then R walk the colours.
	rows()[0].focus();
	key(boardEl, 'b');
	assert.ok((document.activeElement as HTMLElement).getAttribute('aria-label')!.includes('blue7'),
		'B landed on the blue card');
	key(boardEl, 'r');
	assert.ok((document.activeElement as HTMLElement).getAttribute('aria-label')!.includes('red7'),
		'R landed on the red card');
	// G/Y are not colours this deck plays: the keys are inert (no jump, no speech).
	const before = document.activeElement;
	const n = announced.length;
	key(boardEl, 'g');
	assert.equal(document.activeElement, before);
	assert.equal(announced.length, n);
});

test('sort by colour follows the colour NAME in the current language, not deck order', () => {
	// The deck lists red before blue, but the localized names sort blue first
	// ("colors.blue" < "colors.red"); grouping must follow the NAME, so blue leads.
	(document.querySelector('.hand-panel__list-actions [data-focus-id="sort-colour"]') as HTMLButtonElement).click();
	const seq = rows().map(r => (r.getAttribute('aria-label')!.match(/red7|blue7|wild/) ?? [''])[0]);
	assert.deepEqual(seq, ['blue7', 'red7', 'wild']);
});

test('Shift+colour walks BACKWARD through that colour; the plain key walks forward', () => {
	// Value order: blue-7, red-7, red-5. Two reds, so the direction is observable.
	gs = game([seat('me', ['red-5', 'blue-7', 'red-7']), seat('r1', [], { handCount: 1 })]);
	view.update(gs);
	const label = () => (document.activeElement as HTMLElement).getAttribute('aria-label') ?? '';
	rows().find(r => r.getAttribute('aria-label')!.includes('blue7'))!.focus();
	key(boardEl, 'r');                     // forward → first red (red-7)
	assert.ok(label().includes('red7'), 'R landed on the first red');
	key(boardEl, 'r');                     // forward → next red (red-5)
	assert.ok(label().includes('red5'), 'R advanced to the next red');
	key(boardEl, 'R', { shiftKey: true }); // backward → previous red (red-7)
	assert.ok(label().includes('red7'), 'Shift+R stepped back to the previous red');
});

test('digit keys jump to the next card with that number; Shift+ goes back; missing says so', () => {
	// Value order: wild, red-7, blue-7, red-5. Two 7s make the direction observable.
	gs = game([seat('me', ['red-5', 'red-7', 'blue-7', 'wild']), seat('r1', [], { handCount: 1 })]);
	view.update(gs);
	const label = () => (document.activeElement as HTMLElement).getAttribute('aria-label') ?? '';
	rows().find(r => r.getAttribute('aria-label')!.includes('wild'))!.focus();
	key(boardEl, '7', { code: 'Digit7' });                  // → first 7 (red-7)
	assert.ok(label().includes('red7'), 'landed on a 7');
	key(boardEl, '7', { code: 'Digit7' });                  // → next 7 (blue-7)
	assert.ok(label().includes('blue7'), 'advanced to the other 7');
	key(boardEl, '7', { code: 'Digit7', shiftKey: true });  // back → red-7 (Shift+7 via e.code, not "/")
	assert.ok(label().includes('red7'), 'Shift+7 stepped back');
	key(boardEl, '3', { code: 'Digit3' });                  // no 3 in hand
	assert.equal(announced.at(-1), 'game.shedding_no_number_cards(3)');
});

test('I jumps through the SPECIAL (non-number) cards; Shift+I back; none says so', () => {
	// Value order: wild, skip, red-7. Two specials make the direction observable.
	gs = game([seat('me', ['red-7', 'wild', 'skip']), seat('r1', [], { handCount: 1 })]);
	view.update(gs);
	const label = () => (document.activeElement as HTMLElement).getAttribute('aria-label') ?? '';
	rows().find(r => r.getAttribute('aria-label')!.includes('red7'))!.focus();
	key(boardEl, 'i');                      // → first special (wild)
	assert.ok(label().includes('wild'), 'landed on a special');
	key(boardEl, 'i');                      // → next special (skip)
	assert.ok(label().includes('skip'), 'advanced to the other special');
	key(boardEl, 'I', { shiftKey: true });  // back → wild
	assert.ok(label().includes('wild'), 'Shift+I stepped back');
	// A hand of only numbers: I says there are none.
	gs = game([seat('me', ['red-5', 'red-7']), seat('r1', [], { handCount: 1 })]);
	view.update(gs);
	rows()[0].focus();
	key(boardEl, 'i');
	assert.equal(announced.at(-1), 'game.shedding_no_special_cards');
});

test('a deck colour with no card in your hand is announced by name, focus unmoved', () => {
	gs = game([seat('me', ['red-7', 'wild']), seat('r1', [], { handCount: 1 })]);
	view.update(gs);
	rows()[0].focus();
	const before = document.activeElement;
	key(boardEl, 'b'); // blue is in the deck, just not in this hand
	assert.equal(announced.at(-1), 'game.shedding_no_colour_cards(colors.blue)');
	assert.equal(document.activeElement, before, 'focus stayed put');
});

test('the table is an aria-hidden echo: top card, colour, direction and counters', () => {
	const visual = boardEl.querySelector('.shedding-visual')!;
	assert.equal(visual.getAttribute('aria-hidden'), 'true');
	assert.ok(boardEl.querySelector('.shedding-discard .gcard__name')!.textContent!.includes('c.red5'));
	assert.ok(boardEl.querySelector('.shedding-discard [data-card-art="package"]'));
	assert.ok(boardEl.querySelector('.shedding-draw .gcard--back'));
	assert.ok(boardEl.querySelector('.hand-card--info .gcard--back'));
	assert.equal(boardEl.querySelector('.shedding-direction')!.textContent, '↻');
	const seats = boardEl.querySelectorAll('.shedding-seat');
	assert.equal(seats.length, 2);
	assert.ok(seats[0].classList.contains('shedding-seat--turn')); // me: the turn ring
	assert.equal((seats[0] as HTMLElement).style.getPropertyValue('--seat-ink'), '#000000');
	assert.equal((boardEl.querySelector('.shedding-discard') as HTMLElement).style.getPropertyValue('--in-force-ink'), '#000000');
});

// ── Doubles + the rules dialog (house-rule surfaces) ───────────────────────────

/** A board wired with the given rules, capturing plays WITH their extra copies. */
function boardWith(rules: Record<string, unknown>, hand: string[], seats?: SheddingSeatState[]) {
	document.body.innerHTML = '<div id="board2"></div>';
	const el = document.getElementById('board2')!;
	const plays: Array<{ id: string; color: string | null; extras: string[] }> = [];
	const calls = { declared: 0, caught: 0 };
	const said: string[] = [];
	const state = game(seats ?? [seat('me', hand), seat('r1', [], { handCount: 3 })]);
	(state as any).sheddingRules = { ...(state as any).sheddingRules, ...rules };
	const b = new SheddingBoard(el, {
		getGameState: () => state, getMyPlayerId: () => 'me',
		announce: t => said.push(t), tSync: t, onIdle: () => {}, motionDisabled: () => true,
		commands: {
			play: (id, color, extras) => plays.push({ id, color: color ?? null, extras: extras ?? [] }),
			draw: () => {}, keep: () => {},
			declareLastCard: () => { calls.declared++; }, catchLastCard: () => { calls.caught++; },
		},
	});
	b.update(state);
	return { el, view: b, plays, calls, said, state };
}

test('doubles OFF wires no multi-select', () => {
	// The default beforeEach board has doubles off.
	assert.ok(!view.helpShortcuts().some(s => s.keys === 'ctrl+space'), 'no multi-select without doubles');
});

test('rulesSummary reads the effective rules for the active-rules dialog', () => {
	const lines = view.rulesSummary();
	assert.ok(lines.some(l => l.startsWith('game.shedding_rules_hand_size')));
	assert.ok(lines.some(l => l.includes('game.shedding_rules_stacking')));
});

test('doubles ON: marking identical numbers and sending plays the lead with the copies', () => {
	const { el, view: dv, plays } = boardWith({ allowDoubles: true }, ['red-7', 'red-7']);
	// The hand opted into multi-select — the help reflects it.
	assert.ok(dv.helpShortcuts().some(s => s.keys === 'ctrl+space'));

	const cards = Array.from(el.querySelectorAll<HTMLElement>('.hand-card:not(.hand-card--info)'));
	assert.equal(cards.length, 2);
	cards[0].focus();
	key(cards[0], ' ', { ctrlKey: true }); // enter multi-select
	key(cards[0], ' ');                     // mark the first red-7
	key(cards[1], ' ');                     // mark the second
	key(cards[1], 'Enter');                 // send the set

	assert.equal(plays.length, 1);
	assert.equal(plays[0].id, 'red-7@0');
	assert.deepEqual(plays[0].extras, ['red-7@1']);
});

test('the Rules button opens the active-rules reading dialog', () => {
	const { el } = boardWith({ allowDoubles: true, stacking: 'cross' }, ['red-7']);
	// boardWith reset the body: drop the dialog singleton's stale cache, then init fresh.
	(dialogManager as any).dialog = null;
	(dialogManager as any).nonModalDialog = null;
	dialogManager.init();

	el.querySelector<HTMLButtonElement>('.shedding-rules-button')!.click();
	const dialog = document.querySelector('.dialog-game-rules');
	assert.ok(dialog, 'the rules dialog opened');
	const items = Array.from(dialog!.querySelectorAll('.game-rules-list li')).map(li => li.textContent);
	assert.ok(items.some(l => l!.includes('shedding_rules_doubles') && l!.includes('rules_on')));
	assert.ok(items.some(l => l!.includes('shedding_rules_stacking_cross')));
	dialogManager.close();
});

// ── Last-card declaration (house rule) ─────────────────────────────────────────

test('last-card rule ON: U/P/V route to declare/catch/watch, listed in the help, with buttons', () => {
	const { el, view: v, calls, said } = boardWith({ lastCardCall: true }, ['red-7']);

	const keys = v.helpShortcuts().map(s => s.keys);
	assert.ok(['u', 'p', 'v'].every(k => keys.includes(k)), 'U/P/V are in the shortcuts help');

	key(el, 'u'); assert.equal(calls.declared, 1, 'U declares');
	key(el, 'p'); assert.equal(calls.caught, 1, 'P catches');
	key(el, 'v'); assert.ok(said.some(t => t.includes('shedding_watch')), 'V reads the watch list');

	assert.ok(el.querySelector('.shedding-last-card-button'), 'last-card declaration button');
	assert.ok(el.querySelector('.shedding-catch-button'), 'Catch button');
	assert.ok(el.querySelector('.shedding-watch-button'), 'Watch button');
});

test('last-card rule OFF: no declaration keys or buttons', () => {
	const { el, view: v, calls } = boardWith({ lastCardCall: false }, ['red-7']);
	assert.ok(!v.helpShortcuts().some(s => ['u', 'p', 'v'].includes(s.keys)));
	key(el, 'u'); key(el, 'p');
	assert.equal(calls.declared + calls.caught, 0, 'the keys do nothing when the rule is off');
	assert.equal(el.querySelector('.shedding-last-card-button'), null);
});

test('the watch list reads rivals about to win, flagging the exposed (undeclared) one', () => {
	const seats = [
		seat('me', ['red-7']),
		seat('r1', [], { handCount: 1 }), // exposed (undeclared)
		seat('r2', [], { handCount: 2 }),
		seat('r3', [], { handCount: 5 }), // not close — excluded
	];
	const { el, said, state } = boardWith({ lastCardCall: true }, [], seats);
	state.shedding!.pendingLastCardCall = 'r1';

	key(el, 'v');
	const line = said.at(-1) ?? '';
	assert.ok(line.includes('shedding_watch_undeclared'), 'the exposed rival is flagged');
	assert.ok(line.includes('shedding_watch_cards'), 'the two-card rival is listed');
	assert.ok(!line.includes('N-r3'), 'a far-off rival is not listed');
});
