import test from 'node:test';
import assert from 'node:assert/strict';
import { GameCommands, ownsWholeColorGroup, type GameCommandsOptions } from '../src/gameCommands.js';
import { squareGroupLabel } from '../src/localizeSquare.js';
import type { Player, Square } from '../src/models.js';

/**
 * Regression tests for the "Announce your money" shortcut.
 *
 * Bug: after a player bought a property their turn passed to the next player, so the
 * shortcut (which read the CURRENT-TURN player) announced the wrong player's balance —
 * e.g. you bought a property dropping you to 1030€ but the shortcut read 1060€ (the next
 * player's money). The shortcut must always report the LOCAL player's own money.
 */

function makePlayer(id: string, name: string, money: number): Player {
	return { id, name, money } as unknown as Player;
}

function build(opts: Partial<GameCommandsOptions> & {
	players: Player[];
	myId?: string;
	currentTurn?: string;
}): { cmds: GameCommands; announced: string[] } {
	const announced: string[] = [];
	const moneyById = new Map(opts.players.map(p => [p.id, (p as any).money as number]));
	const full: GameCommandsOptions = {
		getPlayers: () => opts.players,
		announce: (msg: string) => announced.push(msg),
		t: opts.t ?? ((key: string, vars?: Record<string, any>) =>
			vars && 'amount' in vars ? `${vars.amount} euros` : key),
		getGroupMap: () => new Map(),
		nextOccupiedFn: () => -1,
		setActiveIndex: () => {},
		getCurrentTurn: () => opts.currentTurn,
		getMyPlayerId: () => opts.myId,
		getPlayerMoney: (id: string) => moneyById.get(id) ?? 0,
		getPlayerReleasePasses: () => 0,
		getPendingDebts: opts.getPendingDebts,
		getFreeParkingPot: () => 0,
	};
	return { cmds: new GameCommands(full), announced };
}

test('announceNoTurns speaks the no-turns line (simultaneous games like draft)', () => {
	const { cmds, announced } = build({ players: [] });
	assert.equal(cmds.announceNoTurns(), true);
	assert.deepEqual(announced, ['announce_no_turns']);
});

test('announceCurrentPlayerMoney reports MY money even when it is not my turn', () => {
	const me = makePlayer('me', 'Nuria', 1030);
	const juanjo = makePlayer('juanjo', 'Juanjo', 1060);
	// It is Juanjo's turn (my turn just ended after buying a property).
	const { cmds, announced } = build({ players: [me, juanjo], myId: 'me', currentTurn: 'juanjo' });

	cmds.announceCurrentPlayerMoney();

	assert.deepEqual(announced, [`${(1030).toLocaleString('es-ES')} euros`]);
});

test('announceCurrentPlayerMoney reports MY money on my own turn', () => {
	const me = makePlayer('me', 'Nuria', 1180);
	const juanjo = makePlayer('juanjo', 'Juanjo', 1060);
	const { cmds, announced } = build({ players: [me, juanjo], myId: 'me', currentTurn: 'me' });

	cmds.announceCurrentPlayerMoney();

	assert.deepEqual(announced, [`${(1180).toLocaleString('es-ES')} euros`]);
});

test('announceCurrentPlayerMoney falls back to current turn when local id is unknown', () => {
	const juanjo = makePlayer('juanjo', 'Juanjo', 1060);
	// Spectator-like state: no local id known, but there is an active turn.
	const { cmds, announced } = build({ players: [juanjo], myId: undefined, currentTurn: 'juanjo' });

	cmds.announceCurrentPlayerMoney();

	assert.deepEqual(announced, [`${(1060).toLocaleString('es-ES')} euros`]);
});

test('announceCurrentPlayerMoney announces no-player when nothing is known', () => {
	const { cmds, announced } = build({ players: [], myId: undefined, currentTurn: undefined });

	cmds.announceCurrentPlayerMoney();

	assert.deepEqual(announced, ['announce_no_current_player']);
});

test('announceCurrentPlayerMoney also reports my outstanding debt', () => {
	// Bug 16: cash never goes negative; an unpayable charge becomes a pending debt.
	// Reading only the cash hides that the player owes money, so when there is debt the
	// shortcut must read both figures via announce_player_money_with_debt.
	const me = makePlayer('me', 'Nuria', 0);
	const juanjo = makePlayer('juanjo', 'Juanjo', 1060);
	const { cmds, announced } = build({
		players: [me, juanjo],
		myId: 'me',
		currentTurn: 'me',
		// Echo the key + vars so we can assert which key (and amounts) were used.
		t: (key: string, vars?: Record<string, any>) => `${key}|${JSON.stringify(vars ?? {})}`,
		getPendingDebts: () => [
			{ debtorId: 'me', amount: 120 } as any,
			{ debtorId: 'me', amount: 30 } as any,
			{ debtorId: 'juanjo', amount: 999 } as any, // someone else's debt is ignored
		],
	});

	cmds.announceCurrentPlayerMoney();

	assert.equal(announced.length, 1);
	assert.match(announced[0], /^announce_player_money_with_debt\|/);
	const vars = JSON.parse(announced[0].split('|')[1]);
	assert.equal(vars.amount, (0).toLocaleString('es-ES'));
	assert.equal(vars.debt, (150).toLocaleString('es-ES'));
});

test('announceCurrentPlayerMoney omits the debt line when I owe nothing', () => {
	const me = makePlayer('me', 'Nuria', 1180);
	const { cmds, announced } = build({
		players: [me],
		myId: 'me',
		currentTurn: 'me',
		t: (key: string, vars?: Record<string, any>) => `${key}|${JSON.stringify(vars ?? {})}`,
		getPendingDebts: () => [{ debtorId: 'other', amount: 500 } as any],
	});

	cmds.announceCurrentPlayerMoney();

	assert.equal(announced.length, 1);
	assert.match(announced[0], /^announce_player_money\|/);
});

// ── Navigate to occupied squares (bug 8) ─────────────────────────────────────

test('nextOccupied leads with who is on the destination square (and where)', () => {
	const announced: string[] = [];
	const calls: Array<{ i: number; announceMove?: boolean }> = [];
	const players = [
		{ id: 'a', name: 'Alice', position: 5 },
		{ id: 'b', name: 'Bob', position: 5 },
		{ id: 'c', name: 'Carol', position: 9 },
	] as unknown as Player[];
	const squares = [
		{ name: 'Go' }, { name: 'Old Kent Road' }, { name: 'Whitechapel' }, { name: 'Income Tax' },
		{ name: 'Kings Cross' }, { name: 'The Angel Islington' },
	] as unknown as Square[];
	const cmds = new GameCommands({
		getPlayers: () => players,
		announce: (m: string) => announced.push(m),
		t: (key: string, vars?: Record<string, any>) => `${key}|${JSON.stringify(vars ?? {})}`,
		getGroupMap: () => new Map(),
		nextOccupiedFn: () => 5, // pretend the next occupied square is index 5
		setActiveIndex: (i: number, announceMove?: boolean) => calls.push({ i, announceMove }),
		getCurrentTurn: () => undefined,
		getPlayerMoney: () => 0,
		getPlayerReleasePasses: () => 0,
		getFreeParkingPot: () => 0,
	});

	cmds.nextOccupied(0, true, squares);

	assert.equal(announced.length, 1);
	assert.match(announced[0], /^announce_player_on_square\|/);
	const vars = JSON.parse(announced[0].split('|')[1]);
	assert.equal(vars.players, 'Alice, Bob');
	assert.equal(vars.square, 'The Angel Islington');
	// The cursor moves but suppresses the verbose board label (we already voiced it).
	assert.deepEqual(calls, [{ i: 5, announceMove: false }]);
});

test('nextOccupied does nothing when no occupied square is found', () => {
	const announced: string[] = [];
	const calls: number[] = [];
	const cmds = new GameCommands({
		getPlayers: () => [],
		announce: (m: string) => announced.push(m),
		t: (key: string, vars?: Record<string, any>) => `${key}|${JSON.stringify(vars ?? {})}`,
		getGroupMap: () => new Map(),
		nextOccupiedFn: () => -1,
		setActiveIndex: (i: number) => calls.push(i),
		getCurrentTurn: () => undefined,
		getPlayerMoney: () => 0,
		getPlayerReleasePasses: () => 0,
		getFreeParkingPot: () => 0,
	});

	cmds.nextOccupied(0, true, []);

	assert.deepEqual(announced, []);
	assert.deepEqual(calls, []);
});

// ── Announce current bid (bug 18) ────────────────────────────────────────────

function buildAuction(auction: any): { cmds: GameCommands; announced: string[] } {
	const announced: string[] = [];
	const cmds = new GameCommands({
		getPlayers: () => [],
		announce: (m: string) => announced.push(m),
		t: (key: string, vars?: Record<string, any>) => `${key}|${JSON.stringify(vars ?? {})}`,
		getGroupMap: () => new Map(),
		nextOccupiedFn: () => -1,
		setActiveIndex: () => {},
		getCurrentTurn: () => undefined,
		getPlayerMoney: () => 0,
		getPlayerReleasePasses: () => 0,
		getFreeParkingPot: () => 0,
		getActiveAuction: () => auction,
	});
	return { cmds, announced };
}

test('announceCurrentBid reads only the highest bid when there is one', () => {
	const { cmds, announced } = buildAuction({
		squareName: 'Elda', currentBid: 120, highestBidderName: 'Nuria',
		secondsRemaining: 8, playerMoney: 500,
	});

	cmds.announceCurrentBid();

	assert.equal(announced.length, 1);
	assert.match(announced[0], /^auction_current_bid_only\|/);
	const vars = JSON.parse(announced[0].split('|')[1]);
	assert.equal(vars.amount, 120);
	assert.equal(vars.bidder, 'Nuria');
});

test('announceCurrentBid says there are no bids yet when the auction has none', () => {
	const { cmds, announced } = buildAuction({
		squareName: 'Elda', currentBid: 0, highestBidderName: null,
		secondsRemaining: 8, playerMoney: 500,
	});

	cmds.announceCurrentBid();

	assert.deepEqual(announced, ['auction_current_bid_none|{}']);
});

test('announceCurrentBid reports no active auction when none is running', () => {
	const { cmds, announced } = buildAuction(null);

	cmds.announceCurrentBid();

	assert.deepEqual(announced, ['auction_status_none|{}']);
});

// ── ownsWholeColorGroup (pure, bug 13) ───────────────────────────────────────

function sq(id: number, color: string | undefined, ownerId?: string): Square {
	return { id, color, ownerId, type: 'property' } as unknown as Square;
}

test('ownsWholeColorGroup is true when I own every square of the colour', () => {
	const squares = [sq(1, 'brown', 'me'), sq(3, 'brown', 'me'), sq(6, 'lightblue', 'me')];
	assert.equal(ownsWholeColorGroup(squares, 'brown', 'me'), true);
});

test('ownsWholeColorGroup is false when a square in the group is owned by someone else', () => {
	const squares = [sq(1, 'brown', 'me'), sq(3, 'brown', 'rival')];
	assert.equal(ownsWholeColorGroup(squares, 'brown', 'me'), false);
});

test('ownsWholeColorGroup is false when a square in the group is unowned', () => {
	const squares = [sq(1, 'brown', 'me'), sq(3, 'brown', undefined)];
	assert.equal(ownsWholeColorGroup(squares, 'brown', 'me'), false);
});

test('ownsWholeColorGroup is false for colourless squares or missing ids', () => {
	const squares = [sq(5, undefined, 'me')];
	assert.equal(ownsWholeColorGroup(squares, undefined, 'me'), false);
	assert.equal(ownsWholeColorGroup(squares, 'brown', undefined), false);
	assert.equal(ownsWholeColorGroup([], 'brown', 'me'), false);
});

/**
 * Regression tests for the "go to my next/previous property" board shortcuts. The
 * cursor cycles through the squares the LOCAL player owns, in board order, and wraps
 * around. When the cursor sits outside my holdings it jumps to the nearest owned
 * square in the chosen direction.
 */
function buildOwned(myId: string | undefined): {
	cmds: GameCommands; announced: string[]; moved: number[];
} {
	const announced: string[] = [];
	const moved: number[] = [];
	const full: GameCommandsOptions = {
		getPlayers: () => [],
		announce: (msg: string) => announced.push(msg),
		t: (key: string) => key,
		getGroupMap: () => new Map(),
		nextOccupiedFn: () => -1,
		setActiveIndex: (i: number) => moved.push(i),
		getCurrentTurn: () => undefined,
		getMyPlayerId: () => myId,
		getPlayerMoney: () => 0,
		getPlayerReleasePasses: () => 0,
		getFreeParkingPot: () => 0,
	};
	return { cmds: new GameCommands(full), announced, moved };
}

// Squares 1, 3 and 39 are mine; the rest belong to nobody or to a rival.
const ownedSquares = [
	{ ownerId: undefined },        // 0
	{ ownerId: 'me' },             // 1
	{ ownerId: 'rival' },          // 2
	{ ownerId: 'me' },             // 3
	...Array.from({ length: 35 }, () => ({ ownerId: undefined })), // 4..38
	{ ownerId: 'me' },             // 39
] as any[];

test('ownedNext cycles forward through my properties in board order and wraps', () => {
	const { cmds, moved } = buildOwned('me');
	cmds.ownedNext(1, true, ownedSquares); // on square 1 -> next is 3
	cmds.ownedNext(3, true, ownedSquares); // on square 3 -> next is 39
	cmds.ownedNext(39, true, ownedSquares); // on last -> wraps to 1
	assert.deepEqual(moved, [3, 39, 1]);
});

test('ownedNext cycles backward through my properties and wraps', () => {
	const { cmds, moved } = buildOwned('me');
	cmds.ownedNext(3, false, ownedSquares); // -> 1
	cmds.ownedNext(1, false, ownedSquares); // wraps -> 39
	assert.deepEqual(moved, [1, 39]);
});

test('ownedNext from outside my holdings jumps to the nearest owned square in that direction', () => {
	const { cmds, moved } = buildOwned('me');
	cmds.ownedNext(2, true, ownedSquares);  // forward from 2 -> 3
	cmds.ownedNext(10, false, ownedSquares); // backward from 10 -> 3
	cmds.ownedNext(-1, true, ownedSquares);  // no cursor, forward -> first (1)
	cmds.ownedNext(50, true, ownedSquares);  // past the end, forward wraps -> first (1)
	assert.deepEqual(moved, [3, 3, 1, 1]);
});

test('ownedNext announces a hint and does not move when I own nothing', () => {
	const { cmds, announced, moved } = buildOwned('me');
	const noneMine = [{ ownerId: 'rival' }, { ownerId: undefined }] as any[];
	cmds.ownedNext(0, true, noneMine);
	assert.deepEqual(moved, []);
	assert.deepEqual(announced, ['announce_owned_none']);
});

test('ownedNext announces a hint when the local player id is unknown', () => {
	const { cmds, announced, moved } = buildOwned(undefined);
	cmds.ownedNext(0, true, ownedSquares);
	assert.deepEqual(moved, []);
	assert.deepEqual(announced, ['announce_owned_none']);
});

// Squares 2 (utility) and 5 (railroad) are unowned-ownable; 1 is owned, 3 is a
// non-ownable space (chance), so only 2, 4 and 5 should be visited.
const unownedSquares = [
	{ type: 'corner' },                          // 0 (not ownable)
	{ type: 'property', ownerId: 'rival' },      // 1 (owned)
	{ type: 'utility', ownerId: undefined },     // 2 (unowned-ownable)
	{ type: 'chance' },                          // 3 (not ownable)
	{ type: 'property', ownerId: undefined },    // 4 (unowned-ownable)
	{ type: 'railroad', ownerId: undefined },    // 5 (unowned-ownable)
] as any[];

test('unownedNext cycles forward through unowned ownable squares and wraps', () => {
	const { cmds, moved } = buildOwned('me');
	cmds.unownedNext(2, true, unownedSquares);  // 2 -> 4
	cmds.unownedNext(4, true, unownedSquares);  // 4 -> 5
	cmds.unownedNext(5, true, unownedSquares);  // last -> wraps to 2
	assert.deepEqual(moved, [4, 5, 2]);
});

test('unownedNext cycles backward and wraps', () => {
	const { cmds, moved } = buildOwned('me');
	cmds.unownedNext(4, false, unownedSquares); // 4 -> 2
	cmds.unownedNext(2, false, unownedSquares); // wraps -> 5
	assert.deepEqual(moved, [2, 5]);
});

test('unownedNext from an owned/non-ownable square jumps to the nearest unowned one', () => {
	const { cmds, moved } = buildOwned('me');
	cmds.unownedNext(1, true, unownedSquares);  // forward from owned 1 -> 2
	cmds.unownedNext(3, false, unownedSquares); // backward from chance 3 -> 2
	cmds.unownedNext(-1, true, unownedSquares); // no cursor, forward -> first (2)
	cmds.unownedNext(99, true, unownedSquares); // past end -> wraps to first (2)
	assert.deepEqual(moved, [2, 2, 2, 2]);
});

test('unownedNext announces a hint and does not move when everything is owned', () => {
	const { cmds, announced, moved } = buildOwned('me');
	const allOwned = [
		{ type: 'property', ownerId: 'rival' },
		{ type: 'railroad', ownerId: 'me' },
		{ type: 'chance' },
	] as any[];
	cmds.unownedNext(0, true, allOwned);
	assert.deepEqual(moved, []);
	assert.deepEqual(announced, ['announce_unowned_none']);
});

/**
 * Regression tests for the colour-group jump shortcuts (e.g. "r" for red). The cursor
 * cycles through the squares of a colour group in board order and wraps around; holding
 * Shift (forward = false) walks the same group BACKWARDS.
 */
function buildGroup(map: Map<string, number[]>): { cmds: GameCommands; moved: number[] } {
	const moved: number[] = [];
	const full: GameCommandsOptions = {
		getPlayers: () => [],
		announce: () => {},
		t: (key: string) => key,
		getGroupMap: () => map,
		nextOccupiedFn: () => -1,
		setActiveIndex: (i: number) => moved.push(i),
		getCurrentTurn: () => undefined,
		getMyPlayerId: () => undefined,
		getPlayerMoney: () => 0,
		getPlayerReleasePasses: () => 0,
		getFreeParkingPot: () => 0,
	};
	return { cmds: new GameCommands(full), moved };
}

// The red group occupies squares 21, 23 and 24.
const redGroup = new Map<string, number[]>([['red', [21, 23, 24]]]);

test('groupNext walks forward through the colour group in board order and wraps', () => {
	const { cmds, moved } = buildGroup(redGroup);
	cmds.groupNext(21, 'red');          // -> 23
	cmds.groupNext(23, 'red');          // -> 24
	cmds.groupNext(24, 'red');          // last wraps -> 21
	assert.deepEqual(moved, [23, 24, 21]);
});

test('groupNext with forward=false walks BACKWARDS through the group and wraps', () => {
	const { cmds, moved } = buildGroup(redGroup);
	cmds.groupNext(24, 'red', false);   // -> 23
	cmds.groupNext(23, 'red', false);   // -> 21
	cmds.groupNext(21, 'red', false);   // first wraps -> 24
	assert.deepEqual(moved, [23, 21, 24]);
});

test('groupNext from outside the group lands on the first square forward, last square backward', () => {
	const { cmds, moved } = buildGroup(redGroup);
	cmds.groupNext(0, 'red');           // not in group, forward -> first (21)
	cmds.groupNext(0, 'red', false);    // not in group, backward -> last (24)
	assert.deepEqual(moved, [21, 24]);
});


// ── Announce colour / group (shift+c) ────────────────────────────────────────
// Regression: on a package board whose squares carry a hex colour (e.g. "#b9a04a"), shift+c
// announced the raw i18n key ("game.color_<hex>") instead of the group's name, because it built
// the key from the colour value. It must resolve the square's groupNameKey via squareGroupLabel,
// exactly like the board status line.
function buildGroupAnnounce(): { cmds: GameCommands; announced: string[] } {
	const announced: string[] = [];
	const dict: Record<string, string> = {
		'groups.antimatter': 'Antimateria',
		'game.group': 'Grupo',
		'game.color': 'Color',
	};
	const translate = (k: string) => dict[k] ?? k;      // returns the key unchanged when missing
	const localizeColor = (c: string) => c;             // classic named colours pass through
	const cmds = new GameCommands({
		getPlayers: () => [],
		announce: (m: string) => announced.push(m),
		t: (key: string) => key,
		getGroupMap: () => new Map(),
		nextOccupiedFn: () => -1,
		setActiveIndex: () => {},
		getCurrentTurn: () => undefined,
		getPlayerMoney: () => 0,
		getPlayerReleasePasses: () => 0,
		getFreeParkingPot: () => 0,
		groupLabel: (sq) => squareGroupLabel(sq, translate, localizeColor),
	});
	return { cmds, announced };
}

test('announceGroup speaks the group NAME for a hex-coloured package square, not the raw key', () => {
	const { cmds, announced } = buildGroupAnnounce();
	const squares = [{ name: 'Antimatter Plant', color: '#b9a04a', groupNameKey: 'groups.antimatter' }] as unknown as Square[];
	cmds.announceGroup(0, squares);
	assert.deepEqual(announced, ['Grupo: Antimateria']);
	assert.ok(!announced[0].includes('color_'));       // never the raw color-derived key
});

test('announceGroup falls back to no-colour for a hex colour with no group key', () => {
	const { cmds, announced } = buildGroupAnnounce();
	const squares = [{ name: 'X', color: '#b9a04a' }] as unknown as Square[];  // hex, no groupNameKey
	cmds.announceGroup(0, squares);
	assert.deepEqual(announced, ['announce_no_group']);
});

test('announceGroup speaks a classic named colour', () => {
	const { cmds, announced } = buildGroupAnnounce();
	const squares = [{ name: 'Old Kent Road', color: 'brown' }] as unknown as Square[];
	cmds.announceGroup(0, squares);
	assert.deepEqual(announced, ['Color: brown']);
});

// ── announceTurn (the "t" shortcut) — disconnected current player ─────────────

test('announceTurn appends the disconnected state when the current player is offline', () => {
	const roster = [makePlayer('a', 'Ana', 100), { ...makePlayer('b', 'Berto', 100), isConnected: false }];
	const { cmds, announced } = build({
		players: roster, myId: 'a', currentTurn: 'b',
		t: (key: string, vars?: Record<string, any>) => (vars?.player ? `${key}:${vars.player}` : key),
	});
	cmds.announceTurn();
	assert.equal(announced.length, 1);
	// The turn line is spoken AND the absence is voiced right after it.
	assert.match(announced[0], /turn_of:Berto/);
	assert.match(announced[0], /turn_player_disconnected:Berto/);
});

test('announceTurn stays clean while the current player is connected', () => {
	const roster = [makePlayer('a', 'Ana', 100), { ...makePlayer('b', 'Berto', 100), isConnected: true }];
	const { cmds, announced } = build({
		players: roster, myId: 'a', currentTurn: 'b',
		t: (key: string, vars?: Record<string, any>) => (vars?.player ? `${key}:${vars.player}` : key),
	});
	cmds.announceTurn();
	assert.equal(announced.length, 1);
	assert.doesNotMatch(announced[0], /turn_player_disconnected/);
});

test('announceTurn also flags the disconnected player on the debt-waiting line', () => {
	const roster = [makePlayer('a', 'Ana', 100), { ...makePlayer('b', 'Berto', 100), isConnected: false }];
	const { cmds, announced } = build({
		players: roster, myId: 'a', currentTurn: 'b',
		getPendingDebts: () => [{ debtorId: 'b' } as any],
		t: (key: string, vars?: Record<string, any>) => (vars?.player ? `${key}:${vars.player}` : key),
	});
	cmds.announceTurn();
	assert.match(announced[0], /announce_turn_with_debt:Berto/);
	assert.match(announced[0], /turn_player_disconnected:Berto/);
});
