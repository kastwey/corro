// squareMenu.ts — Pure logic that decides which contextual actions a board square offers
// the local player (build / sell / mortgage / unmortgage / buy). It is opened from the board
// with the Shift+I shortcut or a click on the square (see app.ts). The server stays
// authoritative and validates every action; this only offers the contextually plausible
// ones and pre-computes affordability so an unaffordable action can be shown disabled with a
// reason. No DOM/i18next here so it can be unit-tested directly.

import type { Square, PendingPurchase } from './models.js';
import { ownsWholeColorGroup } from './gameCommands.js';
import { isOwnableSquare } from './squareBehavior.js';

export type SquareMenuActionId =
	| 'build' | 'sellHotel' | 'sellHouse' | 'mortgage' | 'unmortgage' | 'buy';

export interface SquareMenuAction {
	id: SquareMenuActionId;
	/** False when the player can't afford it; the menu shows it aria-disabled with the reason. */
	enabled: boolean;
	/** When disabled, the i18n key + vars describing why (e.g. how much money is missing). */
	reasonKey?: string;
	reasonVars?: Record<string, any>;
	/** The price/value shown in the action's label. */
	amount: number;
	/** For 'build' only: true when the lot already has all its small constructions, so the next
	 *  build is the big one. */
	big?: boolean;
}

export interface SquareMenuContext {
	squares: Square[];
	index: number;
	myId: string | null;
	currentTurn: string | null;
	myMoney: number;
	pendingPurchase: PendingPurchase | null;
}

/** Bank pays 50% of face value to mortgage (mirrors the server's MortgageRate). */
const MORTGAGE_RATE = 0.5;
/** Lifting a mortgage costs the mortgage value plus 10% interest (mirrors the manage dialog). */
const UNMORTGAGE_MULTIPLIER = 1.1;

/**
 * Resolve the contextual actions for the square at `ctx.index`. Returns an empty list for
 * squares with no actionable option (non-ownable squares, or properties the player neither
 * owns nor can buy right now); the caller then falls back to the read-only info dialog.
 */
export function squareMenuActions(ctx: SquareMenuContext): SquareMenuAction[] {
	const s = ctx.squares[ctx.index];
	if (!s) return [];
	if (!isOwnableSquare(s)) return [];

	const actions: SquareMenuAction[] = [];
	const houses = s.smallBuildings ?? 0;
	const hotels = s.bigBuildings ?? 0;
	const price = s.price ?? 0;
	const buildingCost = s.buildingCost ?? 0;
	const mortgageValue = Math.floor(price * MORTGAGE_RATE);
	const ownedByMe = !!ctx.myId && s.ownerId === ctx.myId;

	if (ownedByMe) {
		if (s.mortgaged) {
			// A mortgaged property can only be lifted; building/selling are unavailable.
			const cost = Math.floor(mortgageValue * UNMORTGAGE_MULTIPLIER);
			actions.push(affordable({ id: 'unmortgage', amount: cost }, ctx.myMoney, cost));
			return actions;
		}

		// Build: streets only (have a house cost), full colour group, and not yet at the big tier.
		if (ownsWholeColorGroup(ctx.squares, s.color, ctx.myId) && buildingCost > 0 && hotels === 0) {
			// The board's small-construction count is the rent table length minus base and big tiers
			// (length = levels + 2), so the next build becomes the big one once all small ones are up.
			const levels = (s.rent?.length ?? 6) - 2;
			actions.push(affordable(
				{ id: 'build', amount: buildingCost, big: houses >= levels },
				ctx.myMoney, buildingCost));
		}

		// Sell a building (always returns money, so always enabled).
		if (hotels > 0) {
			actions.push({ id: 'sellHotel', amount: Math.floor(buildingCost / 2), enabled: true });
		} else if (houses > 0) {
			actions.push({ id: 'sellHouse', amount: Math.floor(buildingCost / 2), enabled: true });
		}

		// Mortgage only once the lot is clear of buildings.
		if (houses === 0 && hotels === 0) {
			actions.push({ id: 'mortgage', amount: mortgageValue, enabled: true });
		}
		return actions;
	}

	// Buy: unowned, it's my turn, and the server flagged this exact square as my pending purchase.
	if (!s.ownerId) {
		const pp = ctx.pendingPurchase;
		const isMyTurn = !!ctx.myId && ctx.currentTurn === ctx.myId;
		if (isMyTurn && pp && pp.playerId === ctx.myId && pp.squareIndex === ctx.index) {
			actions.push(affordable({ id: 'buy', amount: pp.price }, ctx.myMoney, pp.price));
		}
	}

	return actions;
}

/** Mark an action enabled/disabled by affordability, attaching the shortfall reason when short. */
function affordable(
	base: Omit<SquareMenuAction, 'enabled' | 'reasonKey' | 'reasonVars'>,
	money: number,
	cost: number
): SquareMenuAction {
	if (money >= cost) return { ...base, enabled: true };
	return {
		...base,
		enabled: false,
		reasonKey: 'game.square_menu_need_money',
		reasonVars: { amount: cost - money },
	};
}
