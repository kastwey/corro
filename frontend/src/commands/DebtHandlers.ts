// commands/DebtHandlers.ts - Handlers for property-management and bankruptcy events

import type { CommandResponse } from '../models.js';
import type { CommandContext, ICommandHandler } from './index.js';
import type { 
	PropertyMortgagedResponse,
	PropertyUnmortgagedResponse,
	BuildingsSoldResponse,
	BuildingBuiltResponse
} from '../models.js';

/**
 * Handler for PROPERTY_MORTGAGED - when a player mortgages a property
 */
export class PropertyMortgagedHandler implements ICommandHandler {
	readonly responseType = 'PROPERTY_MORTGAGED';
	
	handle(response: CommandResponse, context: CommandContext): void {
		const data = response as unknown as PropertyMortgagedResponse;

		// Voice is owned by the server (game.property_mortgaged, with first-person
		// support). The board redraws from the GameStateChanged broadcast.
		context.emit('propertyMortgaged', data);
	}
}

/**
 * Handler for PROPERTY_UNMORTGAGED - when a player unmortgages a property
 */
export class PropertyUnmortgagedHandler implements ICommandHandler {
	readonly responseType = 'PROPERTY_UNMORTGAGED';
	
	handle(response: CommandResponse, context: CommandContext): void {
		const data = response as unknown as PropertyUnmortgagedResponse;

		// Voice is owned by the server (game.property_unmortgaged). UI only here.
		context.emit('propertyUnmortgaged', data);
	}
}

/**
 * Handler for HOUSES_SOLD - when a player sells houses
 */
export class HousesSoldHandler implements ICommandHandler {
	readonly responseType = 'HOUSES_SOLD';
	
	handle(response: CommandResponse, context: CommandContext): void {
		const data = response as unknown as BuildingsSoldResponse;

		// Voice is owned by the server (game.buildings_sold, aggregated). UI only here.
		context.emit('housesSold', data);
	}
}

/**
 * Handler for HOUSE_BUILT - when a player builds houses/a hotel
 */
export class HouseBuiltHandler implements ICommandHandler {
	readonly responseType = 'HOUSE_BUILT';
	
	handle(response: CommandResponse, context: CommandContext): void {
		const data = response as unknown as BuildingBuiltResponse;

		// Voice is owned by the server (game.building_built, with _self support). UI only here.
		context.emit('houseBuilt', data);
	}
}

/**
 * Handler for BANKRUPTCY - the direct response sent to a player who declares bankruptcy.
 *
 * The bankruptcy UI is entirely state-driven: the server owns the spoken voice
 * (game.player_bankrupt / game.game_over) and the end screen + board update from the
 * gameStateUpdated push (state.isGameOver). This handler exists only so that direct
 * response isn't logged as "no handler registered"; it intentionally does nothing.
 */
export class BankruptcyHandler implements ICommandHandler {
	readonly responseType = 'BANKRUPTCY';

	handle(): void {
		/* no-op: bankruptcy is presented from the authoritative game state, not this response */
	}
}
