using CorroServer.Models;

namespace CorroServer.Services.Bots;

/// <summary>
/// The property bot: a solid, cautious club player. It plays its own turn
/// (holding → roll → buy → build → end) and honours the off-turn obligations that FREEZE the table
/// — settling a debt, answering a trade, bidding in an auction. Every branch returns a LEGAL
/// command, and each "I can't afford it" path ends in a valid fallback (decline, pass, or
/// bankruptcy) rather than a command the driver would see rejected and never retry — so a bot
/// seat can never wedge the game.
///
/// Strategy: buy anything it can afford; build houses evenly on a colour group it owns outright
/// while keeping a cash cushion (it stops at four houses — no hotels — to stay clear of the
/// house→hotel edge); in an auction bid the minimum up to the square's face value; accept a
/// trade only when it nets face value AND does not break one of its own monopolies; raise a
/// debt by selling houses then mortgaging, and go bankrupt only when genuinely insolvent.
/// </summary>
public sealed class PropertyBotPolicy : IBotPolicy
{
	public string GameType => "property";

	/// <summary>Cash kept back before spending on houses or auction bids, so a single rent can't ruin it.</summary>
	private const int CashCushion = 250;

	/// <summary>Houses per property before the bot stops (skips the hotel step on purpose).</summary>
	private const int MaxHouses = 4;

	/// <summary>The bank's house stock (default rules): never start a build the bank couldn't honour.</summary>
	private const int BankHouseStock = 32;

	public GameCommand? Decide(GameState view, string botId)
	{
		if (view.IsGameOver)
		{
			return null;
		}

		var me = view.Players.FirstOrDefault(p => p.Id == botId);
		if (me is null || me.Status != PlayerStatus.Active)
		{
			return null;
		}

		// ── Obligations that FREEZE the whole game come first (on anyone's turn) ────────────────

		// 1. A debt I owe blocks everything until it clears. Raise cash, or fall on my sword.
		var myDebt = view.PendingDebts.Where(d => d.DebtorId == botId).Sum(d => d.Amount);
		if (myDebt > 0)
		{
			return ResolveDebt(view, me, myDebt);
		}

		// 2. A pending trade freezes play. Answer one addressed to me; otherwise wait it out.
		if (view.ActiveTrade is { IsActive: true } trade)
		{
			return trade.TargetId == botId ? RespondToTrade(view, me, trade) : null;
		}

		// 3. An auction I'm still in: bid the minimum up to face value, else pass. If I'm already
		//    the high bidder, wait for rivals / the timeout.
		if (view.ActiveAuction is { IsActive: true } auction && !auction.PassedPlayers.Contains(botId))
		{
			return auction.HighestBidderId == botId ? null : BidOrPass(view, me, auction);
		}

		// ── From here on it must be my turn ────────────────────────────────────────────────────
		if (view.CurrentTurn != botId)
		{
			return null;
		}

		// 4. In holding, before rolling: spend a free card if held, else roll for doubles — the engine
		//    handles the three-strikes forced payment, so rolling is always a legal move.
		if (me.IsHeld && !view.HasRolledThisTurn)
		{
			return me.ReleasePasses > 0
				? new UseReleasePassCommand { PlayerId = botId }
				: new RollDiceCommand { PlayerId = botId };
		}

		// 5. Haven't rolled yet → roll.
		if (!view.HasRolledThisTurn)
		{
			return new RollDiceCommand { PlayerId = botId };
		}

		// 7. A property I just landed on: buy if I can afford it, else decline — rolling again when
		//    doubles are owed, otherwise ending the turn (both forfeit it to the auction/bank).
		if (view.PendingPurchase is { } pending && pending.PlayerId == botId)
		{
			if (me.Money >= pending.Price)
			{
				return new BuyPropertyCommand { PlayerId = botId, SquareIndex = pending.SquareIndex };
			}
			return view.MustRollAgain
				? new RollDiceCommand { PlayerId = botId }
				: new EndTurnCommand { PlayerId = botId };
		}

		// 8. Owe another roll (doubles) → take it before anything else.
		if (view.MustRollAgain)
		{
			return new RollDiceCommand { PlayerId = botId };
		}

		// 9. Develop a completed colour group while the cushion holds.
		var build = ChooseBuild(view, me);
		if (build is not null)
		{
			return build;
		}

		// 10. Nothing left → end the turn.
		return new EndTurnCommand { PlayerId = botId };
	}

	// ── Debt ─────────────────────────────────────────────────────────────────────────────────

	private static GameCommand ResolveDebt(GameState view, Player me, int debt)
	{
		// Enough cash? Pay it (the engine's post-command sweep also auto-clears a funded debt).
		if (me.Money >= debt)
		{
			return new ResolveDebtCommand { PlayerId = me.Id };
		}

		// Sell a house first, from the most-built square of a group that still has houses — the only
		// even (hence legal) way to sell. Small houses only: a hotel-only group falls through to the
		// mortgage / bankruptcy path rather than risk an illegal sale.
		var sell = view.Squares
			.Where(s => s.OwnerId == me.Id && s.SmallBuildings > 0)
			.OrderByDescending(s => s.SmallBuildings + s.BigBuildings * 5)
			.FirstOrDefault();
		if (sell is not null)
		{
			return new SellBuildingsCommand { PlayerId = me.Id, SquareIndex = sell.Id, Count = 1 };
		}

		// Then mortgage — cheapest first, and only a property whose whole colour group is house-free
		// (mortgaging with houses standing is illegal).
		var mortgage = view.Squares
			.Where(s => s.OwnerId == me.Id && !s.Mortgaged && s.Price.HasValue && GroupIsHouseFree(view, s))
			.OrderBy(s => s.Price)
			.FirstOrDefault();
		if (mortgage is not null)
		{
			return new MortgagePropertyCommand { PlayerId = me.Id, SquareIndex = mortgage.Id };
		}

		// Nothing left to liquidate and still short → bankrupt (always legal; clears the freeze).
		return new DeclareBankruptcyCommand { PlayerId = me.Id };
	}

	private static bool GroupIsHouseFree(GameState view, Square square)
		=> !view.Squares.Any(x => x.Color == square.Color && (x.SmallBuildings > 0 || x.BigBuildings > 0));

	// ── Trades (the bot only ANSWERS; it never proposes) ───────────────────────────────────────

	private static GameCommand RespondToTrade(GameState view, Player me, TradeState trade)
	{
		// I'm the target: Initiator is what I RECEIVE, Target is what I GIVE.
		int Worth(TradeOffer offer) => offer.Money + offer.ReleasePasses * 50
			+ offer.Properties.Sum(i => view.Squares.FirstOrDefault(s => s.Id == i)?.Price ?? 0);

		var breaksMyCompleteGroup = trade.Target.Properties.Any(i =>
			view.Squares.FirstOrDefault(s => s.Id == i) is { } sq && IOwnWholeGroup(view, me.Id, sq.Color));

		var affordable = me.Money >= trade.Target.Money;
		var worthIt = !breaksMyCompleteGroup && affordable && Worth(trade.Initiator) > Worth(trade.Target);
		return new RespondTradeCommand { PlayerId = me.Id, TradeId = trade.Id, Accept = worthIt };
	}

	private static bool IOwnWholeGroup(GameState view, string playerId, string? color)
	{
		if (color is null)
		{
			return false;
		}
		var group = view.Squares.Where(s => s.Color == color && s.Price.HasValue).ToList();
		return group.Count > 0 && group.All(s => s.OwnerId == playerId);
	}

	// ── Auctions ───────────────────────────────────────────────────────────────────────────────

	private static GameCommand BidOrPass(GameState view, Player me, AuctionState auction)
	{
		var faceValue = view.Squares.FirstOrDefault(s => s.Id == auction.SquareIndex)?.Price ?? 0;
		var ceiling = Math.Min(faceValue, Math.Max(0, me.Money - CashCushion));
		var next = auction.CurrentBid + 1;
		return next <= ceiling
			? new PlaceBidCommand { PlayerId = me.Id, SquareIndex = auction.SquareIndex, Amount = next }
			: new PassAuctionCommand { PlayerId = me.Id, SquareIndex = auction.SquareIndex };
	}

	// ── Building (houses only, evenly, within the cushion and the bank's stock) ─────────────────

	private static GameCommand? ChooseBuild(GameState view, Player me)
	{
		if (me.Money < CashCushion)
		{
			return null;
		}

		var housesPlaced = view.Squares.Sum(s => s.SmallBuildings);
		if (housesPlaced >= BankHouseStock)
		{
			return null;
		}

		int Level(Square s) => s.BigBuildings * 5 + s.SmallBuildings;

		foreach (var group in view.Squares
			.Where(s => s.Color is not null && s.BuildingCost.HasValue && s.Rent is not null)
			.GroupBy(s => s.Color!))
		{
			var squares = group.ToList();
			// A house-buildable group I own outright, nothing mortgaged.
			if (!squares.All(s => s.OwnerId == me.Id && !s.Mortgaged))
			{
				continue;
			}

			// Even building: raise the least-developed square, up to four houses.
			var target = squares.OrderBy(Level).First();
			var cost = target.BuildingCost!.Value;
			if (Level(target) >= MaxHouses || me.Money - cost < CashCushion)
			{
				continue;
			}

			return new BuildCommand { PlayerId = me.Id, SquareIndex = target.Id, Count = 1 };
		}

		return null;
	}
}
