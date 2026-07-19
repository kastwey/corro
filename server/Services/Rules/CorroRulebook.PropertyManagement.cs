using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

/// <summary>
/// CorroRulebook - PROPERTY MANAGEMENT
/// 
/// Property management actions:
/// - Mortgage: Get 50% of property value, can't collect rent
/// - Unmortgage: Pay 55% of property value (50% + 10% interest)
/// - Build smallBuilding: Pay smallBuilding cost, must build evenly across color group
/// - Sell smallBuilding: Get 50% of smallBuilding cost back
/// </summary>
public partial class CorroRulebook
{
	/// <summary>
	/// The bank's mortgage value for a property: a configurable percentage of its price
	/// (default 50%). Integer division matches the old hardcoded <c>(int)(price * 0.5)</c>.
	/// </summary>
	private static int MortgageValueOf(int price, GameSettings settings) => price * settings.MortgageValuePercent / 100;

	// ============================================================
	// SECTION: MORTGAGE
	// ============================================================

	public async Task<PropertyManagementOutcome> MortgagePropertyAsync(
		Player player,
		int squareIndex,
		GameContext context)
	{
		context.Logger?.LogDebug("Rulebook: {PlayerName} mortgaging property {SquareIndex}", player.Name, squareIndex);

		var square = context.Helper.GetSquare(squareIndex);
		if (square == null)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Property not found",
				ErrorCode = "PROPERTY_NOT_FOUND"
			};
		}

		if (square.OwnerId != player.Id)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "You don't own this property",
				ErrorCode = "NOT_OWNER"
			};
		}

		if (square.Mortgaged)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Property is already mortgaged",
				ErrorCode = "ALREADY_MORTGAGED"
			};
		}

		// Official rule: a property can be mortgaged only when NO building stands on ANY property
		// of its colour group — every building in the group must be sold back to the bank first,
		// not just the ones on this lot.
		if (GroupHasBuildings(context.GameState, squareIndex))
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Sell all buildings in the colour group before mortgaging",
				ErrorCode = "HAS_BUILDINGS"
			};
		}

		// Calculate mortgage value (50% of price)
		var mortgageValue = MortgageValueOf(square.Price!.Value, context.Settings);

		// Execute mortgage
		square.Mortgaged = true;
		context.Helper.AddPlayerMoney(player.Id, mortgageValue);
		context.Helper.SetBankMoney(context.Helper.GetBankMoney() - mortgageValue);

		await context.Presenter.NotifySquareChangedAsync(square);
		await context.Announce("game.property_mortgaged", new Dictionary<string, object>
		{
			["actorId"] = player.Id,
			["player"] = player.Name,
			["property"] = SquareNameVar(square),
			["amount"] = mortgageValue
		});

		context.Logger?.LogDebug("{PlayerName} mortgaged {SquareName} for {Amount}€", player.Name, square.Name, mortgageValue);

		return new PropertyManagementOutcome
		{
			Success = true,
			SquareIndex = squareIndex,
			SquareName = square.Name,
			AmountChanged = mortgageValue,
			PlayerMoney = context.Helper.GetPlayerMoney(player.Id),
			RemainingDebt = GetTotalDebt(player.Id, context)
		};
	}

	public async Task<PropertyManagementOutcome> UnmortgagePropertyAsync(
		Player player,
		int squareIndex,
		GameContext context)
	{
		context.Logger?.LogDebug("Rulebook: {PlayerName} unmortgaging property {SquareIndex}", player.Name, squareIndex);

		var square = context.Helper.GetSquare(squareIndex);
		if (square == null)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Property not found",
				ErrorCode = "PROPERTY_NOT_FOUND"
			};
		}

		if (square.OwnerId != player.Id)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "You don't own this property",
				ErrorCode = "NOT_OWNER"
			};
		}

		if (!square.Mortgaged)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Property is not mortgaged",
				ErrorCode = "NOT_MORTGAGED"
			};
		}

		// Calculate unmortgage cost (mortgage value + configurable interest)
		var mortgageValue = MortgageValueOf(square.Price!.Value, context.Settings);
		var unmortgageCost = (int)(mortgageValue * (1 + context.Settings.MortgageInterestRate / 100.0));

		if (context.Helper.GetPlayerMoney(player.Id) < unmortgageCost)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = $"Insufficient funds. Need {unmortgageCost}€",
				ErrorCode = "INSUFFICIENT_FUNDS"
			};
		}

		// Execute unmortgage
		square.Mortgaged = false;
		context.Helper.AddPlayerMoney(player.Id, -unmortgageCost);
		context.Helper.SetBankMoney(context.Helper.GetBankMoney() + unmortgageCost);

		await context.Presenter.NotifySquareChangedAsync(square);
		await context.Announce("game.property_unmortgaged", new Dictionary<string, object>
		{
			["actorId"] = player.Id,
			["player"] = player.Name,
			["property"] = SquareNameVar(square),
			["amount"] = unmortgageCost
		});

		context.Logger?.LogDebug("{PlayerName} unmortgaged {SquareName} for {Amount}€", player.Name, square.Name, unmortgageCost);

		return new PropertyManagementOutcome
		{
			Success = true,
			SquareIndex = squareIndex,
			SquareName = square.Name,
			AmountChanged = -unmortgageCost,
			PlayerMoney = context.Helper.GetPlayerMoney(player.Id),
			RemainingDebt = GetTotalDebt(player.Id, context)
		};
	}

	// ============================================================
	// SECTION: BUILD/SELL BUILDINGS
	// ============================================================

	public async Task<PropertyManagementOutcome> BuildAsync(
		Player player,
		int squareIndex,
		GameContext context)
	{
		context.Logger?.LogDebug("Rulebook: {PlayerName} building smallBuilding at {SquareIndex}", player.Name, squareIndex);

		var square = context.Helper.GetSquare(squareIndex);
		if (square == null || square.Type?.ToLower() != "property")
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Cannot build on this square",
				ErrorCode = "INVALID_SQUARE"
			};
		}

		if (square.OwnerId != player.Id)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "You don't own this property",
				ErrorCode = "NOT_OWNER"
			};
		}

		if (square.Mortgaged)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Cannot build on mortgaged property",
				ErrorCode = "MORTGAGED"
			};
		}

		// Building needs the full colour group, with none of it mortgaged. Check the two
		// conditions separately so the rejection is truthful: owning the whole group but with one
		// lot mortgaged is NOT a missing-classic case — it just needs unmortgaging first.
		var colorGroup = GetColorGroup(square.Color, context);
		if (!colorGroup.All(s => s.OwnerId == player.Id))
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Must own all properties of this color",
				ErrorCode = "NO_FULL_GROUP"
			};
		}
		if (colorGroup.Any(s => s.Mortgaged))
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Unmortgage every property in the colour group before building",
				ErrorCode = "GROUP_MORTGAGED"
			};
		}

		// SmallBuilding rule: no buildings until the player completes their first lap.
		if (context.Settings.NoBuildingFirstLap && player.LapsCompleted < 1)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Cannot build until you complete your first lap",
				ErrorCode = "NO_FIRST_LAP"
			};
		}

		// Check even building rule (official; can be disabled as a smallBuilding rule)
		if (context.Settings.EvenBuildRule && !CanBuildHere(player.Id, squareIndex, square.Color, context))
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Must build evenly across color group",
				ErrorCode = "UNEVEN_BUILDING"
			};
		}

		// The board sets how many small constructions combine into the big one (4 by default).
		var levels = context.Settings.BuildingLevels;

		// Check max buildings (N small constructions, then the big one)
		if (square.SmallBuildings >= levels && square.BigBuildings >= 1)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Maximum buildings reached",
				ErrorCode = "MAX_BUILDINGS"
			};
		}

		// Official rule: the bank stocks a limited number of small + big constructions (32 / 12 by
		// default; configurable). Building past the Nth small construction converts them into the big one.
		var buildingBig = square.SmallBuildings >= levels;
		if (context.Settings.BuildingShortage)
		{
			var allSquares = context.Helper.GetSquares();
			if (buildingBig)
			{
				var bigBuildingsInUse = allSquares.Sum(s => s.BigBuildings);
				if (bigBuildingsInUse >= context.Settings.MaxBigBuildings)
				{
					return new PropertyManagementOutcome
					{
						Success = false,
						Error = "The bank has no bigBuildings left",
						ErrorCode = "BIG_BUILDING_SHORTAGE"
					};
				}
			}
			else
			{
				var smallBuildingsInUse = allSquares.Sum(s => s.SmallBuildings);
				if (smallBuildingsInUse >= context.Settings.MaxSmallBuildings)
				{
					return new PropertyManagementOutcome
					{
						Success = false,
						Error = "The bank has no smallBuildings left",
						ErrorCode = "SMALL_BUILDING_SHORTAGE"
					};
				}
			}
		}

		var cost = GetBuildingCost(square);
		if (context.Helper.GetPlayerMoney(player.Id) < cost)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = $"Insufficient funds. Need {cost}€",
				ErrorCode = "INSUFFICIENT_FUNDS"
			};
		}

		// Build
		context.Helper.AddPlayerMoney(player.Id, -cost);
		context.Helper.SetBankMoney(context.Helper.GetBankMoney() + cost);

		if (square.SmallBuildings < levels)
		{
			square.SmallBuildings++;
		}
		else
		{
			square.SmallBuildings = 0;
			square.BigBuildings = 1;
		}

		await context.Presenter.NotifySquareChangedAsync(square);
		await context.Announce("game.building_built", new Dictionary<string, object>
		{
			["actorId"] = player.Id,
			["player"] = player.Name,
			["property"] = SquareNameVar(square),
			["smallBuildings"] = square.SmallBuildings,
			["bigBuildings"] = square.BigBuildings
		});

		context.Logger?.LogDebug("{PlayerName} built on {SquareName}. SmallBuildings: {SmallBuildings}, BigBuildings: {BigBuildings}", player.Name, square.Name, square.SmallBuildings, square.BigBuildings);

		return new PropertyManagementOutcome
		{
			Success = true,
			SquareIndex = squareIndex,
			SquareName = square.Name,
			AmountChanged = -cost,
			PlayerMoney = context.Helper.GetPlayerMoney(player.Id),
			RemainingDebt = 0
		};
	}

	public async Task<PropertyManagementOutcome> SellBuildingAsync(
		Player player,
		int squareIndex,
		GameContext context)
	{
		context.Logger?.LogDebug("Rulebook: {PlayerName} selling smallBuilding at {SquareIndex}", player.Name, squareIndex);

		var square = context.Helper.GetSquare(squareIndex);
		if (square == null)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Property not found",
				ErrorCode = "PROPERTY_NOT_FOUND"
			};
		}

		if (square.OwnerId != player.Id)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "You don't own this property",
				ErrorCode = "NOT_OWNER"
			};
		}

		if (square.SmallBuildings == 0 && square.BigBuildings == 0)
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "No buildings to sell",
				ErrorCode = "NO_BUILDINGS"
			};
		}

		// Check even selling rule
		if (!CanSellHere(player.Id, squareIndex, square.Color, context))
		{
			return new PropertyManagementOutcome
			{
				Success = false,
				Error = "Must sell evenly across color group",
				ErrorCode = "UNEVEN_SELLING"
			};
		}

		// Sell back at the configured percentage of cost (50% by default).
		var saleValue = GetBuildingCost(square) * context.Settings.BuildingSellbackPercent / 100;

		if (square.BigBuildings > 0)
		{
			// Selling the big construction reverts it to a full set of small ones.
			square.BigBuildings = 0;
			square.SmallBuildings = context.Settings.BuildingLevels;
		}
		else
		{
			square.SmallBuildings--;
		}

		context.Helper.AddPlayerMoney(player.Id, saleValue);
		context.Helper.SetBankMoney(context.Helper.GetBankMoney() - saleValue);

		await context.Presenter.NotifySquareChangedAsync(square);

		context.Logger?.LogDebug("{PlayerName} sold building on {SquareName} for {Amount}€", player.Name, square.Name, saleValue);

		return new PropertyManagementOutcome
		{
			Success = true,
			SquareIndex = squareIndex,
			SquareName = square.Name,
			AmountChanged = saleValue,
			PlayerMoney = context.Helper.GetPlayerMoney(player.Id),
			RemainingDebt = GetTotalDebt(player.Id, context)
		};
	}

	// ============================================================
	// SECTION: HELPERS
	// ============================================================

	/// <summary>The "property" squares making up a colour group (empty when colour is unset).</summary>
	private static List<Square> GetColorGroup(string? color, GameContext context)
	{
		if (string.IsNullOrEmpty(color))
		{
			return new List<Square>();
		}

		return context.Helper.GetSquares()
			.Where(s => s.Color == color && s.Type?.ToLower() == "property")
			.ToList();
	}

	private bool HasFullGroup(string playerId, string? color, GameContext context)
	{
		if (string.IsNullOrEmpty(color))
		{
			return false;
		}

		return GetColorGroup(color, context).All(s => s.OwnerId == playerId && !s.Mortgaged);
	}

	/// <summary>
	/// Whether the player owns EVERY square of the colour group, regardless of mortgage. This is
	/// the classic test for the unimproved double rent: officially a mortgaged lot does NOT stop
	/// the unmortgaged lots from charging double. (Building needs the group unmortgaged — that is
	/// <see cref="HasFullGroup"/>.)
	/// </summary>
	private bool OwnsWholeGroup(string playerId, string? color, GameContext context)
	{
		if (string.IsNullOrEmpty(color))
		{
			return false;
		}

		var group = GetColorGroup(color, context);
		return group.Count > 0 && group.All(s => s.OwnerId == playerId);
	}

	private bool CanBuildHere(string playerId, int squareIndex, string? color, GameContext context)
	{
		if (string.IsNullOrEmpty(color))
		{
			return false;
		}

		var squares = context.Helper.GetSquares();
		var targetSquare = squares.FirstOrDefault(s => s.Id == squareIndex);
		if (targetSquare == null)
		{
			return false;
		}

		var big = context.Settings.BuildingLevels + 1; // the big construction's value in small units
		var colorGroup = squares.Where(s => s.Color == color && s.Type?.ToLower() == "property").ToList();
		var minSmallBuildings = colorGroup.Min(s => s.SmallBuildings + s.BigBuildings * big);
		var targetSmallBuildings = targetSquare.SmallBuildings + targetSquare.BigBuildings * big;

		// Can only build if this property has the minimum (even building)
		return targetSmallBuildings <= minSmallBuildings;
	}

	private bool CanSellHere(string playerId, int squareIndex, string? color, GameContext context)
	{
		if (string.IsNullOrEmpty(color))
		{
			return false;
		}

		var squares = context.Helper.GetSquares();
		var targetSquare = squares.FirstOrDefault(s => s.Id == squareIndex);
		if (targetSquare == null)
		{
			return false;
		}

		var big = context.Settings.BuildingLevels + 1; // the big construction's value in small units
		var colorGroup = squares.Where(s => s.Color == color && s.Type?.ToLower() == "property").ToList();
		var maxSmallBuildings = colorGroup.Max(s => s.SmallBuildings + s.BigBuildings * big);
		var targetSmallBuildings = targetSquare.SmallBuildings + targetSquare.BigBuildings * big;

		// Can only sell if this property has the maximum (even selling)
		return targetSmallBuildings >= maxSmallBuildings;
	}

	private int GetBuildingCost(Square square)
	{
		// Prefer the per-square cost from the board; fall back to a colour table.
		if (square.BuildingCost is > 0)
		{
			return square.BuildingCost.Value;
		}

		return square.Color?.ToLower() switch
		{
			"brown" or "lightblue" => 50,
			"pink" or "orange" => 100,
			"red" or "yellow" => 150,
			"green" or "darkblue" => 200,
			_ => 100
		};
	}

	/// <summary>
	/// Resale value of all buildings on a square: a configurable percentage (default 50%) of the
	/// build cost per small construction, with the big one counting as a full set. Mirrors SellBuilding.
	/// </summary>
	public int GetBuildingSaleValue(Square square, GameSettings? settings = null)
	{
		var percent = settings?.BuildingSellbackPercent ?? 50;
		var big = (settings?.BuildingLevels ?? 4) + 1; // big construction's value in small units
		return (square.SmallBuildings + square.BigBuildings * big) * (GetBuildingCost(square) * percent / 100);
	}
}
