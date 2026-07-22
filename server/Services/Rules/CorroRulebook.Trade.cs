using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

/// <summary>
/// CorroRulebook - TRADING
///
/// Player-to-player trades. Each side may put properties, cash and "get out of holding free"
/// cards on the table. While a trade is pending the dispatcher freezes the game, so the
/// assets cannot change between proposal and resolution: validation happens up front and is
/// only re-checked defensively on accept.
///
/// Rules enforced here:
/// - You cannot trade with yourself, and both players must exist.
/// - A trade must move at least one asset.
/// - Each offered property must be owned by the offering player.
/// - No traded property may belong to a colour group that has buildings on it.
/// - Each side must actually have the money / release passes it offers (trades never create debt).
/// Mortgaged properties keep their mortgaged state across the swap automatically.
/// </summary>
public partial class CorroRulebook
{
	// ============================================================
	// SECTION: PROPOSE
	// ============================================================

	public async Task<TradeOutcome> ProposeTradeAsync(TradeState trade, GameContext context)
	{
		if (context.GameState.ActiveTrade is { IsActive: true })
		{
			return Fail("A trade is already in progress", "TRADE_IN_PROGRESS");
		}

		var (ok, code) = ValidateTrade(context.GameState, trade, context.Settings);
		if (!ok)
		{
			return Fail(TradeErrorMessage(code!), code!, trade);
		}

		trade.IsActive = true;
		context.GameState.ActiveTrade = trade;

		context.Logger?.LogDebug("Trade {TradeId}: {Initiator} -> {Target} proposed", trade.Id, trade.InitiatorName, trade.TargetName);

		await context.Announce("game.trade_proposed", new Dictionary<string, object>
		{
			["actorId"] = trade.InitiatorId,
			["initiator"] = trade.InitiatorName,
			["target"] = trade.TargetName
		});

		return new TradeOutcome { Success = true, Trade = trade, Outcome = "proposed" };
	}

	// ============================================================
	// SECTION: ACCEPT
	// ============================================================

	public async Task<TradeOutcome> AcceptTradeAsync(string responderId, string tradeId, GameContext context)
	{
		var trade = context.GameState.ActiveTrade;
		if (trade == null || !trade.IsActive || trade.Id != tradeId)
		{
			return Fail("No active trade", "NO_ACTIVE_TRADE");
		}

		if (trade.TargetId != responderId)
		{
			return Fail("You are not the target of this trade", "NOT_TRADE_TARGET", trade);
		}

		// Defensive re-validation. The freeze guarantees assets did not change since the
		// proposal, so this should always pass; if it somehow fails we discard the trade
		// rather than execute a corrupt swap.
		var (ok, code) = ValidateTrade(context.GameState, trade, context.Settings);
		if (!ok)
		{
			trade.IsActive = false;
			context.GameState.ActiveTrade = null;
			return new TradeOutcome
			{
				Success = false,
				Error = TradeErrorMessage(code!),
				ErrorCode = code,
				Trade = trade,
				Outcome = "declined"
			};
		}

		await ExecuteSwapAsync(trade, context);

		trade.IsActive = false;
		context.GameState.ActiveTrade = null;

		context.Logger?.LogDebug("Trade {TradeId}: accepted by {Target}", trade.Id, trade.TargetName);

		await context.Announce("game.trade_completed", new Dictionary<string, object>
		{
			["actorId"] = trade.TargetId,
			["initiator"] = trade.InitiatorName,
			["target"] = trade.TargetName,
			["offered"] = DescribeTradeAssets(trade.Initiator, context),
			["requested"] = DescribeTradeAssets(trade.Target, context),
			["offeredCards"] = trade.Initiator.ReleasePasses,
			["requestedCards"] = trade.Target.ReleasePasses
		});

		return new TradeOutcome { Success = true, Trade = trade, Outcome = "accepted" };
	}

	// ============================================================
	// SECTION: DECLINE
	// ============================================================

	public async Task<TradeOutcome> DeclineTradeAsync(string responderId, string tradeId, GameContext context)
	{
		var trade = context.GameState.ActiveTrade;
		if (trade == null || !trade.IsActive || trade.Id != tradeId)
		{
			return Fail("No active trade", "NO_ACTIVE_TRADE");
		}

		if (trade.TargetId != responderId)
		{
			return Fail("You are not the target of this trade", "NOT_TRADE_TARGET", trade);
		}

		trade.IsActive = false;
		context.GameState.ActiveTrade = null;

		context.Logger?.LogDebug("Trade {TradeId}: declined by {Target}", trade.Id, trade.TargetName);

		await context.Announce("game.trade_declined", new Dictionary<string, object>
		{
			["actorId"] = trade.TargetId,
			["initiator"] = trade.InitiatorName,
			["target"] = trade.TargetName
		});

		return new TradeOutcome { Success = true, Trade = trade, Outcome = "declined" };
	}

	// ============================================================
	// SECTION: CANCEL
	// ============================================================

	public async Task<TradeOutcome> CancelTradeAsync(string initiatorId, string? tradeId, GameContext context)
	{
		var trade = context.GameState.ActiveTrade;
		if (trade == null || !trade.IsActive || (tradeId != null && trade.Id != tradeId))
		{
			return Fail("No active trade", "NO_ACTIVE_TRADE");
		}

		if (trade.InitiatorId != initiatorId)
		{
			return Fail("You did not propose this trade", "NOT_TRADE_INITIATOR", trade);
		}

		trade.IsActive = false;
		context.GameState.ActiveTrade = null;

		context.Logger?.LogDebug("Trade {TradeId}: cancelled by {Initiator}", trade.Id, trade.InitiatorName);

		await context.Announce("game.trade_cancelled", new Dictionary<string, object>
		{
			["actorId"] = trade.InitiatorId,
			["initiator"] = trade.InitiatorName,
			["target"] = trade.TargetName
		});

		return new TradeOutcome { Success = true, Trade = trade, Outcome = "cancelled" };
	}

	// ============================================================
	// SECTION: VALIDATION (pure)
	// ============================================================

	/// <summary>
	/// Pure validation of a trade against a game state. Returns (true, null) when the trade is
	/// legal, otherwise (false, errorCode). Kept static and side-effect free so it can be unit
	/// tested directly and reused as a defensive re-check on accept.
	/// </summary>
	/// <summary>
	/// Build a short, human-readable summary of one side of a trade for the public
	/// "trade completed" announcement (so every player — not just the two participants —
	/// learns what changed hands). Property names come straight from the board (already a
	/// single language, like the rest of the game) and money uses the locale-neutral
	/// "euros" wording; release-pass cards are localised separately in the announcement
	/// template. Returns an em dash when the side puts no property or cash on the table.
	/// </summary>
	private static string DescribeTradeAssets(TradeOffer offer, GameContext context)
	{
		var parts = new List<string>();
		foreach (var index in offer.Properties)
		{
			var square = context.Helper.GetSquare(index);
			if (square != null)
			{
				parts.Add(square.Name);
			}
		}
		if (offer.Money > 0)
		{
			parts.Add($"{offer.Money} euros");
		}

		return parts.Count > 0 ? string.Join(", ", parts) : "—";
	}

	internal static (bool Ok, string? Code) ValidateTrade(GameState state, TradeState trade, GameSettings? settings = null)
	{
		if (trade.InitiatorId == trade.TargetId)
		{
			return (false, "SELF_TRADE");
		}

		var initiator = state.Players.FirstOrDefault(p => p.Id == trade.InitiatorId);
		var target = state.Players.FirstOrDefault(p => p.Id == trade.TargetId);
		if (initiator == null || target == null)
		{
			return (false, "PLAYER_NOT_FOUND");
		}

		// A bankrupt player is out of the game — you can't trade assets to or from them.
		if (initiator.IsBankrupt || target.IsBankrupt)
		{
			return (false, "PLAYER_BANKRUPT");
		}

		var give = trade.Initiator;
		var get = trade.Target;

		if (give.IsEmpty && get.IsEmpty)
		{
			return (false, "EMPTY_TRADE");
		}

		if (give.Money < 0 || get.Money < 0 || give.ReleasePasses < 0 || get.ReleasePasses < 0)
		{
			return (false, "INVALID_TRADE");
		}

		// No duplicated properties within a side, nor the same property on both sides.
		if (give.Properties.Distinct().Count() != give.Properties.Count)
		{
			return (false, "INVALID_TRADE");
		}

		if (get.Properties.Distinct().Count() != get.Properties.Count)
		{
			return (false, "INVALID_TRADE");
		}

		if (give.Properties.Intersect(get.Properties).Any())
		{
			return (false, "INVALID_TRADE");
		}

		// Ownership of every offered property.
		foreach (var idx in give.Properties)
		{
			var sq = SquareAt(state, idx);
			if (sq == null || sq.OwnerId != trade.InitiatorId)
			{
				return (false, "NOT_OWNER");
			}
		}
		foreach (var idx in get.Properties)
		{
			var sq = SquareAt(state, idx);
			if (sq == null || sq.OwnerId != trade.TargetId)
			{
				return (false, "NOT_OWNER");
			}
		}

		// No buildings anywhere in the colour group of any traded property.
		foreach (var idx in give.Properties.Concat(get.Properties))
		{
			if (GroupHasBuildings(state, idx))
			{
				return (false, "GROUP_HAS_BUILDINGS");
			}
		}

		// Each side must actually own the cash and release passes it offers.
		if (initiator.Money < give.Money || target.Money < get.Money)
		{
			return (false, "INSUFFICIENT_FUNDS");
		}

		if (initiator.ReleasePasses < give.ReleasePasses || target.ReleasePasses < get.ReleasePasses)
		{
			return (false, "INSUFFICIENT_RELEASE_PASSES");
		}

		// Acquiring a MORTGAGED property costs the receiver 10% interest to the bank
		// (see ExecuteSwapAsync). A trade is voluntary, so it may never push anyone below zero:
		// each side must stay solvent AFTER the cash swap AND that fee — otherwise they have to
		// raise the money first. This is exactly why the receiver can never be charged what they
		// don't have: the trade is rejected up front instead.
		var s = settings ?? new GameSettings();
		var initiatorFee = MortgageTransferFee(state, get.Properties, s);   // initiator receives target's lots
		var targetFee = MortgageTransferFee(state, give.Properties, s);     // target receives initiator's lots
		if (initiator.Money + get.Money - give.Money - initiatorFee < 0 ||
			target.Money + give.Money - get.Money - targetFee < 0)
		{
			return (false, "INSUFFICIENT_FUNDS");
		}

		return (true, null);
	}

	/// <summary>
	/// Total bank interest the receiver owes for the mortgaged lots among <paramref name="propertyIndices"/>:
	/// the mortgage interest rate applied to each lot's mortgage value. Unmortgaged lots cost nothing.
	/// </summary>
	private static int MortgageTransferFee(GameState state, IEnumerable<int> propertyIndices, GameSettings settings)
		=> propertyIndices.Sum(idx =>
		{
			var sq = SquareAt(state, idx);
			if (sq is not { Mortgaged: true } || sq.Price is not int price)
			{
				return 0;
			}

			return MortgageValueOf(price, settings) * settings.MortgageInterestRate / 100;
		});

	private static Square? SquareAt(GameState state, int index)
		=> index >= 0 && index < state.Squares.Count ? state.Squares[index] : null;

	/// <summary>
	/// True when the square itself, or any square sharing its colour group, has smallBuildings or a
	/// bigBuilding. Such properties cannot be traded until the buildings are sold.
	/// </summary>
	private static bool GroupHasBuildings(GameState state, int squareIndex)
	{
		var sq = SquareAt(state, squareIndex);
		if (sq == null)
		{
			return false;
		}

		if (sq.SmallBuildings > 0 || sq.BigBuildings > 0)
		{
			return true;
		}

		if (string.IsNullOrEmpty(sq.Color))
		{
			return false;
		}

		return state.Squares.Any(s => s.Color == sq.Color && (s.SmallBuildings > 0 || s.BigBuildings > 0));
	}

	// ============================================================
	// SECTION: SWAP (mutation)
	// ============================================================

	private static async Task ExecuteSwapAsync(TradeState trade, GameContext context)
	{
		// Properties both directions. Mortgaged state rides along on the Square object.
		foreach (var idx in trade.Initiator.Properties)
		{
			await TransferPropertyAsync(context, idx, trade.InitiatorId, trade.TargetId);
		}

		foreach (var idx in trade.Target.Properties)
		{
			await TransferPropertyAsync(context, idx, trade.TargetId, trade.InitiatorId);
		}

		// Net cash transfer (validated affordable, so this never creates debt). Route it through
		// the bank helper — NOT a bare `player.Money +=` — so the RECEIVER is flagged a money
		// gainer: the post-command debt sweep then clears any debt they can now afford from the
			   // trade cash (a mortgage/rent-style payout that a direct mutation silently skipped).
		var net = trade.Initiator.Money - trade.Target.Money; // positive = initiator pays target
		context.Helper.AddPlayerMoney(trade.InitiatorId, -net);
		context.Helper.AddPlayerMoney(trade.TargetId, net);

		// Holding cards.
		for (var i = 0; i < trade.Initiator.ReleasePasses; i++)
		{
			context.Helper.RemovePlayerReleasePass(trade.InitiatorId);
			context.Helper.AddPlayerReleasePass(trade.TargetId);
		}
		for (var i = 0; i < trade.Target.ReleasePasses; i++)
		{
			context.Helper.RemovePlayerReleasePass(trade.TargetId);
			context.Helper.AddPlayerReleasePass(trade.InitiatorId);
		}
	}

	private static async Task TransferPropertyAsync(GameContext context, int squareIndex, string fromId, string toId)
	{
		context.Helper.RemovePlayerProperty(fromId, squareIndex);
		context.Helper.AddPlayerProperty(toId, squareIndex);

		var square = context.Helper.GetSquare(squareIndex);
		if (square == null)
		{
			return;
		}

		square.OwnerId = toId;

		// Official rule: acquiring a MORTGAGED property costs the new owner 10% interest on the
		// mortgage value, paid to the bank now (the lot stays mortgaged; lifting it later costs the
		// mortgage value plus another 10%). ValidateTrade already guaranteed the receiver can afford
		// this, so it never drives anyone negative.
		if (square is { Mortgaged: true } && square.Price is int price)
		{
			var fee = MortgageValueOf(price, context.Settings) * context.Settings.MortgageInterestRate / 100;
			if (fee > 0)
			{
				context.Helper.AddPlayerMoney(toId, -fee);
				context.Helper.SetBankMoney(context.Helper.GetBankMoney() + fee);
				await context.Announce("game.mortgage_transfer_fee", new Dictionary<string, object>
				{
					["actorId"] = toId,
					["player"] = context.Helper.GetPlayer(toId)?.Name ?? toId,
					["property"] = SquareNameVar(square),
					["amount"] = fee
				});
			}
		}

		await context.Presenter.NotifySquareChangedAsync(square);
	}

	// ============================================================
	// SECTION: HELPERS
	// ============================================================

	private static TradeOutcome Fail(string message, string code, TradeState? trade = null)
		=> new() { Success = false, Error = message, ErrorCode = code, Trade = trade };

	private static string TradeErrorMessage(string code) => code switch
	{
		"SELF_TRADE" => "You cannot trade with yourself",
		"PLAYER_NOT_FOUND" => "Player not found",
		"PLAYER_BANKRUPT" => "You cannot trade with a bankrupt player",
		"EMPTY_TRADE" => "A trade must include at least one asset",
		"INVALID_TRADE" => "Invalid trade",
		"NOT_OWNER" => "A traded property is not owned by the offering player",
		"GROUP_HAS_BUILDINGS" => "Properties whose colour group has buildings cannot be traded",
		"INSUFFICIENT_FUNDS" => "Not enough money for this trade",
		"INSUFFICIENT_RELEASE_PASSES" => "Not enough release passes for this trade",
		"TRADE_IN_PROGRESS" => "A trade is already in progress",
		_ => "Trade rejected"
	};
}
