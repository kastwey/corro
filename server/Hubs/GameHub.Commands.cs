using CorroServer.Models;
using CorroServer.Services;
using Microsoft.AspNetCore.SignalR;

namespace CorroServer.Hubs;

/// <summary>
/// Partial class containing game command methods for GameHub.
/// Handles all in-game actions like rolling dice, buying properties, auctions, etc.
/// </summary>
public partial class GameHub
{
	public async Task ExecuteCommand(GameCommand command)
	{
		try
		{
			if (!IsConnectionAuthenticated(out var playerId, out var gameId))
			{
				await Clients.Caller.SendAsync("Error", "NOT_AUTHENTICATED");
				_logger?.LogWarning("SECURITY: Unauthenticated command attempt from {ConnectionId}", Context.ConnectionId);
				return;
			}

			if (!_registry.TryGetService(gameId!, out var gameService))
			{
				await Clients.Caller.SendAsync("Error", "GAME_SERVICE_NOT_FOUND");
				return;
			}

			if (command.PlayerId != playerId)
			{
				await Clients.Caller.SendAsync("Error", "CANNOT_EXECUTE_FOR_OTHERS");
				_logger?.LogWarning("SECURITY: Player {PlayerId} tried to execute command for {TargetPlayerId}", playerId, command.PlayerId);
				return;
			}

			var response = await gameService.ExecuteCommandAsync(command);

			// Most command responses are private to the caller, but some must reach every
			// participant. An auction ending must reach the winner (who never sent a command),
			// a trade proposal / resolution must reach the other party so their trade UI can
			// open or close, a BID must reach every rival bidder INSTANTLY — the per-second
			// timer tick also carries the bid, but waiting up to a second made the rivals'
			// "current bid" look frozen — and a DICE ROLL must reach every spectator so their
			// visual dice tray shows what was thrown (live-play bug: "I only see dice when I
			// roll"). The dice handler is isMe-guarded client-side, so spectators only paint.
			if (response.Type is "AUCTION_ENDED" or "TRADE_PROPOSED" or "TRADE_RESOLVED" or "BID_PLACED" or "DICE_ROLLED")
			{
				await Clients.Group(gameId!).SendAsync("CommandResponse", response);
			}
			else
			{
				await Clients.Caller.SendAsync("CommandResponse", response);
			}
			await gameService.NotifyStateChangedAsync();

			// Declining a pending purchase (by ending the turn or re-rolling) can start an
			// auction. That must reach EVERY player so their auction UI opens and the timers
			// run, so we broadcast it to the whole group here rather than only to the caller.
			if (response is PropertyDeclinedResponse { AuctionStarted: true })
			{
				await BroadcastAuctionStartAsync(gameId!, gameService);
			}

			// Free finished games so they don't accumulate in memory.
			await _registry.CleanupIfGameOverAsync(gameId!, gameService);
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in ExecuteCommand");
			await Clients.Caller.SendAsync("Error", "COMMAND_EXECUTION_ERROR");
		}
	}

	/// <summary>Race family: resolve the pending piece choice (which piece moves).</summary>
	public async Task MoveRacePiece(string playerId, int pieceIndex)
	{
		var command = new MoveRacePieceCommand { PlayerId = playerId, PieceIndex = pieceIndex };
		await ExecuteCommand(command);
	}

	/// <summary>Journey family: draw the top card (the start of your turn).</summary>
	public async Task JourneyDraw(string playerId)
		=> await ExecuteCommand(new JourneyDrawCommand { PlayerId = playerId });

	/// <summary>Journey family: play a card (attacks carry the victim's player id).</summary>
	public async Task JourneyPlay(string playerId, string instanceId, string? targetId)
		=> await ExecuteCommand(new JourneyPlayCommand { PlayerId = playerId, InstanceId = instanceId, TargetId = targetId });

	/// <summary>Journey family: discard instead of playing.</summary>
	public async Task JourneyDiscard(string playerId, string instanceId)
		=> await ExecuteCommand(new JourneyDiscardCommand { PlayerId = playerId, InstanceId = instanceId });

	/// <summary>Journey family: the victim's coup fourré answer (out of turn).</summary>
	public async Task JourneyCoup(string playerId, bool accept)
		=> await ExecuteCommand(new JourneyCoupCommand { PlayerId = playerId, Accept = accept });

	/// <summary>Assembly family: play a card (attacks/specials carry their targeting).</summary>
	public async Task AssemblyPlay(string playerId, string instanceId, string? targetPlayerId, string? targetColor, string? giveColor)
		=> await ExecuteCommand(new AssemblyPlayCommand
		{
			PlayerId = playerId,
			InstanceId = instanceId,
			TargetPlayerId = targetPlayerId,
			TargetColor = targetColor,
			GiveColor = giveColor,
		});

	/// <summary>Assembly family: discard 1..N cards face-down (empty list = pass).</summary>
	public async Task AssemblyDiscard(string playerId, List<string> instanceIds)
		=> await ExecuteCommand(new AssemblyDiscardCommand { PlayerId = playerId, InstanceIds = instanceIds ?? new() });

	/// <summary>Draft family: commit (or replace) this trick's secret pick — simultaneous,
	/// never turn-bound. A second card rides an "extra" waiting on the picker's table.
	/// The reveal fires server-side when the last pick lands.</summary>
	public async Task DraftPick(string playerId, string instanceId, string? secondInstanceId)
		=> await ExecuteCommand(new DraftPickCommand
		{
			PlayerId = playerId,
			InstanceId = instanceId,
			SecondInstanceId = secondInstanceId,
		});

	/// <summary>Shedding family: play a matching card (wilds carry the chosen colour).</summary>
	public async Task SheddingPlay(string playerId, string instanceId, string? chosenColor,
		List<string>? extraInstanceIds = null)
		=> await ExecuteCommand(new SheddingPlayCommand
		{
			PlayerId = playerId,
			InstanceId = instanceId,
			ChosenColor = chosenColor,
			ExtraInstanceIds = extraInstanceIds,
		});

	/// <summary>Shedding family: draw one card (maybe pausing on the play-or-keep choice).</summary>
	public async Task SheddingDraw(string playerId)
		=> await ExecuteCommand(new SheddingDrawCommand { PlayerId = playerId });

	/// <summary>Shedding family: keep the just-drawn card and pass the turn.</summary>
	public async Task SheddingKeep(string playerId)
		=> await ExecuteCommand(new SheddingKeepCommand { PlayerId = playerId });

	/// <summary>Shedding family: declare the last card (optional house rule; off-turn).</summary>
	public async Task SheddingDeclareLastCard(string playerId)
		=> await ExecuteCommand(new SheddingDeclareLastCardCommand { PlayerId = playerId });

	/// <summary>Shedding family: catch a rival who forgot the last-card declaration (off-turn).</summary>
	public async Task SheddingCatchLastCard(string playerId)
		=> await ExecuteCommand(new SheddingCatchLastCardCommand { PlayerId = playerId });

	/// <summary>Exploding family: play an action card (skip/attack/shuffle/seeFuture/favor/cat pair)
	/// — opens the Nope window. targetId names a Favor / cat-steal victim; secondInstanceId is the
	/// matching cat of a pair.</summary>
	public async Task ExplodingPlay(string playerId, string instanceId,
		string? targetId = null, string? secondInstanceId = null)
		=> await ExecuteCommand(new ExplodingPlayCommand
		{
			PlayerId = playerId,
			InstanceId = instanceId,
			TargetId = targetId,
			SecondInstanceId = secondInstanceId,
		});

	/// <summary>Exploding family: as a Favor's target, give the requester a card of your choice.</summary>
	public async Task ExplodingGive(string playerId, string instanceId)
		=> await ExecuteCommand(new ExplodingGiveCommand { PlayerId = playerId, InstanceId = instanceId });

	/// <summary>Exploding family: play a Nope to cancel the pending action (off-turn).</summary>
	public async Task ExplodingNope(string playerId, string instanceId)
		=> await ExecuteCommand(new ExplodingNopeCommand { PlayerId = playerId, InstanceId = instanceId });

	/// <summary>Exploding family: draw the top card to end your turn.</summary>
	public async Task ExplodingDraw(string playerId)
		=> await ExecuteCommand(new ExplodingDrawCommand { PlayerId = playerId });

	/// <summary>Exploding family: tuck a defused bomb back at a chosen secret depth (cards above it).</summary>
	public async Task ExplodingDefuse(string playerId, int depth)
		=> await ExecuteCommand(new ExplodingDefuseCommand { PlayerId = playerId, Depth = depth });

	/// <summary>Trivia family: the host picks the judge before play begins (judgeMode "fixed").</summary>
	public async Task TriviaChooseJudge(string playerId, string judgeId)
		=> await ExecuteCommand(new TriviaChooseJudgeCommand { PlayerId = playerId, JudgeId = judgeId });

	/// <summary>Trivia family: after a roll, choose which legal square to land on.</summary>
	public async Task TriviaMove(string playerId, string node)
		=> await ExecuteCommand(new TriviaMoveCommand { PlayerId = playerId, Node = node });

	/// <summary>Trivia family: submit an answer (written text, or a choice index; -1 when unused).</summary>
	public async Task TriviaAnswer(string playerId, string? text, int choice)
		=> await ExecuteCommand(new TriviaAnswerCommand { PlayerId = playerId, Text = text, Choice = choice });

	/// <summary>Trivia family: the designated judge rules on the submitted answer (off-turn).</summary>
	public async Task TriviaJudge(string playerId, bool correct)
		=> await ExecuteCommand(new TriviaJudgeCommand { PlayerId = playerId, Correct = correct });

	public async Task RollDice(string playerId)
	{
		// Delegates to ExecuteCommand like every other command hub method: it already does the
		// auth / caller-id / game-lookup checks, response routing, the pending-purchase→auction
		// broadcast and game-over cleanup — so RollDice needs no bespoke reimplementation.
		await ExecuteCommand(new RollDiceCommand { PlayerId = playerId });
	}

	public async Task EndTurn(string playerId)
	{
		var command = new EndTurnCommand { PlayerId = playerId };
		await ExecuteCommand(command);
	}

	public async Task GetPlayerMoney(string playerId)
	{
		var command = new GetMoneyCommand { PlayerId = playerId };
		await ExecuteCommand(command);
	}

	public async Task GetPlayerCards(string playerId)
	{
		var command = new GetReleasePassesCommand { PlayerId = playerId };
		await ExecuteCommand(command);
	}

	public async Task AnnounceTurn(string playerId)
	{
		var command = new AnnounceTurnCommand { PlayerId = playerId };
		await ExecuteCommand(command);
	}

	// ============================================================
	// TRADING
	// ============================================================

	public async Task ProposeTrade(
		string playerId,
		string targetPlayerId,
		int[] offeredProperties,
		int offeredMoney,
		int offeredReleasePasses,
		int[] requestedProperties,
		int requestedMoney,
		int requestedReleasePasses)
	{
		var command = new ProposeTradeCommand
		{
			PlayerId = playerId,
			TargetPlayerId = targetPlayerId,
			OfferedProperties = (offeredProperties ?? Array.Empty<int>()).ToList(),
			OfferedMoney = offeredMoney,
			OfferedReleasePasses = offeredReleasePasses,
			RequestedProperties = (requestedProperties ?? Array.Empty<int>()).ToList(),
			RequestedMoney = requestedMoney,
			RequestedReleasePasses = requestedReleasePasses
		};
		await ExecuteCommand(command);
	}

	public async Task RespondTrade(string playerId, string tradeId, bool accept)
	{
		var command = new RespondTradeCommand { PlayerId = playerId, TradeId = tradeId, Accept = accept };
		await ExecuteCommand(command);
	}

	public async Task CancelTrade(string playerId, string? tradeId)
	{
		var command = new CancelTradeCommand { PlayerId = playerId, TradeId = tradeId };
		await ExecuteCommand(command);
	}

	public async Task BuyProperty(string playerId, int squareIndex)
	{
		var command = new BuyPropertyCommand { PlayerId = playerId, SquareIndex = squareIndex };
		await ExecuteCommand(command);
	}

	/// <summary>
	/// Broadcasts an AUCTION_STARTED event to every player in the game and starts the
	/// auction timers. An auction begins as a side effect of declining a pending purchase
	/// (by ending the turn or re-rolling after the buy offer), so — unlike most command
	/// responses — it must reach the whole group, not just the caller.
	/// </summary>
	private async Task BroadcastAuctionStartAsync(string gameId, IGameService gameService)
	{
		var auction = gameService.GameState?.ActiveAuction;
		if (auction == null || !auction.IsActive)
		{
			return;
		}

		var initiator = gameService.GameState!.Players.FirstOrDefault(p => p.Id == auction.InitiatorPlayerId);
		var auctionStartedEvent = new AuctionStartedResponse
		{
			SquareIndex = auction.SquareIndex,
			SquareName = auction.SquareName,
			StartingPrice = auction.StartingPrice,
			InitiatorPlayerId = auction.InitiatorPlayerId,
			InitiatorPlayerName = initiator?.Name ?? "Unknown",
			BidTimeoutSeconds = (int)auction.BidTimeout.TotalSeconds
		};

		await Clients.Group(gameId).SendAsync("CommandResponse", auctionStartedEvent);
		_logger?.LogInformation("Auction started broadcast to all players in game {GameId}", gameId);

		_auctionTimerService.StartTimers(gameId, gameService.Settings, auction);
	}

	public async Task PlaceBid(string playerId, int squareIndex, int amount)
	{
		var command = new PlaceBidCommand { PlayerId = playerId, SquareIndex = squareIndex, Amount = amount };
		await ExecuteCommand(command);
		// The bid window's countdown is reset by the rulebook (it moves the auction's
		// CurrentPhaseStartedAt forward the instant the bid is accepted), which the timer
		// service reads directly — so there is no separate timer reset to do here.
	}

	public async Task PassAuction(string playerId, int squareIndex)
	{
		var command = new PassAuctionCommand { PlayerId = playerId, SquareIndex = squareIndex };
		await ExecuteCommand(command);

		if (IsConnectionAuthenticated(out _, out var gameId) &&
			_registry.TryGetService(gameId!, out var gameService))
		{
			var gs = gameService.GameState;
			if (gs?.ActiveAuction == null || !gs.ActiveAuction.IsActive)
			{
				_auctionTimerService.StopTimers(gameId!);
			}
		}
	}

	// ============================================
	// DEBT & BANKRUPTCY COMMANDS
	// ============================================

	public async Task MortgageProperty(string playerId, int squareIndex)
	{
		var command = new MortgagePropertyCommand { PlayerId = playerId, SquareIndex = squareIndex };
		await ExecuteCommand(command);
	}

	public async Task UnmortgageProperty(string playerId, int squareIndex)
	{
		var command = new UnmortgagePropertyCommand { PlayerId = playerId, SquareIndex = squareIndex };
		await ExecuteCommand(command);
	}

	public async Task SellBuildings(string playerId, int squareIndex, int count)
	{
		var command = new SellBuildingsCommand { PlayerId = playerId, SquareIndex = squareIndex, Count = count };
		await ExecuteCommand(command);
	}

	public async Task Build(string playerId, int squareIndex, int count)
	{
		var command = new BuildCommand { PlayerId = playerId, SquareIndex = squareIndex, Count = count };
		await ExecuteCommand(command);
	}

	public async Task DeclareBankruptcy(string playerId)
	{
		var command = new DeclareBankruptcyCommand { PlayerId = playerId };
		await ExecuteCommand(command);
	}

	public async Task GetDebtStatus(string playerId)
	{
		var command = new GetDebtStatusCommand { PlayerId = playerId };
		await ExecuteCommand(command);
	}

	public async Task ResolveDebt(string playerId, string? debtId = null)
	{
		var command = new ResolveDebtCommand { PlayerId = playerId, DebtId = debtId };
		await ExecuteCommand(command);
	}

	// ============================================
	// HOLDING COMMANDS
	// ============================================

	public async Task PayReleaseCost(string playerId)
	{
		var command = new PayReleaseCostCommand { PlayerId = playerId };
		await ExecuteCommand(command);
	}

	public async Task UseReleasePass(string playerId)
	{
		var command = new UseReleasePassCommand { PlayerId = playerId };
		await ExecuteCommand(command);
	}
}
