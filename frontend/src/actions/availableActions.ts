import type { GameState, Player } from '../models.js';
import { isRollOnlyFamily, isToolbarlessFamily } from '../familyTraits.js';

// availableActions.ts — Pure, testable computation of the context-sensitive
// list of actions shown in the action bar. This module holds NO DOM and NO game
// side effects: it maps a snapshot of the game context to an ordered list of
// action descriptors. app.ts maps each id to the matching gameManager call.
//
// Scope note: actions driven by a dedicated modal that owns keyboard focus
// (auctions, trades) are NOT surfaced here — while such a modal is open the
// toolbar steps aside and returns an empty list. Buying a property and resolving
// debt do NOT block the toolbar: buying is a turn action, and a player in debt
// must be able to mortgage/sell to raise money, so those actions stay available.
//
// Turn model: the turn NEVER auto-advances. After rolling, the player keeps
// control (buy, manage, trade) and must end the turn explicitly. Some actions are
// shown but disabled (aria-disabled, never the `disabled` attribute) with a spoken
// reason — e.g. "End turn" is disabled until a doubles re-roll is taken.

export type ActionId =
	| 'payReleaseCost'
	| 'useReleasePass'
	| 'rollDice'
	| 'buyProperty'
	| 'endTurn'
	| 'manageProperties'
	| 'proposeTrade'
	| 'reenterAuction';

/**
 * Snapshot of everything the action computation needs. All flags are already
 * resolved by the caller (app.ts) from the authoritative server game state, so
 * this function stays pure and exhaustively testable.
 */
export interface ActionContext {
	/** It is my turn. */
	isMyTurn: boolean;
	/** I have already rolled this turn (server: hasRolledThisTurn). */
	hasRolled: boolean;
	/** I rolled doubles and owe another roll before I may end the turn (server: mustRollAgain). */
	mustRollAgain: boolean;
	/** I am currently in holding. */
	held: boolean;
	/** How many "get out of holding free" cards I hold. */
	releasePasses: number;
	/** There is a pending purchase offer for an unowned property I landed on. */
	pendingPurchaseForMe: boolean;
	/** I can currently afford the pending purchase. */
	canAffordPending: boolean;
	/** An auction is running and I have not passed yet. */
	activeAuctionForMe: boolean;
	/** A trade was proposed TO me and awaits my response. */
	incomingTrade: boolean;
	/** A trade I proposed is awaiting the other party. */
	myPendingTrade: boolean;
	/** I owe money the server is waiting for me to settle. */
	hasDebt: boolean;
	/** I own at least one property (so I can manage / mortgage / build). */
	ownsProperties: boolean;
	/** There is at least one other active player I could trade with. */
	otherPlayers: boolean;
	/**
	 * This client is still TELLING the current action: a token/piece is walking the board
	 * (mine or, on the compound families, whoever's move handed me the turn — the turn
	 * sequencer holds a compound move's later segments exactly while something animates).
	 * While true, the turn-flow actions (buy, end turn, roll, an owed re-roll) are withheld
	 * until the story settles — matching the gated money/announcement reveal — so they
	 * appear together on arrival, never before the player has heard where they landed.
	 * Ambient management actions (manage, trade) are unaffected. Defaults to false.
	 */
	movementSettling?: boolean;
	/** Roll-only families (race, track): the toolbar collapses to "roll", gated on the
	 *  race family's pending piece choice (the track has no player decisions at all). */
	rollOnlyFamily?: boolean;
	/** Toolbar-less families (journey): the whole turn lives in the hand panel, so the
	 *  action bar offers nothing at all. */
	toolbarlessFamily?: boolean;
	racePendingChoice?: boolean;
}

/** A renderable action. `labelKey` is an i18n key. */
export interface ActionDescriptor {
	id: ActionId;
	labelKey: string;
	/** Optional keyboard shortcut spec for aria-keyshortcuts (e.g. "Control+J"). */
	shortcut?: string;
	/**
	 * When set, the action is rendered disabled (aria-disabled) and activating it
	 * speaks this i18n key instead of performing the action. Never removes the
	 * control from the tab order.
	 */
	disabledReasonKey?: string;
}

const DESCRIPTORS: Record<ActionId, ActionDescriptor> = {
	payReleaseCost: { id: 'payReleaseCost', labelKey: 'game.actions.pay_release_cost', shortcut: 'Control+J' },
	useReleasePass: { id: 'useReleasePass', labelKey: 'game.actions.use_release_pass', shortcut: 'Control+Shift+J' },
	rollDice: { id: 'rollDice', labelKey: 'game.actions.roll_dice', shortcut: 'Space' },
	buyProperty: { id: 'buyProperty', labelKey: 'game.actions.buy_property', shortcut: 'Control+B' },
	endTurn: { id: 'endTurn', labelKey: 'game.actions.end_turn', shortcut: 'Control+E' },
	manageProperties: { id: 'manageProperties', labelKey: 'game.actions.manage_properties', shortcut: 'Control+Shift+M' },
	proposeTrade: { id: 'proposeTrade', labelKey: 'game.actions.propose_trade', shortcut: 'Control+T' },
	reenterAuction: { id: 'reenterAuction', labelKey: 'game.actions.reenter_auction', shortcut: 'Control+Shift+B' },
};

/**
 * Derive the {@link ActionContext} from the authoritative server state. Pure (no DOM, no gameManager):
 * app.ts feeds it the raw pieces it reads, so the flag derivation is exhaustively testable. Everything
 * here mirrors "what the toolbar needs to know about the current player and turn".
 */
export function deriveActionContext(
	gs: GameState | null,
	myId: string | null,
	me: Player | null,
	otherPlayerCount: number,
	isMyTokenMoving: boolean,
): ActionContext {
	const isMyTurn = !!myId && gs?.currentTurn === myId;
	const pp = gs?.pendingPurchase ?? null;
	const pendingPurchaseForMe = !!pp && pp.playerId === myId;
	const trade = gs?.activeTrade;
	const auction = gs?.activeAuction;
	const iPassedAuction = !!auction && (auction.passedPlayers ?? []).includes(myId ?? '');
	return {
		isMyTurn,
		hasRolled: !!gs?.hasRolledThisTurn,
		mustRollAgain: !!gs?.mustRollAgain,
		held: !!me?.isHeld,
		releasePasses: me?.releasePasses ?? 0,
		pendingPurchaseForMe,
		canAffordPending: pendingPurchaseForMe && (me?.money ?? 0) >= (pp!.price ?? 0),
		activeAuctionForMe: !!auction?.isActive && !iPassedAuction,
		incomingTrade: !!trade?.isActive && trade.targetId === myId,
		myPendingTrade: !!trade?.isActive && trade.initiatorId === myId,
		hasDebt: (gs?.pendingDebts || []).some(d => d.debtorId === myId),
		ownsProperties: (me?.properties?.length ?? 0) > 0,
		otherPlayers: otherPlayerCount > 0,
		movementSettling: isMyTokenMoving,
		rollOnlyFamily: isRollOnlyFamily(gs?.gameType),
		toolbarlessFamily: isToolbarlessFamily(gs?.gameType),
		racePendingChoice: !!gs?.race?.pendingMove && gs?.race?.pendingMove?.playerId === myId,
	};
}

/**
 * Compute the ordered list of actions available in the given context. While an
 * auction or trade modal owns the interaction the toolbar yields and returns an
 * empty list. Otherwise it surfaces the turn-flow actions, with some shown but
 * disabled (carrying a spoken reason) instead of hidden.
 */
export function computeAvailableActions(ctx: ActionContext): ActionDescriptor[] {
	// Toolbar-less families (journey): draw/play/discard all live in the hand panel — an
	// action bar would only duplicate (and fight for focus with) the hand's own keys.
	if (ctx.toolbarlessFamily) {
		return [];
	}

	// Roll-only families (race, track): the whole turn is roll → (maybe choose a piece) →
	// auto-resolve, so the toolbar offers only the roll — hidden while a race piece choice
	// is pending (the dialog owns it), on other players' turns, and while the previous
	// move's segments are still playing out (a slide can hand me the turn mid-animation;
	// my roll waits until that story finishes). No economy actions exist in these families.
	if (ctx.rollOnlyFamily) {
		return ctx.isMyTurn && !ctx.racePendingChoice && !ctx.movementSettling
			? [{ ...DESCRIPTORS.rollDice }] : [];
	}

	// An auction I'm still in owns the interaction through its own modal. If that
	// modal gets dismissed by accident the toolbar would otherwise be empty and the
	// player could not get back in, so surface a single "reenter auction" action as
	// the way back to the bidding modal (the auction dialog itself stays the source
	// of truth; this just reopens it).
	if (ctx.activeAuctionForMe) {
		return [{ ...DESCRIPTORS.reenterAuction }];
	}
	// A trade modal owns the interaction right now: stand aside.
	if (ctx.incomingTrade || ctx.myPendingTrade) {
		return [];
	}

	const out: ActionDescriptor[] = [];
	const push = (id: ActionId, disabledReasonKey?: string) =>
		out.push(disabledReasonKey ? { ...DESCRIPTORS[id], disabledReasonKey } : { ...DESCRIPTORS[id] });

	// While my token is still hopping to the square I rolled onto, withhold the turn-flow
	// actions tied to that landing (holding exit, roll, buy, end turn): they appear when the
	// token settles, together with the gated money/announcements. Management actions below
	// stay available (they are not consequences of this roll).
	if (ctx.isMyTurn && !ctx.movementSettling) {
		// Holding options (only before I have rolled).
		if (ctx.held && !ctx.hasRolled) {
			push('payReleaseCost');
			if (ctx.releasePasses > 0) {
				push('useReleasePass');
			}
		}

		// Roll: the first roll of the turn, or an owed doubles re-roll.
		if (!ctx.hasRolled || ctx.mustRollAgain) {
			push('rollDice');
		}

		// Buy the property I just landed on. Shown disabled (with a spoken reason)
		// while I can't afford it, so I can mortgage/sell to raise money and then buy.
		if (ctx.pendingPurchaseForMe) {
			push('buyProperty', ctx.canAffordPending ? undefined : 'game.actions.cannot_buy_no_money');
		}

		// End the turn: shown once I have rolled. Disabled (with reason) while I owe
		// a doubles re-roll or still have an unresolved debt.
		if (ctx.hasRolled) {
			let reason: string | undefined;
			if (ctx.mustRollAgain) reason = 'game.actions.cannot_end_must_roll';
			else if (ctx.hasDebt) reason = 'game.actions.cannot_end_debt';
			push('endTurn', reason);
		}
	}

	// Management actions, available whenever no blocking modal is up (including
	// while in debt — mortgaging/selling is how you raise the money you owe).
	if (ctx.ownsProperties) {
		push('manageProperties');
	}
	// Proposing a trade is turn-bound on the server (unlike mortgaging/building/selling), so
	// only offer it on my turn — matching the players panel, and avoiding a dead-end the server
	// would reject with "It is not your turn".
	if (ctx.otherPlayers && ctx.isMyTurn) {
		push('proposeTrade');
	}

	return out;
}

/**
 * What the turn-ADVANCING key should do when you are standing on a property you could still buy but
 * haven't — advancing forfeits it (auction or discard, per the house rule). WHICH key advances the
 * turn depends on doubles, so the confirmation must follow that key:
 *   - no re-roll owed → ENTER ends the turn, so "End turn" carries the confirm.
 *   - a doubles re-roll owed → ENTER can't end the turn; ROLLING AGAIN (Space) is what forfeits the
 *     property, so "Roll" carries the confirm and "End turn" just reports why it can't act.
 * Pure, so app.ts's keyboard/toolbar handlers can be exhaustively tested without a DOM.
 */
export type ForfeitGuard = 'none' | 'confirm' | 'blocked';

/** Rolling again while a still-buyable property is pending forfeits it → confirm first (only the
 *  owed doubles re-roll can reach here with a purchase pending; the first roll of a turn cannot). */
export function rollForfeitGuard(pendingPurchaseForMe: boolean, mustRollAgain: boolean): ForfeitGuard {
	return pendingPurchaseForMe && mustRollAgain ? 'confirm' : 'none';
}

/** Ending the turn while a still-buyable property is pending forfeits it → confirm; but if a doubles
 *  re-roll is owed, End turn can't act at all (the confirm lives on Roll) — reported as 'blocked'. */
export function endTurnForfeitGuard(pendingPurchaseForMe: boolean, mustRollAgain: boolean): ForfeitGuard {
	if (!pendingPurchaseForMe) return 'none';
	return mustRollAgain ? 'blocked' : 'confirm';
}
