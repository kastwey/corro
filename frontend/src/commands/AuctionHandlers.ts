// commands/AuctionHandlers.ts - Handles auction-related responses

import type { 
	CommandResponse, 
	AuctionStartedResponse, 
	BidPlacedResponse, 
	AuctionPassedResponse, 
	AuctionEndedResponse 
} from '../models.js';
import type { ICommandHandler, CommandContext } from './index.js';

/**
 * Handles AUCTION_STARTED responses - called via PropertyDeclined with auctionStarted=true
 * or directly from server
 */
export class AuctionStartedHandler implements ICommandHandler {
	readonly responseType = 'AUCTION_STARTED';

	handle(response: CommandResponse, context: CommandContext): void {
		const data = response as unknown as AuctionStartedResponse;
		if (!data) return;

		// Show auction panel
		context.emit('auctionStarted', {
			squareIndex: data.squareIndex,
			squareName: data.squareName,
			startingPrice: data.startingPrice,
			initiatorPlayerId: data.initiatorPlayerId,
			initiatorPlayerName: data.initiatorPlayerName,
			bidTimeoutSeconds: data.bidTimeoutSeconds
		});
	}
}

/**
 * Handles BID_PLACED responses
 */
export class BidPlacedHandler implements ICommandHandler {
	readonly responseType = 'BID_PLACED';

	handle(response: CommandResponse, context: CommandContext): void {
		const data = response as unknown as BidPlacedResponse;
		if (!data) return;

		const isMe = data.bidderId === context.myPlayerId;

		// Update auction panel with new bid
		context.emit('bidPlaced', {
			squareIndex: data.squareIndex,
			squareName: data.squareName,
			bidderId: data.bidderId,
			bidderName: data.bidderName,
			amount: data.amount,
			bidTimeoutSeconds: data.bidTimeoutSeconds,
			isMe
		});
	}
}

/**
 * Handles AUCTION_PASSED responses
 */
export class AuctionPassedHandler implements ICommandHandler {
	readonly responseType = 'AUCTION_PASSED';

	handle(response: CommandResponse, context: CommandContext): void {
		const data = response as unknown as AuctionPassedResponse;
		if (!data) return;

		const isMe = data.playerId === context.myPlayerId;

		// Update auction panel
		context.emit('auctionPassed', {
			squareIndex: data.squareIndex,
			playerId: data.playerId,
			playerName: data.playerName,
			remainingBidders: data.remainingBidders,
			isMe
		});
	}
}

/**
 * Handles AUCTION_ENDED responses
 */
export class AuctionEndedHandler implements ICommandHandler {
	readonly responseType = 'AUCTION_ENDED';

	handle(response: CommandResponse, context: CommandContext): void {
		const data = response as unknown as AuctionEndedResponse;
		if (!data) return;

		const isWinner = data.winnerId === context.myPlayerId;

		// Hide auction panel
		context.emit('auctionEnded', {
			squareIndex: data.squareIndex,
			squareName: data.squareName,
			winnerId: data.winnerId,
			winnerName: data.winnerName,
			winningBid: data.winningBid,
			propertySold: data.propertySold,
			isWinner
		});

		// The server owns the spoken voice: it announces the auction result and
		// whose turn it is next (or the roll-again cue on doubles).
	}
}
