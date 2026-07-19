// commands/registry.ts - Creates and configures the command handler registry

import { CommandHandlerRegistry } from './index.js';
import { DiceRolledHandler } from './DiceRolledHandler.js';
import { RaceRollHandler, RaceMoveHandler, TrackRollHandler } from './RaceHandlers.js';
import { PropertyPurchasedHandler, PropertyDeclinedHandler } from './PropertyHandlers.js';
import { 
	AuctionStartedHandler, 
	BidPlacedHandler, 
	AuctionPassedHandler, 
	AuctionEndedHandler 
} from './AuctionHandlers.js';
import {
	PropertyMortgagedHandler,
	PropertyUnmortgagedHandler,
	HousesSoldHandler,
	HouseBuiltHandler,
	BankruptcyHandler
} from './DebtHandlers.js';
import { TradeProposedHandler, TradeResolvedHandler } from './TradeHandlers.js';
import { ReleaseCostPaidHandler, ReleasePassUsedHandler } from './HoldingHandlers.js';

/**
 * Creates a pre-configured command handler registry with all handlers registered.
 * To add a new handler:
 * 1. Create a new handler class implementing ICommandHandler
 * 2. Register it here
 * No need to modify gameManager!
 */
export function createCommandRegistry(): CommandHandlerRegistry {
	const registry = new CommandHandlerRegistry();
	
	// Register all handlers
	registry.register(new DiceRolledHandler());
	registry.register(new RaceRollHandler());
	registry.register(new RaceMoveHandler());
	registry.register(new TrackRollHandler());
	registry.register(new PropertyPurchasedHandler());
	registry.register(new PropertyDeclinedHandler());
	
	// Auction handlers
	registry.register(new AuctionStartedHandler());
	registry.register(new BidPlacedHandler());
	registry.register(new AuctionPassedHandler());
	registry.register(new AuctionEndedHandler());
	
	// Debt & Bankruptcy handlers
	registry.register(new PropertyMortgagedHandler());
	registry.register(new PropertyUnmortgagedHandler());
	registry.register(new HousesSoldHandler());
	registry.register(new HouseBuiltHandler());
	registry.register(new BankruptcyHandler());
	
	// Trade handlers
	registry.register(new TradeProposedHandler());
	registry.register(new TradeResolvedHandler());

	// Holding handlers
	registry.register(new ReleaseCostPaidHandler());
	registry.register(new ReleasePassUsedHandler());
	
	return registry;
}

// Re-export for convenience
export { CommandHandlerRegistry, createAnnouncement } from './index.js';
export type { CommandContext, ICommandHandler } from './index.js';
