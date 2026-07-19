// commands/TradeHandlers.ts - Frontend handlers for trade server responses.
// These are EMIT-ONLY: the server owns the spoken voice of trade events, so the
// handlers just translate the response into a gameManager event that the UI layer
// (app.ts) turns into modal dialogs. No announcements happen here.

import type { ICommandHandler, CommandContext } from './index.js';
import type { CommandResponse, TradeProposedResponse, TradeResolvedResponse } from '../models.js';

export class TradeProposedHandler implements ICommandHandler {
	readonly responseType = 'TRADE_PROPOSED';

	handle(response: CommandResponse, context: CommandContext): void {
		const data = response as unknown as TradeProposedResponse;
		if (!data) return;

		const me = context.myPlayerId;
		context.emit('tradeProposed', {
			tradeId: data.tradeId,
			initiatorId: data.initiatorId,
			initiatorName: data.initiatorName,
			targetId: data.targetId,
			targetName: data.targetName,
			offered: data.offered,
			requested: data.requested,
			isForMe: me != null && data.targetId === me,
			isMine: me != null && data.initiatorId === me
		});
	}
}

export class TradeResolvedHandler implements ICommandHandler {
	readonly responseType = 'TRADE_RESOLVED';

	handle(response: CommandResponse, context: CommandContext): void {
		const data = response as unknown as TradeResolvedResponse;
		if (!data) return;

		const me = context.myPlayerId;
		context.emit('tradeResolved', {
			tradeId: data.tradeId,
			outcome: data.outcome,
			initiatorId: data.initiatorId,
			targetId: data.targetId,
			involvesMe: me != null && (data.initiatorId === me || data.targetId === me)
		});
	}
}
