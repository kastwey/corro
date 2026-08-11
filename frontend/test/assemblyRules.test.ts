import test from 'node:test';
import assert from 'node:assert/strict';
import {
	assemblyCardHelp, assemblyCatalog, assemblyStatusText, attackTargets, awaitedShieldFrom,
	canPlayCard, canSwapPair, deckColors, exileTargets, functionalColors, isLocked, mustRetarget,
	myShieldCards, plagueHasMoves, remedySlots, retargetOptions, stealTargets, swapTargets,
} from '../src/assemblyRules.js';
import type { AssemblySeatState, AssemblySlot, GameState } from '../src/models.js';

// Client-side mirror of the assembly legality: playability for the hand
// rows, target enumeration for the picker chains, and the shared status line. The server
// re-checks everything — these pin that the UI refuses with the same words.

const DECK = [
	{ id: 'p-red', type: 'piece', color: 'red', count: 5, nameKey: 'c.p-red' },
	{ id: 'p-green', type: 'piece', color: 'green', count: 5, nameKey: 'c.p-green' },
	{ id: 'p-blue', type: 'piece', color: 'blue', count: 5, nameKey: 'c.p-blue' },
	{ id: 'p-wild', type: 'piece', color: 'wild', count: 1, nameKey: 'c.p-wild' },
	{ id: 'a-red', type: 'attack', color: 'red', count: 4, nameKey: 'c.a-red' },
	{ id: 'a-wild', type: 'attack', color: 'wild', count: 1, nameKey: 'c.a-wild' },
	{ id: 'r-red', type: 'remedy', color: 'red', count: 4, nameKey: 'c.r-red' },
	{ id: 'r-wild', type: 'remedy', color: 'wild', count: 2, nameKey: 'c.r-wild' },
	{ id: 's-swap', type: 'special', specialKind: 'swapPiece', count: 3, nameKey: 'c.s-swap' },
	{ id: 's-steal', type: 'special', specialKind: 'stealPiece', count: 3, nameKey: 'c.s-steal' },
	{ id: 's-plague', type: 'special', specialKind: 'plague', count: 2, nameKey: 'c.s-plague' },
	{ id: 's-scrap', type: 'special', specialKind: 'scrapHands', count: 1, nameKey: 'c.s-scrap' },
	{ id: 's-fullswap', type: 'special', specialKind: 'fullSwap', count: 1, nameKey: 'c.s-fullswap' },
	// The expansion: resistant damage, the potent answer, an inert piece and the three
	// treatments the engine grew for them.
	{ id: 'p-grey', type: 'piece', color: 'grey', inert: true, count: 1, nameKey: 'c.p-grey' },
	{ id: 'x-red', type: 'attack', color: 'red', resistant: true, count: 2, nameKey: 'c.x-red' },
	{ id: 'e-red', type: 'remedy', color: 'red', potent: true, count: 1, nameKey: 'c.e-red' },
	{ id: 's-exile', type: 'special', specialKind: 'exile', count: 4, nameKey: 'c.s-exile' },
	{ id: 's-double', type: 'special', specialKind: 'doubleAct', count: 2, nameKey: 'c.s-double' },
	{ id: 's-handswap', type: 'special', specialKind: 'handSwap', count: 2, nameKey: 'c.s-handswap' },
	{ id: 's-guard', type: 'special', specialKind: 'guard', count: 4, nameKey: 'c.s-guard' },
];

const inst = (cardId: string, n = 0) => ({ instanceId: `${cardId}@${n}`, cardId });

function slot(color: string, over: Partial<AssemblySlot> = {}): AssemblySlot {
	return { color, piece: inst(`p-${color === 'wild' ? 'wild' : color}`, 9), afflictions: [], shields: [], ...over };
}

function seat(id: string, hand: string[] = [], slots: AssemblySlot[] = []): AssemblySeatState {
	return { playerId: id, hand: hand.map(inst), handCount: hand.length, slots };
}

function game(seats: AssemblySeatState[]): GameState {
	return {
		gameType: 'assembly',
		assembly: { seats, drawPile: [], drawCount: 30, discardPile: [], discardCount: 4 },
		assemblyDeck: DECK,
		assemblyRules: { handSize: 3, slotsToWin: 4, maxDiscard: 3 },
		players: seats.map(s => ({ id: s.playerId, name: `N-${s.playerId}` })),
		currentTurn: 'me',
	} as unknown as GameState;
}

const t = (key: string, vars?: Record<string, unknown>) =>
	vars && Object.keys(vars).length ? `${key}(${Object.values(vars).join('|')})` : key;

test('deckColors: the distinct system colours in deck order, wilds excluded (colour-sort rank)', () => {
	const gs = game([seat('me')]);
	// The armoured piece brings a system colour of its own, and it ranks with the rest.
	assert.deepEqual(deckColors(gs), ['red', 'green', 'blue', 'grey']);
});

test('a retired seat is out of the game: no fullSwap target, and its status says the exit', () => {
	const ghost = seat('r1');
	(ghost as { retired?: boolean }).retired = true;
	const gs = game([seat('me', ['s-fullswap'], [slot('red')]), ghost]);

	assert.equal(canPlayCard(gs, 'me', 's-fullswap').reasonKey, 'game.assembly_needs_target');
	assert.equal(assemblyStatusText(gs, 'r1', t), 'game.status_retired');
});

test('a piece is playable only while its colour is free', () => {
	const gs = game([seat('me', ['p-red'], [slot('red')]), seat('r1')]);
	assert.equal(canPlayCard(gs, 'me', 'p-red').reasonKey, 'game.assembly_color_taken');
	assert.equal(canPlayCard(gs, 'me', 'p-green').playable, true);
});

test('an attack is playable while SOME rival slot can take it — locked ones cannot', () => {
	const locked = slot('red', { shields: [inst('r-red', 1), inst('r-red', 2)] });
	const gs = game([seat('me', ['a-red']), seat('r1', [], [locked]), seat('r2', [], [slot('green')])]);
	// r1's red is locked and r2 has no red: only the wild attack could land on r2.
	assert.equal(canPlayCard(gs, 'me', 'a-red').reasonKey, 'game.assembly_no_attackable');
	assert.equal(canPlayCard(gs, 'me', 'a-wild').playable, true);
	assert.equal(attackTargets(gs, 'me', DECK.find(c => c.id === 'a-wild')! as never).length, 1);
});

test('a remedy needs an own, non-locked, colour-matching slot', () => {
	const gs = game([seat('me', ['r-red'], [slot('green')]), seat('r1')]);
	assert.equal(canPlayCard(gs, 'me', 'r-red').reasonKey, 'game.assembly_nothing_to_fix');
	assert.equal(canPlayCard(gs, 'me', 'r-wild').playable, true);
	assert.equal(
		remedySlots(DECK.find(c => c.id === 'r-wild')! as never, gs.assembly!.seats[0], assemblyCatalog(gs)).length,
		1);
});

test('swap pairs refuse locked slots and colour duplicates', () => {
	const me = seat('me', ['s-swap'], [slot('red'), slot('green')]);
	const rival = seat('r1', [], [slot('red'), slot('blue')]);
	const gs = game([me, rival]);

	// My green ↔ their blue: legal (no duplicates created).
	assert.equal(canSwapPair(me, me.slots[1], rival, rival.slots[1]), true);
	// My green ↔ their red: I would end with two reds.
	assert.equal(canSwapPair(me, me.slots[1], rival, rival.slots[0]), false);
	// Same colour swap is always fine.
	assert.equal(canSwapPair(me, me.slots[0], rival, rival.slots[0]), true);
	assert.equal(canPlayCard(gs, 'me', 's-swap').playable, true);
	assert.equal(swapTargets(gs, 'me').length, 1);
});

test('steal needs a rival slot of a colour I lack', () => {
	const gs = game([seat('me', ['s-steal'], [slot('red')]), seat('r1', [], [slot('red')])]);
	assert.equal(canPlayCard(gs, 'me', 's-steal').reasonKey, 'game.assembly_nothing_to_steal');

	const gs2 = game([seat('me', ['s-steal'], [slot('red')]), seat('r1', [], [slot('green')])]);
	assert.equal(canPlayCard(gs2, 'me', 's-steal').playable, true);
	assert.equal(stealTargets(gs2, 'me')[0].slots[0].color, 'green');
});

test('the plague needs one of my afflictions AND a clean matching rival slot', () => {
	const afflicted = slot('red', { afflictions: [inst('a-red', 1)] });
	const gs = game([seat('me', ['s-plague'], [afflicted]), seat('r1', [], [slot('red')])]);
	assert.equal(plagueHasMoves(gs, 'me'), true);
	assert.equal(canPlayCard(gs, 'me', 's-plague').playable, true);

	// Their only red is shielded (not clean): nothing to spread.
	const shielded = slot('red', { shields: [inst('r-red', 1)] });
	const gs2 = game([seat('me', ['s-plague'], [afflicted]), seat('r1', [], [shielded])]);
	assert.equal(canPlayCard(gs2, 'me', 's-plague').reasonKey, 'game.assembly_nothing_to_spread');
});

test('scrapping hands needs a rival with cards', () => {
	const gs = game([seat('me', ['s-scrap']), seat('r1', ['p-red'])]);
	assert.equal(canPlayCard(gs, 'me', 's-scrap').playable, true);

	const gs2 = game([seat('me', ['s-scrap']), seat('r1')]);
	assert.equal(canPlayCard(gs2, 'me', 's-scrap').reasonKey, 'game.assembly_no_hands_to_scrap');
});

test('functional colours: afflicted slots do not count, a wild fills a missing colour', () => {
	const s = seat('me', [], [
		slot('red'), slot('green', { afflictions: [inst('a-red', 1)] }), slot('wild'),
	]);
	assert.equal(functionalColors(s), 2); // red + wild; the broken green counts nothing
});

// Live-play request: per-card Help. The engine composes it from the card's data (an attack
// names the SYSTEM it breaks — the matching piece's own name); a package can override any
// card's text with a `<nameKey>_help` i18n key.
test('card help: an attack names its system, specials get their own text', () => {
	const gs = game([seat('me'), seat('r1')]);
	assert.equal(assemblyCardHelp(gs, 'a-red', t), 'game.assembly_help_attack(c.p-red)');
	assert.equal(assemblyCardHelp(gs, 'a-wild', t), 'game.assembly_help_attack(game.assembly_help_any_system)');
	assert.equal(assemblyCardHelp(gs, 'r-red', t), 'game.assembly_help_remedy(c.p-red)');
	assert.equal(assemblyCardHelp(gs, 'p-red', t), 'game.assembly_help_piece(4)');
	assert.equal(assemblyCardHelp(gs, 'p-wild', t), 'game.assembly_help_piece_wild(4)');
	assert.equal(assemblyCardHelp(gs, 's-plague', t), 'game.assembly_help_plague');
});

test('card help: a package override wins over the engine text', () => {
	const gs = game([seat('me'), seat('r1')]);
	// A translator that RESOLVES the override key (≠ the key itself) simulates a package
	// that wrote its own cards.<id>_help entry.
	const withOverride = (key: string, vars?: Record<string, unknown>) =>
		key === 'c.a-red_help' ? 'La sobrecarga frita el reactor.' : t(key, vars);
	assert.equal(assemblyCardHelp(gs, 'a-red', withOverride), 'La sobrecarga frita el reactor.');
});

test('the status line tells progress, each slot with its state, and a SHORT hand', () => {
	const s = seat('me', ['p-red', 'r-red'], [
		slot('red'),
		slot('green', { afflictions: [inst('a-red', 1)] }),
		slot('blue', { shields: [inst('r-red', 1), inst('r-red', 2)] }),
	]);
	const gs = game([s, seat('r1')]);

	const status = assemblyStatusText(gs, 'me', t)!;

	assert.ok(status.startsWith('game.assembly_status_progress(2|4)'));
	assert.ok(status.includes('c.p-red (game.assembly_state_ok)'));
	assert.ok(status.includes('c.p-green (game.assembly_state_afflicted)'));
	assert.ok(status.includes('c.p-blue (game.assembly_state_locked)'));
	assert.ok(status.endsWith('game.assembly_status_cards(2)'));
});

// Live-play request: a full hand is the NORM (the refill tops everyone back up), so
// saying "3 cartas" on every status was noise — the count only speaks as the exception.
test('a full hand stays silent; an empty one says so in words', () => {
	const full = seat('me', ['p-red', 'r-red', 'a-red'], [slot('red')]);
	const scrapped = seat('r1', [], [slot('green')]);
	const gs = game([full, scrapped]);

	assert.ok(!assemblyStatusText(gs, 'me', t)!.includes('assembly_status_cards'),
		'the normal hand size is not repeated on every status');
	assert.ok(assemblyStatusText(gs, 'r1', t)!.endsWith('game.assembly_status_no_cards'),
		'an emptied hand (post-scrap) is called out in words, never a bare zero');
});

// ── The expansion ────────────────────────────────────────────────────────────

test('an inert piece takes neither attacks nor repairs, and is no plague destination', () => {
	const gs = game([
		seat('me', ['a-wild', 's-plague'], [slot('red', { afflictions: [inst('a-red', 1)] })]),
		seat('r1', [], [slot('grey', { inert: true })]),
	]);

	assert.equal(canPlayCard(gs, 'me', 'a-wild').reasonKey, 'game.assembly_no_attackable');
	assert.equal(plagueHasMoves(gs, 'me'), false);

	const mine = game([seat('me', ['r-wild'], [slot('grey', { inert: true })]), seat('r1')]);
	assert.equal(canPlayCard(mine, 'me', 'r-wild').reasonKey, 'game.assembly_nothing_to_fix');
});

test('resistant damage refuses an ordinary repair and yields to a potent one', () => {
	const damaged = slot('red', { afflictions: [inst('x-red', 1)] });
	const gs = game([seat('me', ['r-red', 'e-red'], [damaged]), seat('r1')]);
	const catalog = assemblyCatalog(gs);

	assert.equal(remedySlots(DECK.find(c => c.id === 'r-red')! as never, gs.assembly!.seats[0], catalog).length, 0);
	assert.equal(canPlayCard(gs, 'me', 'r-red').reasonKey, 'game.assembly_nothing_to_fix');
	assert.equal(remedySlots(DECK.find(c => c.id === 'e-red')! as never, gs.assembly!.seats[0], catalog).length, 1);
	assert.equal(canPlayCard(gs, 'me', 'e-red').playable, true);
});

test('a sealed piece reads as locked, so nothing may be thrown at it', () => {
	const sealed = slot('red', { shields: [inst('e-red', 2)], sealed: true });
	assert.equal(isLocked(sealed), true);

	const gs = game([seat('me', ['a-red']), seat('r1', [], [sealed])]);
	assert.equal(attackTargets(gs, 'me', DECK.find(c => c.id === 'a-red')! as never).length, 0);
	assert.equal(canPlayCard(gs, 'me', 'a-red').reasonKey, 'game.assembly_no_attackable');
});

test('exile reaches every damaged piece on the table, my own rack included', () => {
	const gs = game([
		seat('me', ['s-exile'], [slot('red', { afflictions: [inst('x-red', 1)] }), slot('green')]),
		seat('r1', [], [slot('blue', { afflictions: [inst('a-red', 3)] })]),
	]);

	const targets = exileTargets(gs);
	assert.deepEqual(targets.map(t2 => t2.seat.playerId), ['me', 'r1']);
	assert.deepEqual(targets[0].slots.map(s2 => s2.color), ['red']); // the clean green one is out
	assert.equal(canPlayCard(gs, 'me', 's-exile').playable, true);

	const clean = game([seat('me', ['s-exile'], [slot('red')]), seat('r1')]);
	assert.equal(canPlayCard(clean, 'me', 's-exile').reasonKey, 'game.assembly_nothing_to_exile');
});

test('the turn-extending treatments need something to spend and someone to trade with', () => {
	const alone = game([seat('me', ['s-double']), seat('r1')]);
	assert.equal(canPlayCard(alone, 'me', 's-double').reasonKey, 'game.assembly_nothing_left_to_play');

	const stocked = game([seat('me', ['s-double', 'p-red']), seat('r1')]);
	assert.equal(canPlayCard(stocked, 'me', 's-double').playable, true);

	// A hand trade only needs a live rival to trade with — an empty hand is still a trade.
	assert.equal(canPlayCard(stocked, 'me', 's-handswap').playable, true);
	const ghost = seat('r1');
	(ghost as { retired?: boolean }).retired = true;
	assert.equal(
		canPlayCard(game([seat('me', ['s-handswap']), ghost]), 'me', 's-handswap').reasonKey,
		'game.assembly_needs_target');
});

test('card help describes what the expansion changed, not the plain card', () => {
	const gs = game([seat('me')]);
	assert.equal(assemblyCardHelp(gs, 'x-red', t), 'game.assembly_help_attack_resistant(c.p-red)');
	assert.equal(assemblyCardHelp(gs, 'e-red', t), 'game.assembly_help_remedy_potent(c.p-red)');
	assert.equal(assemblyCardHelp(gs, 'p-grey', t), 'game.assembly_help_piece_inert');
	assert.equal(assemblyCardHelp(gs, 's-exile', t), 'game.assembly_help_exile');
	assert.equal(assemblyCardHelp(gs, 's-double', t), 'game.assembly_help_doubleact');
	assert.equal(assemblyCardHelp(gs, 's-handswap', t), 'game.assembly_help_handswap');
});

test('the status line counts each slot state, sealed pieces included', () => {
	const gs = game([seat('me', ['p-red'], [
		slot('red', { shields: [inst('e-red', 2)], sealed: true }),
		slot('grey', { inert: true }),
		slot('green', { afflictions: [inst('x-red', 1)] }),
	])]);

	const line = assemblyStatusText(gs, 'me', t)!;
	// Sealed and inert pieces are functional; only the damaged one is not.
	assert.match(line, /game\.assembly_status_progress\(2\|4\)/);
	assert.match(line, /game\.assembly_state_locked/);   // the sealed piece reads as secured
	assert.match(line, /game\.assembly_state_afflicted/);
	assert.equal(functionalColors(gs.assembly!.seats[0]), 2);
});

// ── The shield ───────────────────────────────────────────────────────────────

/** A game with a card hanging over the table, waiting on `awaiting` to answer. */
function pendingGame(
	seats: AssemblySeatState[],
	pending: Record<string, unknown>,
): GameState {
	const gs = game(seats);
	gs.assembly!.pendingPlay = {
		actorId: 'me',
		card: inst('a-red', 7),
		cardId: 'a-red',
		targetPlayerId: null,
		targetColor: null,
		giveColor: null,
		awaitingGuard: [],
		shielded: [],
		awaitingRetarget: false,
		...pending,
	} as never;
	return gs;
}

test('a shield is never a move of my own turn', () => {
	const gs = game([seat('me', ['s-guard']), seat('r1')]);
	assert.equal(canPlayCard(gs, 'me', 's-guard').reasonKey, 'game.assembly_guard_off_turn');
	assert.equal(assemblyCardHelp(gs, 's-guard', t), 'game.assembly_help_guard');
});

test('the shield prompt is offered to the player being asked, and to nobody else', () => {
	const gs = pendingGame(
		[seat('me', ['a-red']), seat('r1', ['s-guard', 'p-red'], [slot('red')])],
		{ targetPlayerId: 'r1', targetColor: 'red', awaitingGuard: ['r1'] });

	assert.equal(awaitedShieldFrom(gs), 'r1');
	assert.deepEqual(myShieldCards(gs, 'r1'), ['s-guard@0']);
	assert.deepEqual(myShieldCards(gs, 'me'), []);
	assert.equal(mustRetarget(gs, 'me'), false);
});

test('while the actor must re-aim, nobody is being asked to shield', () => {
	const gs = pendingGame(
		[seat('me'), seat('r1', [], [slot('red')]), seat('r2', [], [slot('red')])],
		{ awaitingRetarget: true, shielded: ['r1'] });

	assert.equal(awaitedShieldFrom(gs), null);
	assert.equal(mustRetarget(gs, 'me'), true);
	assert.equal(mustRetarget(gs, 'r1'), false);
});

test('re-aiming skips whoever shielded and offers my own rack only for an attack', () => {
	const gs = pendingGame([
		seat('me', [], [slot('red')]),
		seat('r1', [], [slot('red')]),
		seat('r2', [], [slot('red')]),
	], { cardId: 'a-red', awaitingRetarget: true, shielded: ['r1'] });

	const options = retargetOptions(gs, 'me');
	const seats = options.map(o => o.seat.playerId);
	assert.equal(seats.includes('r1'), false); // they already shielded
	assert.equal(seats.includes('r2'), true);
	assert.equal(seats.includes('me'), true);  // the rules force this when nothing else is left

	// A steal is a no-op against myself, so my own rack is not an option for it.
	const steal = pendingGame([
		seat('me', [], [slot('red')]),
		seat('r1', [], [slot('green')]),
	], { cardId: 's-steal', awaitingRetarget: true, shielded: [] });
	assert.deepEqual(retargetOptions(steal, 'me').map(o => o.seat.playerId), ['r1']);
});
