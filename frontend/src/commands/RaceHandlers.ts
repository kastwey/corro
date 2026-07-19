// commands/RaceHandlers.ts - Race-family responses.
//
// The race client is fully STATE-driven: the board re-renders and the piece-choice dialog
// reconciles from every GameStateChanged, and the server voices every event. These handlers
// only refresh the visual turn/action bar right away so the "Roll" button appears/disappears
// without waiting for a timer.

import type { CommandResponse } from '../models.js';
import type { ICommandHandler, CommandContext } from './index.js';

export class RaceRollHandler implements ICommandHandler {
	readonly responseType = 'RACE_ROLL';
	handle(_response: CommandResponse, context: CommandContext): void {
		if (context.gameState) context.emit('gameStateUpdated', context.gameState);
	}
}

export class RaceMoveHandler implements ICommandHandler {
	readonly responseType = 'RACE_MOVE';
	handle(_response: CommandResponse, context: CommandContext): void {
		if (context.gameState) context.emit('gameStateUpdated', context.gameState);
	}
}

/** The track family is equally state-driven: the roll response only refreshes the bar. */
export class TrackRollHandler implements ICommandHandler {
	readonly responseType = 'TRACK_ROLL';
	handle(_response: CommandResponse, context: CommandContext): void {
		if (context.gameState) context.emit('gameStateUpdated', context.gameState);
	}
}
