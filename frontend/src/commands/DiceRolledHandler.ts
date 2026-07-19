// commands/DiceRolledHandler.ts - Handles dice roll responses

import type { CommandResponse, DiceRolledResponse } from '../models.js';
import type { ICommandHandler, CommandContext } from './index.js';

export class DiceRolledHandler implements ICommandHandler {
	readonly responseType = 'DICE_ROLLED';

	handle(response: CommandResponse, context: CommandContext): void {
		const data = response as unknown as DiceRolledResponse;
		if (!data) return;

		const isMe = data.playerId === context.myPlayerId;

		// Feed the visual dice control (decorative; the dice result and its
		// landing consequences are announced by the server). DICE_ROLLED reaches
		// every client (group broadcast), so spectators' trays paint too.
		context.emit('diceRolled', {
			playerId: data.playerId,
			die1: data.die1,
			die2: data.die2,
			isDoubles: data.isDoubles,
			isMe
		});

		// STEP 0: Holding handling. The server owns ALL holding voice (dice result,
		// escape by doubles, paid the release cost, "still in holding") and the next-turn
		// handover. When the player stays in holding there is no movement, so we
		// only refresh the visual turn indicator.
		if (data.stillHeld) {
			setTimeout(() => {
				this.emitTurnUpdate(context);
			}, 500);
			return;
		}

		// STEP 2: If it's me, drive the visuals. The server narrates the dice
		// result and the landing/purchase availability.
		if (isMe && context.board) {
			// Move the exploration cursor (the visual highlight) to the landing square, but
			// pace it to the token hop via deferVisual: while my token is still travelling the
			// cursor stays put and only jumps to the destination once the hop settles. This
			// stops a sighted player from SEEING the highlight reveal where they'll land before
			// the token gets there, and keeps cursor queries (AnnounceGroup/Price/Owner,
			// WhoIsOnSquare) in sync with the visible position. The move is silent (no
			// announcement, no spatial cue) so it never interrupts the dice announcement.
			// Arm the gate FIRST: this response arrives before the sequencer plays the
			// roll's announcements+state segment, so the gate is still unarmed here and
			// deferVisual alone would move the cursor at once — a sighted player saw the
			// destination ring while the token was still travelling (live-play report).
			const board = context.board;
			context.armForMove();
			context.deferVisual(() => board.setActiveIndex(data.toPosition, false, false));

			// Refresh the turn indicator / action bar from the authoritative state after
			// a delay so it doesn't step on the dice announcement. A buyable landing
			// surfaces "Buy property" as an action (driven by gameState.pendingPurchase),
			// not a blocking prompt.
			setTimeout(() => {
				this.emitTurnUpdate(context);
			}, 600);
		} else {
			// Not me - just refresh the visual turn indicator for other players
			setTimeout(() => {
				this.emitTurnUpdate(context);
			}, 500);
		}

	}

	private emitTurnUpdate(context: CommandContext): void {
		if (context.gameState) {
			context.emit('gameStateUpdated', context.gameState);
		}
	}
}
