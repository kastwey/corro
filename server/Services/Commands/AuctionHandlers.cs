using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Handles the PlaceBid command - player places a bid in an auction.
/// Validates and delegates to AuctionRulebook.
/// </summary>
public class PlaceBidHandler : ICommandHandler<PlaceBidCommand>
{
	private readonly IAuctionRulebook _rulebook;

	public PlaceBidHandler(IAuctionRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(PlaceBidCommand command, GameContext context)
	{
		var outcome = await _rulebook.PlaceBidAsync(
			command.PlayerId,
			command.SquareIndex,
			command.Amount,
			context);

		if (outcome.AsError() is { } outcomeError)
		{
			return outcomeError;
		}

		// Announce
		await context.Announce("game.bid_placed", new Dictionary<string, object>
		{
			["player"] = outcome.BidderName!,
			["amount"] = outcome.Amount,
			["property"] = outcome.SquareName!
		});

		// The bid may have ended the auction outright (no other bidder could outbid).
		if (outcome.AuctionEnded && outcome.FinalResult != null)
		{
			var final = outcome.FinalResult;
			if (final.PropertySold)
			{
				await context.Announce("game.auction_won", new Dictionary<string, object>
				{
					["actorId"] = final.WinnerId!,
					["player"] = final.WinnerName!,
					["property"] = final.SquareName!,
					["amount"] = final.WinningBid!
				});
			}

			return new AuctionEndedResponse
			{
				SquareIndex = final.SquareIndex,
				SquareName = final.SquareName ?? string.Empty,
				WinnerId = final.WinnerId,
				WinnerName = final.WinnerName,
				WinningBid = final.WinningBid,
				PropertySold = final.PropertySold,
				NextPlayerId = final.NextPlayerId,
				NextPlayerName = final.NextPlayerName
			};
		}

		return new BidPlacedResponse
		{
			SquareIndex = outcome.SquareIndex,
			SquareName = outcome.SquareName ?? string.Empty,
			BidderId = outcome.BidderId ?? string.Empty,
			BidderName = outcome.BidderName ?? string.Empty,
			Amount = outcome.Amount,
			BidTimeoutSeconds = outcome.BidTimeoutSeconds
		};
	}
}

/// <summary>
/// Handles the PassAuction command - player passes on bidding.
/// Validates and delegates to AuctionRulebook.
/// </summary>
public class PassAuctionHandler : ICommandHandler<PassAuctionCommand>
{
	private readonly IAuctionRulebook _rulebook;

	public PassAuctionHandler(IAuctionRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(PassAuctionCommand command, GameContext context)
	{
		var outcome = await _rulebook.PassAuctionAsync(
			command.PlayerId,
			command.SquareIndex,
			context);

		if (outcome.AsError() is { } outcomeError)
		{
			return outcomeError;
		}

		// Announce pass
		await context.Announce("game.auction_pass", new Dictionary<string, object>
		{
			["player"] = outcome.PlayerName!
		});

		// If auction ended, return final result
		if (outcome.AuctionEnded && outcome.FinalResult != null)
		{
			var final = outcome.FinalResult;

			// Announce result
			if (final.PropertySold)
			{
				await context.Announce("game.auction_won", new Dictionary<string, object>
				{
					["actorId"] = final.WinnerId!,
					["player"] = final.WinnerName!,
					["property"] = final.SquareName!,
					["amount"] = final.WinningBid!
				});
			}
			else
			{
				await context.Announce("game.auction_no_bids", new Dictionary<string, object>
				{
					["property"] = final.SquareName!
				});
			}

			return new AuctionEndedResponse
			{
				SquareIndex = final.SquareIndex,
				SquareName = final.SquareName ?? string.Empty,
				WinnerId = final.WinnerId,
				WinnerName = final.WinnerName,
				WinningBid = final.WinningBid,
				PropertySold = final.PropertySold,
				NextPlayerId = final.NextPlayerId,
				NextPlayerName = final.NextPlayerName
			};
		}

		return new AuctionPassedResponse
		{
			SquareIndex = outcome.SquareIndex,
			PlayerId = outcome.PlayerId ?? string.Empty,
			PlayerName = outcome.PlayerName ?? string.Empty,
			RemainingBidders = outcome.RemainingBidders
		};
	}
}

/// <summary>
/// Handles the EndAuction command - ends auction due to timeout.
/// Validates and delegates to AuctionRulebook.
/// </summary>
public class EndAuctionHandler : ICommandHandler<EndAuctionCommand>
{
	private readonly IAuctionRulebook _rulebook;

	public EndAuctionHandler(IAuctionRulebook rulebook)
	{
		_rulebook = rulebook;
	}

	public async Task<ServerResponse> HandleAsync(EndAuctionCommand command, GameContext context)
	{
		if (!_rulebook.HasActiveAuction(context))
		{
			return new ErrorResponse { Message = "No active auction", Code = "NO_ACTIVE_AUCTION" };
		}

		var outcome = await _rulebook.EndAuctionAsync(context);

		// Announce result
		if (outcome.PropertySold)
		{
			await context.Announce("game.auction_won", new Dictionary<string, object>
			{
				["actorId"] = outcome.WinnerId!,
				["player"] = outcome.WinnerName!,
				["property"] = outcome.SquareName!,
				["amount"] = outcome.WinningBid!
			});
		}
		else
		{
			await context.Announce("game.auction_no_bids", new Dictionary<string, object>
			{
				["property"] = outcome.SquareName!
			});
		}

		return new AuctionEndedResponse
		{
			SquareIndex = outcome.SquareIndex,
			SquareName = outcome.SquareName ?? string.Empty,
			WinnerId = outcome.WinnerId,
			WinnerName = outcome.WinnerName,
			WinningBid = outcome.WinningBid,
			PropertySold = outcome.PropertySold,
			NextPlayerId = outcome.NextPlayerId,
			NextPlayerName = outcome.NextPlayerName
		};
	}
}
