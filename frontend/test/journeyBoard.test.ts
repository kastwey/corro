import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { JourneyBoard, journeyStatusText, journeyDashFlag, type JourneyBoardDeps } from '../src/journeyBoard.js';
import { attackableRivals, canPlayCard } from '../src/journeyRules.js';
import type { GameState, JourneyCardInstance, JourneySeatState } from '../src/models.js';

/**
 * The journey surface: the hand renders from MY projected seat with server-mirrored
 * playability, Enter routes attacks through the victim picker (auto-target with one rival),
 * the coup dialog is state-driven and only for the victim, S speaks the shared status line,
 * and the progress-strip cars sit at their kilometre positions (snapping under reduced
 * motion). The visual region stays aria-hidden.
 */

before(() => setupDom());

const DECK = [
	{ id: 'distance-25', type: 'distance', value: 25, count: 10, nameKey: 'cards.distance_25' },
	{ id: 'stop', type: 'attack', kind: 'stop', hazardClass: 'stopper', value: 0, count: 5, nameKey: 'cards.stop' },
	{ id: 'flat', type: 'attack', kind: 'flat', hazardClass: 'stopper', value: 0, count: 3, nameKey: 'cards.flat' },
	{ id: 'limit', type: 'attack', kind: 'speedLimit', hazardClass: 'limiter', value: 0, count: 4, nameKey: 'cards.limit' },
	{ id: 'go', type: 'remedy', kind: 'stop', value: 0, count: 14, nameKey: 'cards.go' },
	{ id: 'priority', type: 'immunity', shieldsKinds: ['stop', 'speedLimit'], value: 0, count: 1, nameKey: 'cards.priority' },
];

function seat(
	id: string,
	over: { hand?: JourneyCardInstance[]; handCount?: number } & Partial<Omit<JourneySeatState, 'members' | 'playerId'>> = {},
): JourneySeatState {
	const { hand = [], handCount = hand.length, ...rest } = over;
	return {
		playerId: id,
		members: [{ playerId: id, hand, handCount }],
		km: 0, hazards: [], immunities: [],
		premiumPlays: 0, coupFourres: 0, score: 0, ...rest,
	};
}

/** A shared TEAM seat: members in turn order, each with their own (possibly empty) hand. */
function teamSeat(
	ids: string[],
	hands: Record<string, JourneyCardInstance[]> = {},
	over: Partial<Omit<JourneySeatState, 'members' | 'playerId'>> = {},
): JourneySeatState {
	return {
		playerId: ids[0],
		members: ids.map(id => ({ playerId: id, hand: hands[id] ?? [], handCount: (hands[id] ?? []).length })),
		km: 0, hazards: [], immunities: [],
		premiumPlays: 0, coupFourres: 0, score: 0, ...over,
	};
}

function game(seats: JourneySeatState[], over: Record<string, unknown> = {}): GameState {
	return {
		gameType: 'journey',
		journey: {
			seats, drawPile: [], drawCount: 20, discardPile: [],
			hasDrawn: true, round: 1, lastHandScores: [],
		},
		journeyDeck: DECK,
		journeyRules: { goalKm: 1000, targetScore: 5000, handSize: 6, stackHazards: false, limitCap: 50, initialHazard: 'stop' },
		players: seats.flatMap(s => s.members).map(m => ({ id: m.playerId, name: `N-${m.playerId}`, color: '#e53935' })),
		bank: { money: 0 }, currentTurn: 'me', ownership: [], squares: [],
		...over,
	} as unknown as GameState;
}

let gs: GameState;
let deps: JourneyBoardDeps;
let boardEl: HTMLElement;
let view: JourneyBoard;
let played: Array<[string, string | null | undefined]>;
let drawn: number;
let coups: boolean[];
let announced: string[];
let motionOff: boolean;

/** Full-key fake translator: key + compact vars, so asserts read naturally. */
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
	installFakeI18next('en');
	document.body.innerHTML = '<div id="board"></div>';
	boardEl = document.getElementById('board')!;
	played = []; coups = []; announced = [];
	drawn = 0; motionOff = true; // snap by default: tests stay timer-free
	gs = game([
		seat('me', { hand: [{ instanceId: 'go#0', cardId: 'go' }, { instanceId: 'stop#0', cardId: 'stop' }], handCount: 2, hazards: ['stop'] }),
		seat('r1', { handCount: 6 }),
		seat('r2', { handCount: 6 }),
	]);
	deps = {
		getGameState: () => gs,
		getMyPlayerId: () => 'me',
		announce: text => { announced.push(text); },
		tSync: t,
		onIdle: () => {},
		motionDisabled: () => motionOff,
		commands: {
			draw: () => { drawn++; },
			play: (instanceId, targetId) => { played.push([instanceId, targetId]); },
			discard: () => {},
			coup: accept => { coups.push(accept); },
		},
	};
	view = new JourneyBoard(boardEl, deps);
	view.update(gs);
});

test('helpShortcuts reports the REAL wiring: Enter/Space/Delete + S/Shift+S', () => {
	assert.deepEqual(view.helpShortcuts(), [
		{ keys: 'enter', descKey: 'game.help_cmd_play_card' },
		{ keys: 'space', descKey: 'game.help_cmd_draw_card' },
		{ keys: 'delete', descKey: 'game.help_cmd_discard_card' },
		{ keys: 'shift+f1', descKey: 'game.help_cmd_card_help' },
		{ keys: 's', descKey: 'game.help_cmd_status_mine' },
		{ keys: 'shift+s', descKey: 'game.help_cmd_status_rivals' },
	]);
});

test('the hand renders my projected cards with server-mirrored playability', () => {
	const labels = rows().map(r => r.getAttribute("aria-label"));
	assert.equal(rows().length, 3);
	assert.equal(labels[0], 'cards.go'); // remedy for my "stop": playable
	// Both rivals are rolling and unshielded, so the attack is playable too.
	assert.equal(labels[1], 'cards.stop');
	// The draw pile rides the hand as a read-only last row carrying its count.
	assert.equal(labels[2], 'game.journey_deck_row(20)');
	assert.ok(rows()[2].classList.contains('hand-card--info'));
	// The VISUAL layer (all aria-hidden): faces on the rows, the deck row as a card back,
	// the centre piles, the odometer dashboards and the road furniture.
	assert.ok(rows()[0].querySelector('.jcard--remedy'));
	assert.ok(rows()[1].querySelector('.jcard--attack'));
	assert.ok(rows()[2].querySelector('.jcard--back'));
	assert.ok(boardEl.querySelector('.journey-centre__stack .jcard--back'));
	assert.ok(boardEl.querySelector('.journey-centre__discard .jcard--empty')); // nothing discarded yet
	assert.equal(boardEl.querySelectorAll('.journey-dash__digit').length, 12); // 3 seats × 4 digits
	assert.ok(boardEl.querySelector('.journey-road__finish'));
	// The visual region never talks to the screen reader.
	assert.equal(boardEl.querySelector('.journey-visual')?.getAttribute('aria-hidden'), 'true');
	// No board in this family — and no container label either (the hand LIST names itself;
	// a container label would make "Tu mano" read twice). The i18n binding goes with it.
	assert.equal(boardEl.getAttribute('aria-label'), null);
	assert.equal(boardEl.getAttribute('data-i18n-attr:aria-label'), null);
	// And the visible draw affordance replaces the die.
	assert.ok(boardEl.querySelector('.hand-panel__draw'));
});

test('the turn never rewrites the rows: acting off-turn is refused ALOUD instead', () => {
	gs.currentTurn = 'r1';
	view.update(gs);
	const row = rows()[0];
	// The rows carry the card's OWN legality only. Baking the turn into them made every
	// turn change rewrite all the labels — heard as "the list got recreated".
	assert.equal(row.getAttribute("aria-label"), 'cards.go');
	row.focus();
	key(row, 'Enter');
	assert.deepEqual(played, []);
	assert.deepEqual(announced, ['game.journey_not_your_turn']);
});

test('Enter plays a remedy directly and Space draws through the gate', () => {
	const row = rows()[0];
	row.focus();
	key(row, 'Enter');
	assert.deepEqual(played, [['go#0', undefined]]);

	gs.journey!.hasDrawn = false;
	view.update(gs);
	key(rows()[0], ' ');
	assert.equal(drawn, 1);
});

test('an attack with several attackable rivals opens the victim picker', () => {
	const attack = rows()[1];
	attack.focus();
	key(attack, 'Enter');
	assert.deepEqual(played, []); // nothing sent yet: the picker owns the choice

	const menu = document.querySelector('[role="menu"]');
	assert.ok(menu, 'victim picker opened');
	const options = Array.from(menu!.querySelectorAll<HTMLElement>('[role="menuitem"]'));
	assert.deepEqual(options.map(o => o.textContent), ['N-r1', 'N-r2']);
	options[1].click();
	assert.deepEqual(played, [['stop#0', 'r2']]);
});

// Live-play ("pulsé Tab y desapareció"): Escape/Tab on the picker aborts the attack in
// silence — the player is left wondering whether the card was played. Cancelling must SAY so.
test('cancelling the victim picker announces it and plays nothing', () => {
	const attack = rows()[1];
	attack.focus();
	key(attack, 'Enter');
	const item = document.querySelector('[role="menuitem"]')!;

	key(item, 'Escape');

	assert.equal(document.querySelector('[role="menu"]'), null, 'the picker closed');
	assert.deepEqual(played, [], 'nothing was sent');
	assert.ok(announced.includes('game.pick_cancelled'), 'the cancellation is voiced');
});

test('an attack with a single attackable rival auto-targets them', () => {
	gs.journey!.seats[2].immunities.push('priority'); // r2 shielded → only r1 remains
	view.update(gs);
	const attack = rows()[1];
	attack.focus();
	key(attack, 'Enter');
	assert.deepEqual(played, [['stop#0', 'r1']]);
	assert.equal(document.querySelector('[role="menu"]'), null);
});

test('the coup dialog is state-driven, victim-only, and answers the command', () => {
	// I am the ATTACKER: no dialog for me.
	gs.journey!.pendingCoup = { victimId: 'r1', attackerId: 'me', hazardKind: 'stop', immunityInstanceId: '' };
	view.update(gs);
	assert.equal(document.querySelector('.dialog-journey-coup[open]'), null);

	// I am the VICTIM: the non-modal decision opens and accepting sends coup(true).
	gs.journey!.pendingCoup = { victimId: 'me', attackerId: 'r1', hazardKind: 'stop', immunityInstanceId: 'priority#0' };
	view.update(gs);
	const dialog = document.querySelector<HTMLDialogElement>('.dialog-journey-coup[open]');
	assert.ok(dialog, 'coup dialog opened for the victim');
	assert.equal(dialog!.dataset.modal, 'false');
	const accept = Array.from(dialog!.querySelectorAll('button'))
		.find(b => b.textContent === 'game.journey_coup_accept')!;
	accept.click();
	assert.deepEqual(coups, [true]);

	// Resolved on the server → the pending coup clears → the dialog closes.
	gs.journey!.pendingCoup = null;
	view.update(gs);
	assert.equal(document.querySelector('.dialog-journey-coup[open]'), null);
});

test('S speaks the shared status line: plain «parado», named breakdowns, LIVE points', () => {
	gs.journey!.seats[0].km = 425;
	gs.journey!.seats[0].immunities.push('priority');
	view.update(gs);

	const status = journeyStatusText(gs, 'me', t)!;
	assert.match(status, /game\.journey_status_km\(425\)/);
	// The INITIAL hazard ("stop") is never blamed on a card nobody threw: plain «parado».
	assert.match(status, /game\.journey_status_stopped_plain/);
	assert.doesNotMatch(status, /cards\.stop/);
	assert.match(status, /game\.journey_status_immunities\(cards\.priority\)/);
	// The points are LIVE: 425 km + 100 (immunity) + 300 (ALL of this deck's immunities).
	assert.match(status, /game\.journey_status_score\(825\)/);

	const row = rows()[0];
	row.focus();
	key(row, 's');
	assert.deepEqual(announced, [status]);

	// A real breakdown keeps its name — each one needs its own cure.
	gs.journey!.seats[0].hazards.push('flat');
	assert.match(journeyStatusText(gs, 'me', t)!, /game\.journey_status_stopped\(cards\.flat\)/);
});

test('a retired seat tells its exit and banked score, and takes no more attacks', () => {
	gs.journey!.seats[1].retired = true;
	gs.journey!.seats[1].score = 1200;
	gs.journey!.seats[2].retired = true;

	assert.equal(journeyStatusText(gs, 'r1', t),
		'game.status_retired, game.journey_status_score(1200)');

	// Both rivals retired: the stop in my hand has NO victim left — its row goes
	// unplayable with the server's own reason instead of aiming at a ghost.
	view.update(gs);
	const stopDef = gs.journeyDeck!.find(c => c.id === 'stop')!;
	assert.equal(attackableRivals(gs, 'me', stopDef).length, 0);
	const play = canPlayCard(gs, 'me', 'stop');
	assert.equal(play.playable, false);
	assert.equal(play.reasonKey, 'game.journey_no_attackable');
});

// Live-play request: "cuando pulso shift+s quiero que solo me lea los otros, no mi info,
// esa ya me la sé con la s" — Shift+S surveys the RIVAL seats only.
test('Shift+S reads the other seats only — mine is left out (S already covers it)', () => {
	const row = rows()[0];
	row.focus();
	key(row, 'S', { shiftKey: true });

	assert.equal(announced.length, 1);
	assert.match(announced[0], /N-r1: /);
	assert.match(announced[0], /N-r2: /);
	assert.ok(!announced[0].includes('N-me:'), 'my own status is not repeated');
});

test('team mode: Shift+S skips my WHOLE shared seat, partner included', () => {
	gs = game([
		teamSeat(['me', 'p2']),
		teamSeat(['r1', 'r2']),
	]);
	view.update(gs);

	key(boardEl, 'S', { shiftKey: true });

	assert.equal(announced.length, 1);
	// The rival team's line leads with its colour word (seat 1 → blue)…
	assert.match(announced[0], /game\.journey_team\(game\.color_blue\)/);
	// …and my shared seat (red, my partner included) is not read back.
	assert.ok(!announced[0].includes('game.color_red'), 'my team is not repeated');
});

test('team mode: my hand is MINE alone, any member id targets the seat, one shared status', () => {
	gs = game([
		teamSeat(['me', 'p2'], {
			me: [{ instanceId: 'stop#0', cardId: 'stop' }],
			p2: [{ instanceId: 'go#0', cardId: 'go' }],
		}),
		teamSeat(['r1', 'r2']),
	]);
	view.update(gs);

	// Only MY cards render — the partner's hand is private, even from me.
	const cardRows = rows().filter(r => !r.classList.contains('hand-card--info'));
	assert.deepEqual(cardRows.map(r => r.getAttribute("aria-label")), ['cards.stop']);

	// With a single rival SEAT the attack auto-targets it (partners are never targets):
	// any member id names the seat on the wire.
	cardRows[0].focus();
	key(cardRows[0], 'Enter');
	assert.deepEqual(played, [['stop#0', 'r1']]);

	// Both partners share ONE status line, led by the team's colour word (seat 0 → red).
	const status = journeyStatusText(gs, 'me', t)!;
	assert.match(status, /^game\.journey_team\(game\.color_red\)/);
	assert.equal(status, journeyStatusText(gs, 'p2', t));

	// The dashboard shows the seat as its members together.
	const dash = document.querySelector('.journey-dash__name');
	assert.equal(dash?.textContent, 'N-me + N-p2');
});

test('team mode: with several rival TEAMS the picker offers their colour words', () => {
	gs = game([
		teamSeat(['me', 'p2'], { me: [{ instanceId: 'stop#0', cardId: 'stop' }] }),
		teamSeat(['r1', 'r2']),
		teamSeat(['r3', 'r4']),
	]);
	view.update(gs);

	const attack = rows()[0];
	attack.focus();
	key(attack, 'Enter');
	assert.deepEqual(played, []); // two rival seats: the picker owns the choice

	const menu = document.querySelector('[role="menu"]');
	assert.ok(menu, 'victim picker opened');
	const options = Array.from(menu!.querySelectorAll<HTMLElement>('[role="menuitem"]'));
	assert.deepEqual(options.map(o => o.textContent), [
		'game.journey_team(game.color_blue)',
		'game.journey_team(game.color_yellow)',
	]);
	options[1].click();
	assert.deepEqual(played, [['stop#0', 'r3']]);
});

test('cars sit at their kilometre share of the strip and snap under reduced motion', () => {
	gs.journey!.seats[0].km = 250;
	gs.journey!.seats[1].km = 1000;
	view.update(gs);

	const cars = Array.from(boardEl.querySelectorAll<HTMLElement>('.journey-car'));
	assert.equal(cars.length, 3);
	const byId = new Map(cars.map(c => [c.dataset.playerId, c.style.left]));
	assert.equal(byId.get('me'), '25%');
	assert.equal(byId.get('r1'), '100%');
	assert.equal(byId.get('r2'), '0%');
	assert.equal(view.isAnimating(), false); // reduced motion: never mid-slide
});

// ── The dashboard's battle-state flag (live-play request: Eric couldn't read his own
// state from the tiny icons). One colour-coded chip: red stopped / amber limited /
// green rolling, with the same naming rules as the spoken status line.

test('dash flag: the initial wait for the green light reads plain stopped', () => {
	const g = game([seat('me', { hazards: ['stop'] })]);
	const flag = journeyDashFlag(g, g.journey!.seats[0], t);
	assert.equal(flag.kind, 'stopped');
	assert.equal(flag.label, 'game.journey_status_stopped_plain');
});

test('dash flag: a real breakdown is stopped AND named by its card', () => {
	const g = game([seat('me', { hazards: ['flat'] })]);
	const flag = journeyDashFlag(g, g.journey!.seats[0], t);
	assert.equal(flag.kind, 'stopped');
	assert.equal(flag.label, 'cards.flat');
});

test('dash flag: a speed limit alone reads limited with the limiter card name', () => {
	const g = game([seat('me', { hazards: ['speedLimit'] })]);
	const flag = journeyDashFlag(g, g.journey!.seats[0], t);
	assert.equal(flag.kind, 'limited');
	assert.equal(flag.label, 'cards.limit');
});

test('dash flag: stopped wins over limited when both apply', () => {
	const g = game([seat('me', { hazards: ['speedLimit', 'flat'] })]);
	const flag = journeyDashFlag(g, g.journey!.seats[0], t);
	assert.equal(flag.kind, 'stopped');
	assert.equal(flag.label, 'cards.flat');
});

test('dash flag: a clear seat rolls (green)', () => {
	const g = game([seat('me', { hazards: [] })]);
	const flag = journeyDashFlag(g, g.journey!.seats[0], t);
	assert.equal(flag.kind, 'rolling');
	assert.equal(flag.label, 'game.journey_status_rolling');
});
