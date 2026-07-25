// busChoice.ts — pure, locale-ready labels for the bonus-die Bus destination picker.

import type { Square } from './models.js';
import { isOwnableSquare } from './squareBehavior.js';

export interface BusDestinationContext {
	fromPosition: number;
	squares: Square[];
	players: { id: string; name: string }[];
	myId: string | null;
	t: (key: string, vars?: Record<string, any>) => string;
}

/** One flowing option: destination, group, owner, buildings and authoritative rent preview. */
export function busDestinationLabel(
	name: string | undefined,
	colorKey: string | undefined,
	spaces: number,
	ctx: BusDestinationContext,
	rentDue?: number,
): string {
	const square = destinationSquare(spaces, ctx);
	// ctx.squares comes from GameManager.getSquares(), so it is already resolved to this
	// listener's locale. The stored/canonical name is only a fallback.
	const destination = square?.name || name || '';
	if (!destination) return '';
	const parts = [colorKey
		? `${destination}${ctx.t('game.bus_color_suffix_colored', { colorKey })}`
		: destination];
	const owner = ownerLabel(square, ctx);
	if (owner) parts.push(owner);
	const buildings = buildingsLabel(square, ctx);
	if (buildings) parts.push(buildings);
	if (rentDue != null && rentDue > 0) {
		parts.push(ctx.t('game.bus_rent_due', { amount: rentDue }));
	}
	return parts.join(', ');
}

function destinationSquare(spaces: number, ctx: BusDestinationContext): Square | undefined {
	if (ctx.squares.length === 0) return undefined;
	const index = ((ctx.fromPosition + spaces) % ctx.squares.length + ctx.squares.length) % ctx.squares.length;
	return ctx.squares[index];
}

function ownerLabel(square: Square | undefined, ctx: BusDestinationContext): string {
	if (!square || !isOwnableSquare(square)) return '';
	if (!square.ownerId) return ctx.t('game.bus_owner_unowned');
	if (square.ownerId === ctx.myId) return ctx.t('game.bus_owner_self');
	const owner = ctx.players.find(player => player.id === square.ownerId);
	return ctx.t('game.bus_owner_other', { owner: owner?.name ?? square.ownerId });
}

function buildingsLabel(square: Square | undefined, ctx: BusDestinationContext): string {
	if (!square) return '';
	if ((square.bigBuildings ?? 0) > 0) return ctx.t('game.bus_dest_big_building');
	if ((square.smallBuildings ?? 0) > 0) {
		return ctx.t('game.bus_dest_buildings', { count: square.smallBuildings });
	}
	return '';
}
