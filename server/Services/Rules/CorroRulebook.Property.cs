using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro;

namespace CorroServer.Services.Rules;

/// <summary>
/// CorroRulebook - PROPERTY RULES
///
/// Property mechanics in Corro:
/// 1. Land on unowned property → can buy or auction
/// 2. Land on owned property → pay rent
/// 3. Rent varies by: property type, smallBuildings/bigBuildings, classic, mortgaged
/// </summary>
public partial class CorroRulebook
{
	// ============================================================
	// SECTION: BUYING PROPERTIES
	// ============================================================

	public async Task<PropertyPurchaseOutcome> BuyPropertyAsync(Player player, int squareIndex, GameContext context)
	{
		context.Logger?.LogDebug("Rulebook: {PlayerName} buying property at {SquareIndex}", player.Name, squareIndex);

		// Validate pending purchase
		var pending = context.GameState.PendingPurchase;
		if (pending == null || pending.PlayerId != player.Id)
		{
			return new PropertyPurchaseOutcome
			{
				Success = false,
				Error = "No pending purchase for this player",
				ErrorCode = "NO_PENDING_PURCHASE"
			};
		}

		if (pending.SquareIndex != squareIndex)
		{
			return new PropertyPurchaseOutcome
			{
				Success = false,
				Error = "Square mismatch",
				ErrorCode = "SQUARE_MISMATCH"
			};
		}

		var square = context.Helper.GetSquare(squareIndex);
		if (square == null || !square.Price.HasValue)
		{
			return new PropertyPurchaseOutcome
			{
				Success = false,
				Error = "Property not for sale",
				ErrorCode = "NOT_FOR_SALE"
			};
		}

		if (!string.IsNullOrEmpty(square.OwnerId))
		{
			return new PropertyPurchaseOutcome
			{
				Success = false,
				Error = "Property already owned",
				ErrorCode = "ALREADY_OWNED"
			};
		}

		var price = square.Price.Value;
		if (context.Helper.GetPlayerMoney(player.Id) < price)
		{
			return new PropertyPurchaseOutcome
			{
				Success = false,
				Error = "Insufficient funds",
				ErrorCode = "INSUFFICIENT_FUNDS"
			};
		}

		// Execute purchase
		context.Helper.AddPlayerMoney(player.Id, -price);
		context.Helper.SetBankMoney(context.Helper.GetBankMoney() + price);
		square.OwnerId = player.Id;
		context.Helper.AddPlayerProperty(player.Id, squareIndex);

		// Clear pending
		context.GameState.PendingPurchase = null;

		await context.Presenter.NotifySquareChangedAsync(square);
		await context.Announce("game.property_purchased", new Dictionary<string, object>
		{
			["actorId"] = player.Id,
			["player"] = player.Name,
			["property"] = SquareNameVar(square),
			["price"] = price
		});

		// If this purchase completes a colour group (or all railroads / utilities),
		// tell everyone — owning a full set unlocks rent doubling and building.
		await AnnounceSetCompletionAsync(player, square, context);

		context.Logger?.LogDebug("{PlayerName} bought {SquareName} for {Price}€", player.Name, square.Name, price);

		// The turn does NOT advance here. Buying is a turn action; the player keeps
		// control and ends the turn explicitly (any doubles re-roll obligation is
		// tracked by GameState.MustRollAgain, set when the dice were rolled).
		return new PropertyPurchaseOutcome
		{
			Success = true,
			SquareIndex = squareIndex,
			SquareName = square.Name,
			Price = price,
			RemainingMoney = context.Helper.GetPlayerMoney(player.Id)
		};
	}

	/// <summary>
	/// Announces when a just-acquired square completes a full set: a colour group, all
	/// railroads, or both utilities. Ownership is checked ignoring mortgages — owning the
	/// set is what matters for the announcement (rent doubling / building eligibility).
	/// </summary>
	private async Task AnnounceSetCompletionAsync(Player player, Square square, GameContext context)
	{
		// Completing ANY group (every ownable square sharing this square's group id is now yours) is
		// announced the same way, by the group's own name key — no privileged property/railroad/utility.
		var groupId = square.Key;
		if (string.IsNullOrEmpty(groupId))
		{
			return;
		}

		var group = context.Helper.GetSquares().Where(s => s.Key == groupId && s.Price.HasValue).ToList();
		if (group.Count > 0 && group.All(s => s.OwnerId == player.Id))
		{
			await context.Announce("game.group_completed", new Dictionary<string, object>
			{
				["actorId"] = player.Id,
				["player"] = player.Name,
				["colorKey"] = square.GroupNameKey ?? groupId // group's name key; nested via $t client-side
			});
		}
	}

	public async Task<PropertyDeclineOutcome> DeclinePropertyAsync(Player player, int squareIndex, GameContext context)
	{
		context.Logger?.LogDebug("Rulebook: {PlayerName} declining property at {SquareIndex}", player.Name, squareIndex);

		// Validate pending purchase
		var pending = context.GameState.PendingPurchase;
		if (pending == null || pending.PlayerId != player.Id)
		{
			return new PropertyDeclineOutcome
			{
				Success = false,
				Error = "No pending purchase for this player",
				ErrorCode = "NO_PENDING_PURCHASE"
			};
		}

		if (pending.SquareIndex != squareIndex)
		{
			return new PropertyDeclineOutcome
			{
				Success = false,
				Error = "Square mismatch",
				ErrorCode = "SQUARE_MISMATCH"
			};
		}

		var square = context.Helper.GetSquare(squareIndex);
		if (square == null)
		{
			return new PropertyDeclineOutcome
			{
				Success = false,
				Error = "Invalid square",
				ErrorCode = "INVALID_SQUARE"
			};
		}

		// Clear pending purchase
		context.GameState.PendingPurchase = null;

		await context.Announce("game.property_declined", new Dictionary<string, object>
		{
			["actorId"] = player.Id,
			["player"] = player.Name,
			["property"] = SquareNameVar(square)
		});

		// SmallBuilding rule: when auctions on decline are disabled, declining simply ends the
		// buy offer. The turn does NOT advance here — declining is reached via EndTurn,
		// which advances the turn once the pending purchase is resolved.
		if (!context.Settings.AuctionOnDecline)
		{
			return new PropertyDeclineOutcome
			{
				Success = true,
				SquareIndex = squareIndex,
				SquareName = square.Name,
				AuctionStarted = false
			};
		}

		// Start auction (delegate to AuctionRulebook)
		var auction = new AuctionState
		{
			SquareIndex = squareIndex,
			SquareName = square.Name,
			StartingPrice = 1,
			CurrentBid = 0,
			HighestBidderId = null,
			HighestBidderName = null,
			Bids = new List<AuctionBid>(),
			PassedPlayers = new HashSet<string>(),
			StartedAt = DateTime.UtcNow,
			BidTimeout = TimeSpan.FromSeconds(context.Settings.AuctionBidTimeoutSeconds),
			CurrentPhaseStartedAt = DateTime.UtcNow,
			InitiatorPlayerId = player.Id,
			IsActive = true
		};

		context.GameState.ActiveAuction = auction;

		await context.Announce("game.auction_started", new Dictionary<string, object>
		{
			["property"] = SquareNameVar(square),
			["player"] = player.Name
		});

		context.Logger?.LogInformation("Auction started for {SquareName}", square.Name);

		return new PropertyDeclineOutcome
		{
			Success = true,
			SquareIndex = squareIndex,
			SquareName = square.Name,
			AuctionStarted = true
		};
	}

	// ============================================================
	// SECTION: PROPERTY LANDING ANALYSIS
	// ============================================================

	private record LandingInfo
	{
		public required Square Square { get; init; }
		public int SquareIndex { get; init; }
		public bool CanBuy { get; init; }
		public bool CanAfford { get; init; }
	}

	private LandingInfo AnalyzeLanding(int squareIndex, string playerId, GameContext context)
	{
		var square = context.Helper.GetSquare(squareIndex);

		if (square == null)
		{
			return new LandingInfo
			{
				Square = new Square { Id = squareIndex, Name = "Unknown" },
				SquareIndex = squareIndex,
				CanBuy = false,
				CanAfford = false
			};
		}

		// Ownable == has a purchase price (set by the adapter only for ownable squares); no privileged
		// type. Corners/tax/decks carry no Price, so this excludes them on any board.
		var canBuy = square.Price.HasValue
			&& string.IsNullOrEmpty(square.OwnerId);

		var playerMoney = context.Helper.GetPlayerMoney(playerId);
		var canAfford = canBuy && playerMoney >= square.Price;

		return new LandingInfo
		{
			Square = square,
			SquareIndex = squareIndex,
			CanBuy = canBuy,
			CanAfford = canAfford
		};
	}

	private void SetupPendingPurchaseIfNeeded(LandingInfo landing, string playerId, GameContext context)
	{
		if (!landing.CanBuy || landing.Square.Price == null)
		{
			return;
		}

		context.GameState.PendingPurchase = new PendingPurchase
		{
			PlayerId = playerId,
			SquareIndex = landing.SquareIndex,
			SquareName = landing.Square.Name,
			Price = landing.Square.Price.Value
		};

		context.Logger?.LogDebug("PendingPurchase: {SquareName} for {Price}€", landing.Square.Name, landing.Square.Price);
	}

	/// <summary>
	/// The purchase fields for a dice-roll response. A movement card can teleport the
	/// player onto a buyable square AFTER the initial landing analysis, so the live
	/// <see cref="GameState.PendingPurchase"/> (set while resolving the landing) is the
	/// source of truth; the pre-landing <paramref name="landing"/> is the fallback when
	/// no purchase is pending.
	/// </summary>
	private (string squareName, int? price, bool canBuy, bool canAfford) ResolvePurchaseResponse(
		LandingInfo landing, string playerId, GameContext context)
	{
		var pending = context.GameState.PendingPurchase;
		if (pending != null && pending.PlayerId == playerId)
		{
			var canAfford = context.Helper.GetPlayerMoney(playerId) >= pending.Price;
			return (pending.SquareName, pending.Price, true, canAfford);
		}

		return (landing.Square.Name, landing.Square.Price, landing.CanBuy, landing.CanAfford);
	}

	// ============================================================
	// SECTION: RENT CALCULATION
	// ============================================================

	// Rent dispatches on a GENERIC strategy per square type, read from the game's rent rules
	// (context.RentRules — the classic config by default, or a loaded .corro package's).
	// The rulebook no longer hardcodes per-type formulas.
	private int CalculateRent(Square square, Player landlord, GameContext context)
	{
		var modifier = context.PendingRentModifier;
		var type = square.Type?.ToLower() ?? "";
		var squares = context.Helper.GetSquares();
		var rules = context.RentRules;

		var baseRent = rules.RentStrategies.GetValueOrDefault(type, "") switch
		{
			// Property: building table. Uses OWNERSHIP of the whole colour group for the unimproved
			// double (a mortgaged group-mate doesn't stop the unmortgaged lots charging double); the
			// multiplier and the no-rent-table fallback live in PropertyRentFor.
			"buildingTable" => PropertyRentFor(
				square.Rent, square.Price, square.SmallBuildings, square.BigBuildings,
				OwnsWholeGroup(landlord.Id, square.Color, context),
				context.Settings.UnimprovedFullGroupRentMultiplier),

			// Railroad: the shared transit table indexed by how many of the group the owner holds.
			"ownedCountScale" => RentCalculator.OwnedCountScale(
				rules.TransitRent, CountOwnedOfType(squares, type, landlord.Id)),

			// Utility: dice × a factor that grows to "all" when the owner holds the whole group.
			"diceMultiplier" => RentCalculator.DiceMultiplier(
				context.LastDiceTotal > 0 ? context.LastDiceTotal : 7,
				CountOwnedOfType(squares, type, landlord.Id),
				squares.Count(s => (s.Type?.ToLower() ?? "") == type),
				rules.UtilityMultiplier),

			_ => 0,
		};

		// "Advance to nearest utility" card: 10× the explicit dice throw, regardless of ownership.
		if (modifier?.UtilityTenTimesDice == true)
		{
			return 10 * (modifier.UtilityDiceTotal ?? 0);
		}
		// "Advance to nearest railroad" card: double the rent owed.
		return baseRent * (modifier?.Multiplier ?? 1);
	}

	/// <summary>How many squares of a given type the player owns (the group size for transit/utility).</summary>
	private static int CountOwnedOfType(List<Square> squares, string type, string ownerId)
		=> squares.Count(s => (s.Type?.ToLower() ?? "") == type && s.OwnerId == ownerId);

	/// <summary>
	/// The announcement variable for a square's name: its per-locale names (which the client
	/// resolves to each player's language) when the board provides them, else the canonical name.
	/// So a bilingual board reads announcements in each player's language, like the board itself.
	/// </summary>
	private static object SquareNameVar(Square square)
		=> square.Names is { Count: > 0 } ? square.Names : square.Name;

	/// <summary>
	/// Pure rent calculation for a colour property. A bigBuilding charges the top tier; 1–4 smallBuildings
	/// map directly onto rent tiers 1–4; with no buildings the base rent is doubled when the
	/// owner holds the whole colour group (classic). Boards without a canonical rent table
	/// fall back to 10% of the price. Extracted as a pure function so the rent rules can be
	/// unit-tested directly, without standing up a full game context.
	/// </summary>
	internal static int PropertyRentFor(IReadOnlyList<int>? rentTable, int? price, int smallBuildings, int bigBuildings, bool hasFullGroup, int fullGroupMultiplier = 2)
	{
		// Fallback for boards without a canonical rent table: 10% of price.
		if (rentTable == null || rentTable.Count < 6)
		{
			return (int)Math.Floor((price ?? 100) * 0.1);
		}

		// A bigBuilding charges the top tier.
		if (bigBuildings >= 1)
		{
			return rentTable[5];
		}

		// 1–4 smallBuildings map directly onto rent tiers 1–4.
		if (smallBuildings >= 1)
		{
			return rentTable[Math.Min(smallBuildings, 4)];
		}

		// No buildings: base rent, multiplied (×2 by default) if the landlord holds the group.
		var baseRent = rentTable[0];
		return hasFullGroup ? baseRent * fullGroupMultiplier : baseRent;
	}

	// ============================================================
	// SECTION: RENT PAYMENT
	// ============================================================

	private async Task ProcessRentPaymentAsync(Player tenant, Square square, GameContext context)
	{
		// Diagnostic: every property/railroad/utility landing reaches here, so this single
		// line reveals exactly why rent may not be charged (no owner, self-owned, mortgaged).
		context.Logger?.LogDebug(
			"Rent check: {Tenant} ({TenantId}) landed on {Square} type={Type} owner={Owner} mortgaged={Mortgaged} diceTotal={DiceTotal}",
			tenant.Name, tenant.Id, square.Name, square.Type,
			string.IsNullOrEmpty(square.OwnerId) ? "(none)" : square.OwnerId, square.Mortgaged, context.LastDiceTotal);

		if (string.IsNullOrEmpty(square.OwnerId) || square.OwnerId == tenant.Id)
		{
			return;
		}

		var landlord = context.Helper.GetPlayer(square.OwnerId);
		if (landlord == null)
		{
			return;
		}

		// A mortgaged property collects no rent — but say so, otherwise the tenant just
		// hears "landed on X" and silence, with no idea why nothing was charged.
		if (square.Mortgaged)
		{
			await context.Announce("game.rent_not_due_mortgaged", new Dictionary<string, object>
			{
				{ "player", tenant.Name },
				{ "landlord", landlord.Name },
				{ "square", SquareNameVar(square) },
				{ "actorId", tenant.Id }
			});
			return;
		}

		// SmallBuilding rule: a held landlord may be barred from collecting rent.
		if (!context.Settings.CollectRentWhileHeld && landlord.IsHeld)
		{
			return;
		}

		// A little flavour when the tenant lands on a developed property: announce the
		// smallBuildings/bigBuilding before the rent line so the burst reads as one playful sentence.
		await AnnounceBuildingsFlexAsync(tenant, square, context);

		// "Advance to nearest utility" card on an owned utility: the rule is to throw the
		// dice and pay 10× the result. Roll it here — only now that rent is actually due —
		// and announce the throw so the extra, automated roll is visible to everyone.
		if (context.PendingRentModifier?.UtilityTenTimesDice == true
			&& context.RentRules.RentStrategies.GetValueOrDefault(square.Type ?? "") == "diceMultiplier")
		{
			var die1 = _random.Next(1, 7);
			var die2 = _random.Next(1, 7);
			context.PendingRentModifier = context.PendingRentModifier with { UtilityDiceTotal = die1 + die2 };
			await context.Announce("game.card_utility_rent_roll", new Dictionary<string, object>
			{
				{ "player", tenant.Name },
				{ "die1", die1 },
				{ "die2", die2 },
				{ "total", die1 + die2 },
				{ "actorId", tenant.Id }
			});
		}

		var rent = CalculateRent(square, landlord, context);

		var (success, debtId) = context.Helper.TryPay(
			tenant.Id,
			landlord.Id,
			rent,
			DebtReason.Rent,
			square.Name
		);

		if (success)
		{
			await context.Announce("game.rent_paid", new Dictionary<string, object>
			{
				{ "player", tenant.Name },
				{ "amount", rent },
				{ "landlord", landlord.Name },
				{ "actorId", tenant.Id }
			});
		}
		else
		{
			await context.Announce("game.debt_created", new Dictionary<string, object>
			{
				{ "player", tenant.Name },
				{ "amount", rent },
				{ "creditor", landlord.Name },
				{ "actorId", tenant.Id }
			});
		}
	}

	/// <summary>
	/// Picks the playful "you landed on a developed property" announcement key (and the
	/// smallBuilding count it needs) for a square, or null when there is nothing built on it.
	/// A bigBuilding always wins over loose smallBuildings. Kept pure so it can be unit-tested directly.
	/// </summary>
	public static (string Key, int Count)? BuildingsFlexAnnouncement(Square square)
	{
		if (square.BigBuildings > 0)
		{
			return ("game.landed_on_big_building", square.BigBuildings);
		}

		if (square.SmallBuildings == 1)
		{
			return ("game.landed_on_building", 1);
		}

		if (square.SmallBuildings > 1)
		{
			return ("game.landed_on_buildings", square.SmallBuildings);
		}

		return null;
	}

	private async Task AnnounceBuildingsFlexAsync(Player tenant, Square square, GameContext context)
	{
		var flex = BuildingsFlexAnnouncement(square);
		if (flex == null)
		{
			return;
		}

		await context.Announce(flex.Value.Key, new Dictionary<string, object>
		{
			{ "player", tenant.Name },
			{ "property", SquareNameVar(square) },
			{ "count", flex.Value.Count },
			{ "actorId", tenant.Id }
		});
	}
}
