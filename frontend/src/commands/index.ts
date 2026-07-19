// commands/index.ts - Command Handler infrastructure for frontend

import type { CommandResponse } from '../models.js';
import type { AnnouncementEvent } from '../gameClient.js';
import type { Board } from '../board.js';
import type { GameState } from '../models.js';

/**
 * Context passed to command handlers containing all necessary dependencies.
 */
export interface CommandContext {
	gameState: GameState | null;
	board: Board | null;
	myPlayerId: string | null;
	announce: (event: AnnouncementEvent) => void;
	emit: <K extends string>(event: K, data: any) => void;
	updateGameState: (state: GameState) => void;
	/**
	 * Pace a VISUAL side-effect to the token-hop animation. While the actor's token is
	 * still hopping the callback is buffered and runs when it settles; otherwise it runs
	 * now. Use it for anything that would otherwise reveal the destination early (e.g.
	 * moving the exploration cursor / highlight to the landing square).
	 */
	deferVisual: (run: () => void) => void;
	/**
	 * Arm the announcement gate for the movement this response starts. A command response
	 * arrives BEFORE the sequencer plays its announcements+state segment, so the gate is
	 * still unarmed here and deferVisual alone would run immediately. Call this before
	 * deferVisual when the response means "my token is about to travel"; it is idempotent
	 * and safe speculatively (the gate releases at once if nothing ends up animating).
	 */
	armForMove: () => void;
}

/**
 * Interface for command response handlers.
 * Each response type has its own handler following OCP.
 */
export interface ICommandHandler {
	readonly responseType: string;
	handle(response: CommandResponse, context: CommandContext): void;
}

/**
 * Registry for command handlers.
 * Allows adding new handlers without modifying existing code.
 */
export class CommandHandlerRegistry {
	private handlers = new Map<string, ICommandHandler>();

	register(handler: ICommandHandler): void {
		this.handlers.set(handler.responseType, handler);
	}

	getHandler(responseType: string): ICommandHandler | undefined {
		return this.handlers.get(responseType);
	}

	dispatch(response: CommandResponse, context: CommandContext): boolean {
		if (!response.type) {
			console.warn('CommandResponse without type');
			return false;
		}
		
		const handler = this.handlers.get(response.type);
		if (handler) {
			handler.handle(response, context);
			return true;
		}
		console.warn(`No handler registered for response type: ${response.type}`);
		return false;
	}
}

// Helper to create announcement events
export const createAnnouncement = (
	key: string, 
	vars: Record<string, any> = {}
): AnnouncementEvent => ({ key, vars });

