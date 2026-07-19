using CorroServer.Models.Corro;

namespace CorroServer.Services.Corro;

/// <summary>
/// The data the rent strategies need about a landed-on square, gathered by the caller from game
/// state. Pure value object so the strategies stay testable without the whole game.
/// </summary>
public sealed record RentContext
{
	/// <summary>SmallBuildings on this square (0..4).</summary>
	public int SmallBuildings { get; init; }
	/// <summary>BigBuildings on this square (0 or 1).</summary>
	public int BigBuildings { get; init; }
	/// <summary>The owner holds every (unmortgaged) square of this square's colour group.</summary>
	public bool OwnsFullGroup { get; init; }
	/// <summary>How many squares of this square's group the owner holds (for transit/utility scaling).</summary>
	public int OwnedCount { get; init; }
	/// <summary>Total squares in this square's group (for the "owns all" utility bonus).</summary>
	public int TotalInGroup { get; init; }
	/// <summary>The dice total that brought the player here (for the dice-multiplier strategy).</summary>
	public int Dice { get; init; }
}

/// <summary>
/// Pure, parametric rent strategies driven by the board's rules config (no hardcoded Corro
/// numbers). The rulebook picks a strategy per square type via <see cref="RulesConfig.RentStrategies"/>:
///   - buildingTable:   property rent table indexed by buildings; the unimproved classic doubles base.
///   - ownedCountScale: transit/station rent from a table indexed by how many you own.
///   - diceMultiplier:  utility rent = dice x a multiplier that grows when you own the whole group.
/// </summary>
public static class RentCalculator
{
	/// <summary>Dispatches to the strategy configured for <paramref name="square"/>'s type.</summary>
	public static int Compute(RulesConfig rules, SquareDef square, RentContext ctx)
		=> rules.RentStrategies.GetValueOrDefault(square.Type, string.Empty) switch
		{
			"buildingTable" => BuildingTable(square.Rent ?? Array.Empty<int>(), ctx.SmallBuildings, ctx.BigBuildings, ctx.OwnsFullGroup),
			"ownedCountScale" => OwnedCountScale(rules.TransitRent, ctx.OwnedCount),
			"diceMultiplier" => DiceMultiplier(ctx.Dice, ctx.OwnedCount, ctx.TotalInGroup, rules.UtilityMultiplier),
			_ => 0,
		};

	/// <summary>rent[0] base (x2 with a full unimproved group), rent[1..4] smallBuildings, rent[last] bigBuilding.</summary>
	public static int BuildingTable(int[] rent, int smallBuildings, int bigBuildings, bool ownsFullGroup)
	{
		if (rent.Length == 0)
		{
			return 0;
		}

		var idx = bigBuildings > 0 ? rent.Length - 1 : Math.Clamp(smallBuildings, 0, rent.Length - 1);
		var amount = rent[idx];
		if (idx == 0 && ownsFullGroup)
		{
			amount *= 2; // unimproved classic pays double base rent
		}

		return amount;
	}

	/// <summary>Rent for owning <paramref name="ownedCount"/> of the group: table[ownedCount - 1].</summary>
	public static int OwnedCountScale(int[] table, int ownedCount)
	{
		if (table.Length == 0 || ownedCount <= 0)
		{
			return 0;
		}

		return table[Math.Clamp(ownedCount - 1, 0, table.Length - 1)];
	}

	/// <summary>dice x (owns the whole group ? all : single).</summary>
	public static int DiceMultiplier(int dice, int ownedCount, int totalInGroup, UtilityMultiplier mult)
	{
		var factor = totalInGroup > 0 && ownedCount >= totalInGroup ? mult.All : mult.Single;
		return dice * factor;
	}
}
