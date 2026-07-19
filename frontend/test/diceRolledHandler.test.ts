import test from 'node:test';
import assert from 'node:assert/strict';
import { DiceRolledHandler } from '../src/commands/DiceRolledHandler.js';
import type { CommandContext } from '../src/commands/index.js';
import type { Board } from '../src/board.js';
import type { CommandResponse, DiceRolledResponse, GameState } from '../src/models.js';

/**
 * Regression test for the "stale cursor after rolling" race.
 *
 * Bug: when the local player rolled, the exploration cursor only jumped to the landing
 * square inside a 600 ms setTimeout. During that window the cursor-query shortcuts
 * (AnnounceGroup/Price/Owner, WhoIsOnSquare) read getActiveIndex() and reported the
 * square the player was parked on BEFORE rolling instead of where they just landed.
 *
 * Fix: move the (silent) cursor synchronously when DICE_ROLLED arrives, so the window
 * is closed; only the visual turn/action-bar refresh stays delayed.
 */

interface SetActiveCall { index: number; triggerEvents: boolean; announceMove: boolean; }

function buildContext(myPlayerId: string): {
	context: CommandContext;
	cursorMoves: SetActiveCall[];
	emitted: string[];
	deferredVisuals: Array<() => void>;
	gateCalls: string[];
	runDeferred: () => void;
} {
	const cursorMoves: SetActiveCall[] = [];
	const emitted: string[] = [];
	const deferredVisuals: Array<() => void> = [];
	const gateCalls: string[] = [];
	const board = {
		setActiveIndex: (index: number, triggerEvents = true, announceMove = true) => {
			cursorMoves.push({ index, triggerEvents, announceMove });
		},
	} as unknown as Board;
	const context: CommandContext = {
		gameState: null,
		board,
		myPlayerId,
		announce: () => {},
		emit: (event: string) => { emitted.push(event); },
		updateGameState: () => {},
		// Capture deferred visuals (mirrors the announcement gate buffering them while the
		// token hops) so the test can prove the cursor move is paced, not run immediately.
		deferVisual: (run: () => void) => { gateCalls.push('defer'); deferredVisuals.push(run); },
		armForMove: () => { gateCalls.push('arm'); },
	};
	return {
		context,
		cursorMoves,
		emitted,
		deferredVisuals,
		gateCalls,
		runDeferred: () => { for (const run of deferredVisuals.splice(0)) run(); },
	};
}

function diceRolled(overrides: Partial<DiceRolledResponse> = {}): CommandResponse {
	const base: DiceRolledResponse = {
		type: 'DICE_ROLLED',
		playerId: 'me',
		playerName: 'Me',
		die1: 2,
		die2: 5,
		total: 7,
		isDoubles: false,
		fromPosition: 0,
		toPosition: 7,
		canBuySquare: false,
		canAfford: false,
		...overrides,
	};
	return base as unknown as CommandResponse;
}

test('DICE_ROLLED paces the local cursor move to the token hop, then lands silently', () => {
	const { context, cursorMoves, emitted, runDeferred } = buildContext('me');

	new DiceRolledHandler().handle(diceRolled({ playerId: 'me', toPosition: 7 }), context);

	// While the token is still hopping the cursor stays put — it is deferred, not moved,
	// so a sighted player can't see the highlight reveal the destination ahead of the token.
	assert.deepEqual(cursorMoves, []);

	// Once the hop settles (the gate releases the buffered visuals) the cursor jumps to the
	// landing square, silently (announceMove=false) so it never speaks over the dice line.
	runDeferred();
	assert.deepEqual(cursorMoves, [{ index: 7, triggerEvents: false, announceMove: false }]);
	// The turn/action refresh is still deferred (not emitted synchronously).
	assert.ok(!emitted.includes('gameStateUpdated'));
});

/**
 * Regression test for the "destination ringed while the token still travels" spoiler.
 *
 * The DICE_ROLLED response arrives BEFORE the turn sequencer plays the roll's
 * announcements+state segment, so at handle() time the announcement gate is still
 * unarmed — deferVisual alone would run the cursor move immediately and a sighted
 * player saw the landing square ringed before (and while) the token hopped there.
 * The handler must arm the gate itself, and must do it BEFORE deferring the visual.
 */
test('DICE_ROLLED arms the gate BEFORE deferring the cursor (the response outruns the segment)', () => {
	const { context, gateCalls } = buildContext('me');

	new DiceRolledHandler().handle(diceRolled({ playerId: 'me', toPosition: 7 }), context);

	assert.deepEqual(gateCalls, ['arm', 'defer']);
});

test('DICE_ROLLED for another player does NOT move my exploration cursor', () => {
	const { context, cursorMoves, gateCalls } = buildContext('me');

	new DiceRolledHandler().handle(diceRolled({ playerId: 'rival', toPosition: 20 }), context);

	assert.equal(cursorMoves.length, 0);
	assert.ok(!gateCalls.includes('arm'), 'a rival\'s roll must not arm MY gate speculatively');
});

test('DICE_ROLLED that keeps the player in holding does not move the cursor', () => {
	const { context, cursorMoves, gateCalls } = buildContext('me');

	new DiceRolledHandler().handle(diceRolled({ playerId: 'me', stillHeld: true }), context);

	assert.equal(cursorMoves.length, 0);
	assert.ok(!gateCalls.includes('arm'), 'no movement follows, so nothing must arm the gate');
});

/**
 * A deferred turn refresh must read the live game state rather than the snapshot captured
 * when the response arrived; otherwise a completed state-driven operation can be resurrected.
 */
test('the deferred turn refresh emits the CURRENT game state, not the one captured at response time', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });

	const staleState = { currentTurn: 'rival' } as unknown as GameState;
	const currentState = { currentTurn: 'me' } as unknown as GameState;

	// A LIVE context (getter), mirroring gameManager.createCommandContext: reading
	// `gameState` always returns whatever is current — not the value at handle() time.
	let current: GameState = staleState;
	const emittedStates: Array<GameState | null | undefined> = [];
	const board = { setActiveIndex: () => {} } as unknown as Board;
	const context: CommandContext = {
		get gameState() { return current; },
		board,
		myPlayerId: 'me',
		announce: () => {},
		emit: (event: string, data?: unknown) => {
			if (event === 'gameStateUpdated') emittedStates.push(data as GameState);
		},
		updateGameState: () => {},
		deferVisual: (run: () => void) => run(),
		armForMove: () => {},
	};

	new DiceRolledHandler().handle(diceRolled({ playerId: 'me', toPosition: 13 }), context);

	// A newer authoritative state arrives before the timer fires.
	current = currentState;
	t.mock.timers.tick(600);

	assert.deepEqual(emittedStates, [currentState], 'must emit the live state, not the stale snapshot');
});

