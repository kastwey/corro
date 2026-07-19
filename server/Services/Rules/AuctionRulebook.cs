using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

// ============================================================
// AUCTION OUTCOME RECORDS
// ============================================================

public record BidOutcome : IOutcome
{
	public bool Success { get; init; }
	public string? Error { get; init; }
	public string? ErrorCode { get; init; }
	public int SquareIndex { get; init; }
	public string? SquareName { get; init; }
	public string? BidderId { get; init; }
	public string? BidderName { get; init; }
	public int Amount { get; init; }
	public int BidTimeoutSeconds { get; init; }
	// Set when the bid itself ended the auction (nobody else could outbid).
	public bool AuctionEnded { get; init; }
	public AuctionFinalOutcome? FinalResult { get; init; }
}

public record PassOutcome : IOutcome
{
	public bool Success { get; init; }
	public string? Error { get; init; }
	public string? ErrorCode { get; init; }
	public int SquareIndex { get; init; }
	public string? PlayerId { get; init; }
	public string? PlayerName { get; init; }
	public int RemainingBidders { get; init; }
	public bool AuctionEnded { get; init; }
	public AuctionFinalOutcome? FinalResult { get; init; }
}

public record AuctionFinalOutcome
{
	public int SquareIndex { get; init; }
	public string? SquareName { get; init; }
	public string? WinnerId { get; init; }
	public string? WinnerName { get; init; }
	public int? WinningBid { get; init; }
	public bool PropertySold { get; init; }
	public string? NextPlayerId { get; init; }
	public string? NextPlayerName { get; init; }
}

public record AuctionStartOutcome
{
	public bool Success { get; init; }
	public string? Error { get; init; }
	public int SquareIndex { get; init; }
	public string? SquareName { get; init; }
	public int StartingPrice { get; init; }
	public string? InitiatorPlayerId { get; init; }
	public string? InitiatorPlayerName { get; init; }

	public int BidTimeoutSeconds { get; init; }
}

/// <summary>
/// The Auction Rulebook - central authority for all auction rules.
/// Handles all auction logic: starting, bidding, passing, and ending.
/// </summary>
public interface IAuctionRulebook
{
	/// <summary>
	/// Start an auction for a property.
	/// </summary>
	Task<AuctionStartOutcome> StartAuctionAsync(int squareIndex, string initiatorPlayerId, GameContext context);

	/// <summary>
	/// Place a bid in the current auction.
	/// </summary>
	Task<BidOutcome> PlaceBidAsync(string playerId, int squareIndex, int amount, GameContext context);

	/// <summary>
	/// Pass on bidding in the current auction.
	/// </summary>
	Task<PassOutcome> PassAuctionAsync(string playerId, int squareIndex, GameContext context);

	/// <summary>
	/// End the auction (timeout or forced).
	/// </summary>
	Task<AuctionFinalOutcome> EndAuctionAsync(GameContext context);

	/// <summary>
	/// Check if there's an active auction.
	/// </summary>
	bool HasActiveAuction(GameContext context);
}

/// <summary>
/// Implementation of auction rules.
/// </summary>
public class AuctionRulebook : IAuctionRulebook
{
	// ============================================================
	// START AUCTION
	// ============================================================

	public Task<AuctionStartOutcome> StartAuctionAsync(int squareIndex, string initiatorPlayerId, GameContext context)
	{
		var square = context.Helper.GetSquare(squareIndex);
		if (square == null)
		{
			return Task.FromResult(new AuctionStartOutcome
			{
				Success = false,
				Error = $"Square {squareIndex} not found"
			});
		}

		var initiator = context.Helper.GetPlayer(initiatorPlayerId);
		if (initiator == null)
		{
			return Task.FromResult(new AuctionStartOutcome
			{
				Success = false,
				Error = $"Player {initiatorPlayerId} not found"
			});
		}

		// Create auction state
		var auction = new AuctionState
		{
			SquareIndex = squareIndex,
			SquareName = square.Name,
			StartingPrice = context.Settings.AuctionStartingPrice,
			CurrentBid = 0,
			HighestBidderId = null,
			HighestBidderName = null,
			Bids = new List<AuctionBid>(),
			PassedPlayers = new HashSet<string>(),
			StartedAt = DateTime.UtcNow,
			BidTimeout = TimeSpan.FromSeconds(context.Settings.AuctionBidTimeoutSeconds),
			CurrentPhaseStartedAt = DateTime.UtcNow,
			InitiatorPlayerId = initiatorPlayerId,
			IsActive = true
		};

		context.GameState.ActiveAuction = auction;

		return Task.FromResult(new AuctionStartOutcome
		{
			Success = true,
			SquareIndex = squareIndex,
			SquareName = square.Name,
			StartingPrice = context.Settings.AuctionStartingPrice,
			InitiatorPlayerId = initiatorPlayerId,
			InitiatorPlayerName = initiator.Name,
			BidTimeoutSeconds = context.Settings.AuctionBidTimeoutSeconds
		});
	}

	// ============================================================
	// PLACE BID
	// ============================================================

	public async Task<BidOutcome> PlaceBidAsync(string playerId, int squareIndex, int amount, GameContext context)
	{
		var player = context.Helper.GetPlayer(playerId);
		if (player == null)
		{
			return new BidOutcome
			{
				Success = false,
				Error = "Player not found",
				ErrorCode = "PLAYER_NOT_FOUND"
			};
		}

		var auction = context.GameState.ActiveAuction;
		if (auction == null || !auction.IsActive)
		{
			return new BidOutcome
			{
				Success = false,
				Error = "No active auction",
				ErrorCode = "NO_ACTIVE_AUCTION"
			};
		}

		if (auction.SquareIndex != squareIndex)
		{
			return new BidOutcome
			{
				Success = false,
				Error = "Square mismatch with active auction",
				ErrorCode = "SQUARE_MISMATCH"
			};
		}

		// RULE: Players who passed cannot bid again
		if (auction.PassedPlayers.Contains(playerId))
		{
			return new BidOutcome
			{
				Success = false,
				Error = "You have already passed on this auction",
				ErrorCode = "ALREADY_PASSED"
			};
		}

		// RULE: Bid must be higher than current
		if (amount <= auction.CurrentBid)
		{
			return new BidOutcome
			{
				Success = false,
				Error = $"Bid must be higher than current bid of {auction.CurrentBid}",
				ErrorCode = "BID_TOO_LOW"
			};
		}

		// RULE: Player must have enough money
		if (player.Money < amount)
		{
			return new BidOutcome
			{
				Success = false,
				Error = $"You don't have enough money. You have {player.Money}",
				ErrorCode = "INSUFFICIENT_FUNDS"
			};
		}

		// Apply the bid
		var bid = new AuctionBid
		{
			PlayerId = playerId,
			PlayerName = player.Name,
			Amount = amount,
			Timestamp = DateTime.UtcNow
		};

		auction.Bids.Add(bid);
		auction.CurrentBid = amount;
		auction.HighestBidderId = playerId;
		auction.HighestBidderName = player.Name;
		auction.CurrentPhaseStartedAt = DateTime.UtcNow;

		// Auto-win: once no other still-in bidder can possibly outbid this amount, keeping
		// the auction open just stalls the game (the highest bidder cannot pass, and nobody
		// else can raise). End it immediately with this player as the winner.
		var someoneElseCanOutbid = context.GameState.Players.Any(p =>
			p.Id != playerId &&
			!auction.PassedPlayers.Contains(p.Id) &&
			p.Money > amount);

		if (!someoneElseCanOutbid)
		{
			var finalResult = await EndAuctionAsync(context);
			return new BidOutcome
			{
				Success = true,
				SquareIndex = finalResult.SquareIndex,
				SquareName = finalResult.SquareName,
				BidderId = playerId,
				BidderName = player.Name,
				Amount = amount,
				BidTimeoutSeconds = context.Settings.AuctionBidTimeoutSeconds,
				AuctionEnded = true,
				FinalResult = finalResult
			};
		}

		return new BidOutcome
		{
			Success = true,
			SquareIndex = auction.SquareIndex,
			SquareName = auction.SquareName,
			BidderId = playerId,
			BidderName = player.Name,
			Amount = amount,
			BidTimeoutSeconds = context.Settings.AuctionBidTimeoutSeconds
		};
	}

	// ============================================================
	// PASS AUCTION
	// ============================================================

	public async Task<PassOutcome> PassAuctionAsync(string playerId, int squareIndex, GameContext context)
	{
		var player = context.Helper.GetPlayer(playerId);
		if (player == null)
		{
			return new PassOutcome
			{
				Success = false,
				Error = "Player not found",
				ErrorCode = "PLAYER_NOT_FOUND"
			};
		}

		var auction = context.GameState.ActiveAuction;
		if (auction == null || !auction.IsActive)
		{
			return new PassOutcome
			{
				Success = false,
				Error = "No active auction",
				ErrorCode = "NO_ACTIVE_AUCTION"
			};
		}

		if (auction.SquareIndex != squareIndex)
		{
			return new PassOutcome
			{
				Success = false,
				Error = "Square mismatch with active auction",
				ErrorCode = "SQUARE_MISMATCH"
			};
		}

		// RULE: Cannot pass twice
		if (auction.PassedPlayers.Contains(playerId))
		{
			return new PassOutcome
			{
				Success = false,
				Error = "You have already passed",
				ErrorCode = "ALREADY_PASSED"
			};
		}

		// RULE: The current highest bidder cannot pass. They are committed to their bid and
		// can only lose the auction by being outbid or by the timer running out — never by
		// "passing" themselves into an early win. The auction therefore ends with the highest
		// bidder winning only once every OTHER player has passed (see ShouldAuctionEnd).
		if (auction.HighestBidderId == playerId)
		{
			return new PassOutcome
			{
				Success = false,
				Error = "The highest bidder cannot pass",
				ErrorCode = "HIGHEST_BIDDER_CANNOT_PASS"
			};
		}

		// Apply the pass
		auction.PassedPlayers.Add(playerId);

		// Count remaining active bidders. Bankrupt players are out of the game: they never bid and
		// never pass, so counting them would keep the auction alive forever (it could never reach
		// "one bidder left"). Exclude them so the auction ends correctly when everyone else passes.
		var remainingBidders = context.GameState.Players
			.Where(p => !p.IsBankrupt && !auction.PassedPlayers.Contains(p.Id))
			.Count();

		// RULE: Check if auction should end
		bool shouldEnd = ShouldAuctionEnd(auction, remainingBidders);

		if (shouldEnd)
		{
			var finalResult = await EndAuctionAsync(context);
			return new PassOutcome
			{
				Success = true,
				SquareIndex = auction.SquareIndex,
				PlayerId = playerId,
				PlayerName = player.Name,
				RemainingBidders = remainingBidders,
				AuctionEnded = true,
				FinalResult = finalResult
			};
		}

		return new PassOutcome
		{
			Success = true,
			SquareIndex = auction.SquareIndex,
			PlayerId = playerId,
			PlayerName = player.Name,
			RemainingBidders = remainingBidders,
			AuctionEnded = false
		};
	}

	/// <summary>
	/// Determines if auction should end based on the standard rules.
	/// </summary>
	private bool ShouldAuctionEnd(AuctionState auction, int remainingBidders)
	{
		// RULE: If only one bidder remains and there's a current bid, they win
		if (remainingBidders <= 1 && auction.CurrentBid > 0)
		{
			return true;
		}

		// RULE: If no one is left (all passed) and no bids, auction ends with no winner
		if (remainingBidders == 0)
		{
			return true;
		}

		return false;
	}

	// ============================================================
	// END AUCTION
	// ============================================================

	public async Task<AuctionFinalOutcome> EndAuctionAsync(GameContext context)
	{
		var auction = context.GameState.ActiveAuction;
		if (auction == null)
		{
			return new AuctionFinalOutcome
			{
				PropertySold = false
			};
		}

		// Mark auction as ended
		auction.IsActive = false;

		var square = context.Helper.GetSquare(auction.SquareIndex);
		bool propertySold = false;

		// RULE: Determine winner and process sale
		if (auction.CurrentBid > 0 && auction.HighestBidderId != null)
		{
			var winner = context.Helper.GetPlayer(auction.HighestBidderId);
			if (winner != null && square != null)
			{
				// Deduct money from the winner and credit the bank so money is conserved.
				context.Helper.AddPlayerMoney(auction.HighestBidderId, -auction.CurrentBid);
				context.Helper.SetBankMoney(context.Helper.GetBankMoney() + auction.CurrentBid);

				// Add property
				context.Helper.AddPlayerProperty(auction.HighestBidderId, auction.SquareIndex);

				// Update square ownership
				square.OwnerId = auction.HighestBidderId;
				propertySold = true;

				// Notify square changed
				await context.Presenter.NotifySquareChangedAsync(square);

				context.Logger?.LogInformation("AuctionRulebook: {WinnerName} bought {SquareName} for {Bid}", winner.Name, auction.SquareName, auction.CurrentBid);
			}
		}
		else
		{
			context.Logger?.LogInformation("AuctionRulebook: No bids for {SquareName}", auction.SquareName);
		}

		// An auction is only reached when the player chose to move on (EndTurn) or
		// rolled again with a purchase pending. The player who declined (the auction
		// initiator) is still the current player until we advance the turn below.
		var playerBeforeAdvance = context.Helper.GetCurrentPlayer();

		context.GameState.ActiveAuction = null;

		// Advance the turn now unless the player still owes a roll after doubles.
		var stillOwesRoll = context.GameState.MustRollAgain;
		if (!stillOwesRoll)
		{
			context.Helper.NextTurn();
		}

		// Get next player info
		var currentPlayer = context.Helper.GetCurrentPlayer();

		// The server owns the spoken turn handover (this used to live in the client
		// AuctionEndedHandler). Doubles keep the turn with the same player, so that player
		// hears the roll-again reminder instead of a handover.
		if (stillOwesRoll)
		{
			if (currentPlayer != null)
			{
				await context.Announce("game.doubles_roll_again", new Dictionary<string, object>
				{
					["player"] = currentPlayer.Name,
					["actorId"] = currentPlayer.Id
				});
			}
		}
		else if (currentPlayer != null)
		{
			await context.Announce("game.turn_of", new Dictionary<string, object>
			{
				["player"] = currentPlayer.Name,
				["actorId"] = currentPlayer.Id
			});
		}

		var result = new AuctionFinalOutcome
		{
			SquareIndex = auction.SquareIndex,
			SquareName = auction.SquareName,
			WinnerId = auction.HighestBidderId,
			WinnerName = auction.HighestBidderName,
			WinningBid = auction.CurrentBid > 0 ? auction.CurrentBid : null,
			PropertySold = propertySold,
			NextPlayerId = currentPlayer?.Id,
			NextPlayerName = currentPlayer?.Name
		};

		return result;
	}

	// ============================================================
	// HELPERS
	// ============================================================

	public bool HasActiveAuction(GameContext context)
	{
		var auction = context.GameState.ActiveAuction;
		return auction != null && auction.IsActive;
	}
}
