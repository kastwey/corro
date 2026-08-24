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
	// The rest of the family's types, so the hand orderings can be exercised over a full
	// spread of actions rather than one skip.
	{ id: 'red-0', type: 'number', color: 'red', value: 0, count: 1, nameKey: 'c.red0' },
	{ id: 'yellow-2', type: 'number', color: 'yellow', value: 2, count: 2, nameKey: 'c.yellow2' },
	{ id: 'skip-yellow', type: 'skip', color: 'yellow', count: 2, nameKey: 'c.skipYellow' },
	{ id: 'reverse-red', type: 'reverse', color: 'red', count: 2, nameKey: 'c.reverseRed' },
	{ id: 'draw2-red', type: 'drawTwo', color: 'red', count: 2, nameKey: 'c.draw2Red' },
	{ id: 'draw2-yellow', type: 'drawTwo', color: 'yellow', count: 2, nameKey: 'c.draw2Yellow' },
	{ id: 'wild-4', type: 'wildDrawFour', count: 1, nameKey: 'c.wild4' },
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
let played: [string, string | null][];
let drawn: number;
let kept: number;
let _declared: number;
let _caught: number;
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
	return Array.from(document.querySelectorAll<HTMLElement>('.hand-card'));
}

beforeEach(() => {
	// The family scopes its own sort preference, so BOTH keys have to go or a previous test's
	// choice would decide the next one's order.
	try {
		const store = (globalThis as any).window.localStorage;
		store.removeItem('corro.handPreferences');
		store.removeItem('corro.handPreferences.shedding');
	} catch { /* jsdom may ship no storage */ }
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
	// Every colour the DECK carries, in deck order — three since the deck grew a yellow suit.
	assert.deepEqual(items.map(i => i.textContent), ['colors.red', 'colors.blue', 'colors.yellow']);
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

// The engine's own queries survive an open modal dialog on purpose — keys.ts says so: "a blind
// player can check their situation without first dismissing the dialog". A card family's queries
// hang off the surface element, which a dialog takes the focus off, so they never did. It went
// unnoticed while C still answered through the engine, and showed the moment C stopped.
test('S, Shift+S and the table readouts still answer while a modal dialog holds the keyboard', () => {
	const dialog = document.createElement('dialog');
	dialog.setAttribute('open', '');
	dialog.dataset.modal = 'true';
	const content = document.createElement('div');
	content.tabIndex = 0;
	dialog.appendChild(content);
	document.body.appendChild(dialog);
	try {
		key(content, 's');
		assert.ok(announced.at(-1)?.includes('game.shedding_status_top(c.red5|colors.red)'),
			'my own status, from inside the dialog');

		key(content, 'S', { shiftKey: true });
		assert.ok(announced.at(-1)?.includes('game.shedding_status_score(240)'),
			'and the rivals');

		key(content, 'c');
		// Red on red: the colour in force is the card's own, so C reads it plain (see #9).
		assert.equal(announced.at(-1), 'game.shedding_top_readout_plain(c.red5)',
			'and the card on the table');
	} finally {
		dialog.remove();
	}
});

// The other half of the bargain: a dialog that is NOT modal never needed this — the surface still
// has the keyboard — and a key that ACTS must not reach a game whose player is looking at a yes/no
// they have not answered. Only the announcing handlers take the second route.
test('a key that acts stays out of an open dialog', () => {
	const dialog = document.createElement('dialog');
	dialog.setAttribute('open', '');
	dialog.dataset.modal = 'true';
	const content = document.createElement('div');
	content.tabIndex = 0;
	dialog.appendChild(content);
	document.body.appendChild(dialog);
	const before = played.length;
	try {
		key(content, 'Enter');
		assert.equal(played.length, before, 'Enter does not play a card from inside the dialog');
	} finally {
		dialog.remove();
	}
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
		{ keys: 'd', descKey: 'game.help_cmd_shedding_piles' },
		{ keys: 'c', descKey: 'game.help_cmd_shedding_top' },
		{ keys: 'r / g / b / y', descKey: 'game.help_cmd_shedding_colour_jump' },
		{ keys: 'shift + r / g / b / y', descKey: 'game.help_cmd_shedding_colour_jump_back' },
		{ keys: '0 – 9', descKey: 'game.help_cmd_shedding_number_jump' },
		{ keys: 'shift + 0 – 9', descKey: 'game.help_cmd_shedding_number_jump_back' },
		{ keys: 'i', descKey: 'game.help_cmd_shedding_special_jump' },
		{ keys: 'shift + i', descKey: 'game.help_cmd_shedding_special_jump_back' },
		{ keys: 'shift + n', descKey: 'game.help_cmd_shedding_sort_flip' },
		{ keys: 'shift + c', descKey: 'game.help_cmd_shedding_sort_colour' },
		{ keys: 'shift + o', descKey: 'game.help_cmd_shedding_sort_hand' },
	]);
});

test('D reads the deck, top card and colour in force (not the whole player status)', () => {
	// The beforeEach board has 60 in the deck, red-5 on top and red in force.
	key(boardEl, 'd');
	const line = announced.at(-1) ?? '';
	assert.equal(line, 'game.shedding_status_piles(60|c.red5|colors.red)');
	assert.ok(!line.includes('shedding_status_score'), 'not the hand/score bundle S reads');
});

test('C reads the top card alone — the fast check between turns', () => {
	// In a game this quick, the one thing you need before your turn is what is on the table.
	// D says it too, behind the deck count; S buries it between your hand and your score.
	key(boardEl, 'c');
	const line = announced.at(-1) ?? '';
	// Red 5 on top with red in force: the colour would only repeat the card's own, so it is
	// left out — this is the sentence heard dozens of times a game.
	assert.equal(line, 'game.shedding_top_readout_plain(c.red5)');
	assert.ok(!line.includes('60'), 'no deck count: that is what D is for');
	assert.ok(!line.includes('shedding_status_cards'), 'and not the hand bundle S reads');
});

test('C names the colour in force when a wild has changed it', () => {
	// The one case where the two disagree, and the only thing that says what may be played.
	gs.shedding!.discardPile.push(inst('wild', 1));
	gs.shedding!.currentColor = 'blue';
	view.update(gs);
	key(boardEl, 'c');
	assert.equal(announced.at(-1), 'game.shedding_top_readout(c.wild|colors.blue)');
});

test('C never reaches the engine shortcut it used to duplicate', () => {
	// AnnounceMyStatus repeats S word for word in a card family, which is why the shortcuts
	// help already hides it. The board consumes C so the global binding cannot answer as well.
	let leaked = 0;
	const onDocument = () => { leaked++; };
	document.addEventListener('keydown', onDocument);
	key(boardEl, 'c');
	document.removeEventListener('keydown', onDocument);
	assert.equal(leaked, 0);
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
	const seq = rows().map(r => ((/red7|blue7|wild/.exec((r.getAttribute('aria-label')!))) ?? [''])[0]);
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
	assert.equal(boardEl.querySelector('.hand-card--info'), null, 'the deck is not a hand row');
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
	const plays: { id: string; color: string | null; extras: string[] }[] = [];
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

test('Shift+S words a rival score exactly as S words mine: penalty points when so ruled', () => {
	const board = boardWith({ scoring: 'penalty' }, ['red-7'],
		[seat('me', ['red-7']), seat('r1', [], { handCount: 1, score: 240 })]);

	key(board.el, 'S', { shiftKey: true });

	assert.equal(board.said[board.said.length - 1],
		'N-r1: game.shedding_status_cards_one, game.shedding_status_score_penalty(240)');
	assert.ok(board.view.rulesSummary()
		.some(l => l === 'game.shedding_rules_scoring(game.shedding_rules_scoring_penalty)'));
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

// ── Hand orderings ────────────────────────────────────────────────────────────

/** The list-level sort tool with the given id. */
function sortTool(id: string): HTMLElement {
	const btn = document.querySelector<HTMLElement>(
		`.hand-panel__list-actions [data-focus-id="sort-${id}"]`);
	assert.ok(btn, `sort tool '${id}' exists`);
	return btn!;
}

/** Row names only: the aria-label also carries the "unplayable" tag, which is not the
 *  ordering's business. */
const handNames = (): string[] => Array.from(document.querySelectorAll<HTMLElement>('.hand-card'))
	.map(r => r.querySelector<HTMLElement>('.hand-card__name')?.textContent ?? '');

/** Reported from play: this exact hand read 0, 2, 2, 5, draw two, skip, draw two — the two
 *  draw twos apart, because every action weighed the same 10 and only the deal order broke
 *  the tie. Ranking the actions is what brings them together. */
const REPORTED_HAND = ['red-0', 'yellow-2', 'yellow-2', 'red-5', 'draw2-yellow', 'skip-yellow', 'draw2-red'];

test('lowest first: numbers in order, then each action group whole', () => {
	boardWith({}, REPORTED_HAND);
	sortTool('valueAsc').click();

	assert.deepEqual(handNames(), [
		'c.red0', 'c.yellow2', 'c.yellow2', 'c.red5', // numbers by their own figure
		'c.skipYellow',                                // then the actions, by rank
		'c.draw2Yellow', 'c.draw2Red',                 // …and the pair meets, colours apart
	]);
});

test('highest first is the exact mirror, actions leading', () => {
	boardWith({}, REPORTED_HAND);
	sortTool('value').click();

	assert.deepEqual(handNames(), [
		'c.draw2Yellow', 'c.draw2Red', 'c.skipYellow',
		'c.red5', 'c.yellow2', 'c.yellow2', 'c.red0',
	]);
});

test('the action rank orders every type, wilds closing the hand', () => {
	boardWith({}, ['wild-4', 'draw2-red', 'red-7', 'wild', 'skip-yellow', 'reverse-red']);
	sortTool('valueAsc').click();

	assert.deepEqual(handNames(), [
		'c.red7', 'c.skipYellow', 'c.reverseRed', 'c.draw2Red', 'c.wild', 'c.wild4',
	]);
});

test('by colour: each colour a small hand of its own, numbers before its actions', () => {
	// Colours rank by their NAME, so with keys for names blue < red < yellow.
	boardWith({}, ['yellow-2', 'red-5', 'wild', 'draw2-red', 'red-0', 'skip-yellow']);
	sortTool('colour').click();

	assert.deepEqual(handNames(), [
		'c.red0', 'c.red5', 'c.draw2Red',   // red: numbers up, then its action
		'c.yellow2', 'c.skipYellow',        // yellow, same shape
		'c.wild',                            // colourless, pooled last
	]);
});

test('"by type" is gone: ordering by value already groups the pairs', () => {
	const { el } = boardWith({}, REPORTED_HAND);
	assert.equal(el.querySelector('[data-focus-id="sort-type"]'), null,
		'the alphabetical-by-english-key grouping is not offered');
	for (const id of ['value', 'valueAsc', 'colour', 'hand']) sortTool(id);
});

test('an unsorted hand keeps the deal order, and the choice survives a repaint', () => {
	const { view: v, state } = boardWith({}, REPORTED_HAND);
	sortTool('hand').click();
	assert.deepEqual(handNames().slice(0, 3), ['c.red0', 'c.yellow2', 'c.yellow2']);

	sortTool('valueAsc').click();
	v.update(state); // a server echo must not throw the player back to the default
	assert.equal(sortTool('valueAsc').getAttribute('aria-pressed'), 'true');
});

test('Shift+N flips between the two value orderings, saying which one it landed on', () => {
	const { el, said } = boardWith({}, REPORTED_HAND);
	assert.deepEqual(handNames().slice(0, 2), ['c.draw2Yellow', 'c.draw2Red'], 'highest first by default');

	key(el, 'N', { shiftKey: true });
	assert.deepEqual(handNames().slice(0, 2), ['c.red0', 'c.yellow2']);
	assert.equal(said.at(-1), 'game.hand_sorted_valueAsc', 'the reorder is spoken, not just painted');

	key(el, 'N', { shiftKey: true });
	assert.deepEqual(handNames().slice(0, 2), ['c.draw2Yellow', 'c.draw2Red']);
	assert.equal(said.at(-1), 'game.hand_sorted_value');
});

test('Shift+C groups by colour and Shift+O returns to the order the cards arrived in', () => {
	const { el, said } = boardWith({}, REPORTED_HAND);

	key(el, 'C', { shiftKey: true });
	assert.equal(said.at(-1), 'game.hand_sorted_colour');
	// Colours rank by their spoken NAME, which here is the untranslated key: colors.red before
	// colors.yellow. Each colour then reads as a small hand — its numbers, then its actions.
	assert.deepEqual(handNames(), [
		'c.red0', 'c.red5', 'c.draw2Red',
		'c.yellow2', 'c.yellow2', 'c.skipYellow', 'c.draw2Yellow',
	]);

	key(el, 'O', { shiftKey: true });
	assert.equal(said.at(-1), 'game.hand_sorted_hand');
	assert.deepEqual(handNames(), [
		'c.red0', 'c.yellow2', 'c.yellow2', 'c.red5', 'c.draw2Yellow', 'c.skipYellow', 'c.draw2Red',
	], 'the deal order, untouched');
});

test('Shift+N from colour or deal order enters at the default end, and walks back out', () => {
	const { el } = boardWith({}, REPORTED_HAND);
	sortTool('colour').click();

	key(el, 'N', { shiftKey: true });
	assert.equal(sortTool('value').getAttribute('aria-pressed'), 'true', 'colour → highest first');
	key(el, 'N', { shiftKey: true });
	assert.equal(sortTool('valueAsc').getAttribute('aria-pressed'), 'true', 'and back out the other side');
});

test('the bare letters and the modified chords are left to the engine', () => {
	const { el } = boardWith({}, REPORTED_HAND);
	const before = handNames();

	key(el, 'n');                                        // the engine's own piece cycle
	key(el, 'o');                                        // unbound: not ours to swallow
	key(el, 'N', { shiftKey: true, ctrlKey: true });      // no board chord starts with Ctrl+Shift
	key(el, 'C', { shiftKey: true, altKey: true });
	assert.deepEqual(handNames(), before, 'only the bare Shift+ chords reorder the hand');

	// C alone keeps answering what it always answered: the top card, not an ordering.
	key(el, 'c');
	assert.deepEqual(handNames(), before, 'plain C did not reorder anything');
});

test('the sort keys are documented where the player looks for them', () => {
	const { view: v } = boardWith({}, REPORTED_HAND);
	const rows = new Map(v.helpShortcuts().map(s => [s.keys, s.descKey]));
	assert.equal(rows.get('shift + n'), 'game.help_cmd_shedding_sort_flip');
	assert.equal(rows.get('shift + c'), 'game.help_cmd_shedding_sort_colour');
	assert.equal(rows.get('shift + o'), 'game.help_cmd_shedding_sort_hand');
	assert.equal(rows.get('c'), 'game.help_cmd_shedding_top', 'the plain letter still means the top card');
});

test('a drawn card lands in its ordered place, not at the end of the hand', () => {
	const { view: v, state } = boardWith({}, ['red-0', 'draw2-red', 'wild-4']);
	sortTool('valueAsc').click();

	state.shedding!.seats[0].hand.push(inst('red-5', 9));
	state.shedding!.seats[0].handCount = 4;
	v.update(state);

	assert.deepEqual(handNames(), ['c.red0', 'c.red5', 'c.draw2Red', 'c.wild4'],
		'the 5 slots between the 0 and the actions');
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
