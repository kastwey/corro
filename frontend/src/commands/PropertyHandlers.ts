// commands/PropertyHandlers.ts - Handles property purchase/decline responses

import type { CommandResponse } from '../models.js';
import type { ICommandHandler, CommandContext } from './index.js';

/**
 * Handles PROPERTY_PURCHASED responses
 */
export class PropertyPurchasedHandler implements ICommandHandler {
	readonly responseType = 'PROPERTY_PURCHASED';

	handle(_response: CommandResponse, _context: CommandContext): void {
		// Intentional no-op acknowledgement: the purchase is reflected by the
		// authoritative game-state broadcast (ownership, money, badges) and the
		// server announces it. We register the handler only so the dispatcher
		// does not warn about an unhandled PROPERTY_PURCHASED response.
	}
}

/**
 * Handles PROPERTY_DECLINED responses
 */
export class PropertyDeclinedHandler implements ICommandHandler {
	readonly responseType = 'PROPERTY_DECLINED';

	handle(_response: CommandResponse, _context: CommandContext): void {
		// Intentional no-op acknowledgement: the decline is reflected by the
		// authoritative game-state broadcast and announced by the server. When the
		// decline starts an auction, the server broadcasts AUCTION_STARTED to the
		// whole group (see AuctionStartedHandler), so this handler must NOT open the
		// auction itself — doing so would open it twice for the declining player.
	}
}
