// commands/HoldingHandlers.ts - Handles holding release cost / release pass responses.
//
// The server owns the spoken voice for holding events (it announces the release-cost
// payment or the used card, with the first-person "_self" variant for the actor)
// and immediately pushes a fresh game state, which refreshes the action bar.
// These handlers therefore only acknowledge the response; they must NOT announce,
// to avoid duplicating the server voice.

import type { CommandResponse } from '../models.js';
import type { ICommandHandler, CommandContext } from './index.js';

/** Handles HOLDING_RELEASE_COST_PAID responses. */
export class ReleaseCostPaidHandler implements ICommandHandler {
	readonly responseType = 'HOLDING_RELEASE_COST_PAID';

	handle(_response: CommandResponse, _context: CommandContext): void {
		// Visual/state refresh is driven by the subsequent gameStateUpdated push.
		// The server speaks the event; nothing to announce here.
	}
}

/** Handles RELEASE_PASS_USED responses. */
export class ReleasePassUsedHandler implements ICommandHandler {
	readonly responseType = 'RELEASE_PASS_USED';

	handle(_response: CommandResponse, _context: CommandContext): void {
		// See ReleaseCostPaidHandler: state refresh + voice are server-driven.
	}
}
