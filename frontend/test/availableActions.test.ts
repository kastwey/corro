import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAvailableActions, type ActionContext, type ActionDescriptor } from '../src/actions/availableActions.js';

// computeAvailableActions is pure (no DOM, no game side effects), so it is exhaustively
// testable from plain context snapshots. These tests pin the contextual visibility rules
// of the action bar: holding options, the roll/buy/end-turn flow, management actions, the
// "stand aside while a dedicated modal owns the interaction" rule, and the disabled
// (aria-disabled + spoken reason) states of buy / end-turn.

function ctx(overrides: Partial<ActionContext> = {}): ActionContext {
	return {
		isMyTurn: true,
		hasRolled: false,
		mustRollAgain: false,
		held: false,
		releasePasses: 0,
		pendingPurchaseForMe: false,
		canAffordPending: false,
		activeAuctionForMe: false,
		incomingTrade: false,
		myPendingTrade: false,
		hasDebt: false,
		ownsProperties: false,
		otherPlayers: false,
		...overrides,
	};
}

const ids = (c: ActionContext) => computeAvailableActions(c).map(a => a.id);
const byId = (c: ActionContext, id: string): ActionDescriptor | undefined =>
	computeAvailableActions(c).find(a => a.id === id);


test('not my turn with no holdings: no actions', () => {
	assert.deepEqual(ids(ctx({ isMyTurn: false })), []);
});

test('my turn before rolling: rollDice is offered', () => {
	assert.deepEqual(ids(ctx()), ['rollDice']);
});

test('my turn after rolling: endTurn is offered instead of rollDice', () => {
	assert.deepEqual(ids(ctx({ hasRolled: true })), ['endTurn']);
});

test('in holding before rolling: pay the release cost offered, release pass only when held', () => {
	assert.deepEqual(ids(ctx({ held: true })), ['payReleaseCost', 'rollDice']);
	assert.deepEqual(
		ids(ctx({ held: true, releasePasses: 1 })),
		['payReleaseCost', 'useReleasePass', 'rollDice'],
	);
});

test('holding options are not offered after the player has rolled', () => {
	assert.deepEqual(ids(ctx({ held: true, releasePasses: 1, hasRolled: true })), ['endTurn']);
});

test('holding options are not offered on another player\'s turn', () => {
	assert.deepEqual(ids(ctx({ isMyTurn: false, held: true, releasePasses: 1 })), []);
});

test('managing properties is offered off-turn, but proposing a trade is not (it is turn-bound)', () => {
	// Mortgaging/building/selling are not turn-bound, so they stay available on others' turns;
	// proposing a trade is turn-bound on the server, so the bar withholds it off-turn (the
	// players panel already does the same, and the server would reject an off-turn proposal).
	const offTurn = ids(ctx({ isMyTurn: false, ownsProperties: true, otherPlayers: true }));
	assert.deepEqual(offTurn, ['manageProperties']);
	assert.ok(!offTurn.includes('proposeTrade'), 'no trade action off-turn');

	// On my turn it joins the management actions.
	assert.ok(ids(ctx({ isMyTurn: true, otherPlayers: true })).includes('proposeTrade'), 'offered on my turn');
});

test('full turn snapshot keeps a stable order', () => {
	assert.deepEqual(
		ids(ctx({ held: true, releasePasses: 1, ownsProperties: true, otherPlayers: true })),
		['payReleaseCost', 'useReleasePass', 'rollDice', 'manageProperties', 'proposeTrade'],
	);
});

// --- Doubles re-roll ------------------------------------------------------

test('owed a doubles re-roll: rollDice stays offered alongside a disabled endTurn', () => {
	const c = ctx({ hasRolled: true, mustRollAgain: true });
	assert.deepEqual(ids(c), ['rollDice', 'endTurn']);
	assert.equal(byId(c, 'endTurn')?.disabledReasonKey, 'game.actions.cannot_end_must_roll');
});

// --- Buy as a turn action -------------------------------------------------

test('pending purchase I can afford: buyProperty offered enabled, plus endTurn', () => {
	const c = ctx({ hasRolled: true, pendingPurchaseForMe: true, canAffordPending: true });
	assert.deepEqual(ids(c), ['buyProperty', 'endTurn']);
	assert.equal(byId(c, 'buyProperty')?.disabledReasonKey, undefined);
});

test('pending purchase I cannot afford: buyProperty shown disabled with spoken reason', () => {
	const c = ctx({ hasRolled: true, pendingPurchaseForMe: true, canAffordPending: false });
	assert.equal(byId(c, 'buyProperty')?.disabledReasonKey, 'game.actions.cannot_buy_no_money');
});

test('pending purchase does NOT make the toolbar stand aside', () => {
	const c = ctx({ hasRolled: true, pendingPurchaseForMe: true, ownsProperties: true });
	assert.ok(ids(c).includes('buyProperty'));
	assert.ok(ids(c).includes('manageProperties'));
});

// --- Debt -----------------------------------------------------------------

test('in debt after rolling: endTurn shown disabled with a spoken reason, management stays available', () => {
	const c = ctx({ hasRolled: true, hasDebt: true, ownsProperties: true });
	assert.equal(byId(c, 'endTurn')?.disabledReasonKey, 'game.actions.cannot_end_debt');
	assert.ok(ids(c).includes('manageProperties'));
});

test('debt does NOT make the toolbar stand aside', () => {
	const c = ctx({ hasRolled: true, hasDebt: true, ownsProperties: true, otherPlayers: true });
	assert.notDeepEqual(ids(c), []);
});

test('must-roll-again takes priority over debt in the end-turn reason', () => {
	const c = ctx({ hasRolled: true, mustRollAgain: true, hasDebt: true });
	assert.equal(byId(c, 'endTurn')?.disabledReasonKey, 'game.actions.cannot_end_must_roll');
});

// --- Movement still settling (my token is mid-hop) ------------------------

test('while my token is hopping, the landing-driven actions are withheld', () => {
	// I just rolled; my token is still travelling to the square. The roll itself is gone
	// (hasRolled) and buy / end-turn must wait for the token to land, in step with the
	// gated money reveal — so the turn-flow part of the bar is empty.
	assert.deepEqual(ids(ctx({ hasRolled: true, movementSettling: true })), []);
});

test('while my token is hopping, a pending purchase is not offered yet', () => {
	const c = ctx({ hasRolled: true, pendingPurchaseForMe: true, canAffordPending: true, movementSettling: true });
	assert.deepEqual(ids(c), []);
});

test('settling withholds holding/roll options before the roll resolves', () => {
	assert.deepEqual(ids(ctx({ held: true, releasePasses: 1, movementSettling: true })), []);
});

test('settling does NOT hide management actions (they are not roll consequences)', () => {
	const c = ctx({ hasRolled: true, pendingPurchaseForMe: true, ownsProperties: true, otherPlayers: true, movementSettling: true });
	assert.deepEqual(ids(c), ['manageProperties', 'proposeTrade']);
});

test('once the token lands (movementSettling false) the landing actions return', () => {
	const c = ctx({ hasRolled: true, pendingPurchaseForMe: true, canAffordPending: true, movementSettling: false });
	assert.deepEqual(ids(c), ['buyProperty', 'endTurn']);
});

// --- Modal-owns-interaction blockers --------------------------------------

for (const blocker of ['incomingTrade', 'myPendingTrade'] as const) {
	test(`toolbar stands aside while ${blocker} owns the interaction`, () => {
		const c = ctx({ ownsProperties: true, otherPlayers: true, [blocker]: true });
		assert.deepEqual(ids(c), []);
	});
}

test('an active auction surfaces only the reenter-auction action', () => {
	// While I'm still in an auction the bidding modal owns the interaction, but if I
	// dismissed it by accident the toolbar must offer a single way back in rather than
	// leaving me stranded with an empty bar.
	const c = ctx({ ownsProperties: true, otherPlayers: true, activeAuctionForMe: true });
	assert.deepEqual(ids(c), ['reenterAuction']);
});

test('descriptors carry an i18n labelKey and are fresh copies', () => {
	const a = computeAvailableActions(ctx());
	const b = computeAvailableActions(ctx());
	assert.equal(a[0].labelKey, 'game.actions.roll_dice');
	assert.notEqual(a[0], b[0]); // distinct objects, safe to mutate per render
});


// ── deriveActionContext (state → context) ────────────────────────────────────
// The derivation of ActionContext from the authoritative game state used to be inline in app.ts;
// pulled into a pure helper so the flag logic is testable directly.
import { deriveActionContext } from '../src/actions/availableActions.js';
import type { GameState, Player } from '../src/models.js';

const me = (over: Partial<Player> = {}): Player =>
	({ id: 'me', name: 'Me', money: 1000, properties: [], releasePasses: 0, ...over } as Player);
const state = (over: Partial<GameState> = {}): GameState => (over as GameState);

test('deriveActionContext: it is my turn, first roll, no landing', () => {
	const c = deriveActionContext(state({ currentTurn: 'me' }), 'me', me(), 1, false);
	assert.equal(c.isMyTurn, true);
	assert.equal(c.hasRolled, false);
	assert.equal(c.otherPlayers, true);
	assert.equal(c.movementSettling, false);
});

test('deriveActionContext: a pending purchase for me flags affordability from my money', () => {
	const gs = state({ currentTurn: 'me', pendingPurchase: { playerId: 'me', squareIndex: 3, squareName: 'X', price: 600 } as any });
	const rich = deriveActionContext(gs, 'me', me({ money: 800 }), 1, false);
	const poor = deriveActionContext(gs, 'me', me({ money: 500 }), 1, false);
	assert.equal(rich.pendingPurchaseForMe, true);
	assert.equal(rich.canAffordPending, true);
	assert.equal(poor.canAffordPending, false);
});

test('deriveActionContext: a purchase pending for ANOTHER player is not mine', () => {
	const gs = state({ pendingPurchase: { playerId: 'other', squareIndex: 3, squareName: 'X', price: 60 } as any });
	const c = deriveActionContext(gs, 'me', me(), 1, false);
	assert.equal(c.pendingPurchaseForMe, false);
	assert.equal(c.canAffordPending, false);
});

test('deriveActionContext: an auction I have already passed is not active for me', () => {
	const active = deriveActionContext(state({ activeAuction: { isActive: true, passedPlayers: [] } as any }), 'me', me(), 1, false);
	const passed = deriveActionContext(state({ activeAuction: { isActive: true, passedPlayers: ['me'] } as any }), 'me', me(), 1, false);
	assert.equal(active.activeAuctionForMe, true);
	assert.equal(passed.activeAuctionForMe, false);
});

test('deriveActionContext: distinguishes an incoming trade from one I proposed', () => {
	const incoming = deriveActionContext(state({ activeTrade: { isActive: true, targetId: 'me', initiatorId: 'other' } as any }), 'me', me(), 1, false);
	const mine = deriveActionContext(state({ activeTrade: { isActive: true, targetId: 'other', initiatorId: 'me' } as any }), 'me', me(), 1, false);
	assert.equal(incoming.incomingTrade, true);
	assert.equal(incoming.myPendingTrade, false);
	assert.equal(mine.myPendingTrade, true);
	assert.equal(mine.incomingTrade, false);
});

test('deriveActionContext: holding, debt, ownership and token-still-moving flags', () => {
	const gs = state({ currentTurn: 'me', pendingDebts: [{ debtorId: 'me', amount: 50 } as any] });
	const c = deriveActionContext(gs, 'me', me({ isHeld: true, releasePasses: 2, properties: [1, 3] }), 0, true);
	assert.equal(c.held, true);
	assert.equal(c.releasePasses, 2);
	assert.equal(c.hasDebt, true);
	assert.equal(c.ownsProperties, true);
	assert.equal(c.otherPlayers, false);
	assert.equal(c.movementSettling, true);
});

test('deriveActionContext: no game state / not identified is inert (not my turn)', () => {
	const c = deriveActionContext(null, null, null, 0, false);
	assert.equal(c.isMyTurn, false);
	assert.equal(c.ownsProperties, false);
	assert.equal(c.otherPlayers, false);
});


// ── Forfeit guards: which key carries the "you could still buy this" confirm ──────────────────
// Standing on a buyable property you haven't bought, the turn-ADVANCING key forfeits it. Which key
// that is depends on doubles, so the confirmation follows the key: End turn normally, but Roll (the
// owed re-roll) when doubles mean Enter can't end the turn.
import { rollForfeitGuard, endTurnForfeitGuard } from '../src/actions/availableActions.js';

test('no pending purchase: neither key needs a confirm', () => {
	assert.equal(rollForfeitGuard(false, false), 'none');
	assert.equal(rollForfeitGuard(false, true), 'none');   // an owed re-roll that didn't land on a buyable
	assert.equal(endTurnForfeitGuard(false, false), 'none');
	assert.equal(endTurnForfeitGuard(false, true), 'none');
});

test('buyable pending, no doubles: Enter ends the turn and carries the confirm; Space does not', () => {
	assert.equal(endTurnForfeitGuard(true, false), 'confirm');
	assert.equal(rollForfeitGuard(true, false), 'none');
});

test('buyable pending, doubles owed: the confirm moves to Roll (Space); Enter is blocked', () => {
	// Enter can't end the turn (a re-roll is owed), so it must not show the forfeit dialog — it
	// reports the reason instead. Rolling again is what forfeits, so Roll carries the confirm.
	assert.equal(endTurnForfeitGuard(true, true), 'blocked');
	assert.equal(rollForfeitGuard(true, true), 'confirm');
});

// ── Race family ───────────────────────────────────────────────────────────────

test('race mode collapses the toolbar to Roll on my turn', () => {
	const actions = computeAvailableActions({
		isMyTurn: true, hasRolled: false, mustRollAgain: false, held: false,
		releasePasses: 0, pendingPurchaseForMe: false, canAffordPending: false,
		activeAuctionForMe: false, incomingTrade: false, myPendingTrade: false,
		hasDebt: false, ownsProperties: false, otherPlayers: true,
		rollOnlyFamily: true, racePendingChoice: false,
	});
	assert.deepEqual(actions.map(a => a.id), ['rollDice']);
});

test('race mode hides the toolbar while a piece choice is pending or off-turn', () => {
	const base = {
		hasRolled: false, mustRollAgain: false, held: false, releasePasses: 0,
		pendingPurchaseForMe: false, canAffordPending: false, activeAuctionForMe: false,
		incomingTrade: false, myPendingTrade: false, hasDebt: false,
		ownsProperties: false, otherPlayers: true, rollOnlyFamily: true,
	};
	assert.deepEqual(computeAvailableActions({ ...base, isMyTurn: true, racePendingChoice: true }), []);
	assert.deepEqual(computeAvailableActions({ ...base, isMyTurn: false, racePendingChoice: false }), []);
});

test('race/track: the roll waits while the previous move is still being told', () => {
	// A track slide (or race auto-move) can hand me the turn while its animation and queued
	// segments are still playing on MY client: the roll must appear only once the story
	// settles, so I never act before hearing how the previous move ended.
	const base = {
		isMyTurn: true, hasRolled: false, mustRollAgain: false, held: false,
		releasePasses: 0, pendingPurchaseForMe: false, canAffordPending: false,
		activeAuctionForMe: false, incomingTrade: false, myPendingTrade: false,
		hasDebt: false, ownsProperties: false, otherPlayers: true,
		rollOnlyFamily: true, racePendingChoice: false,
	};
	assert.deepEqual(computeAvailableActions({ ...base, movementSettling: true }), []);
	assert.deepEqual(
		computeAvailableActions({ ...base, movementSettling: false }).map(a => a.id),
		['rollDice'],
	);
});
