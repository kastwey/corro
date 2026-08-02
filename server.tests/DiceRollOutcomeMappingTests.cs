using System.Reflection;
using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// <see cref="DiceRollOutcome"/> (what the rulebook decided) and <see cref="DiceRolledResponse"/>
/// (what goes on the wire) carry the same three dozen facts. They stay separate types on purpose —
/// the rulebook is pure and must not build transport objects, and the response already inherits
/// <see cref="ServerResponse"/>, so C# leaves no shared base to hang the fields on — which means
/// <c>ToResponse</c> has to copy them by hand.
///
/// A hand-written copy of 33 fields fails SILENTLY: add a field to the outcome, forget the
/// mapping, and the roll simply arrives with that fact missing (a bonus-die destination that never
/// reaches the client, a holding countdown stuck at zero). These tests turn both halves of that
/// mistake — a field with no mapping, and a mapping that drops a value — into a red build.
/// </summary>
public class DiceRollOutcomeMappingTests
{
	/// <summary>The response's own transport concerns, which have no outcome counterpart.</summary>
	private static readonly HashSet<string> TransportOnly = new()
	{
		nameof(DiceRolledResponse.Type),
		nameof(DiceRolledResponse.Timestamp),
		nameof(DiceRolledResponse.ReachesEveryPlayer),
		// Identity: the HANDLER knows who rolled, the rulebook's outcome does not carry it.
		nameof(DiceRolledResponse.PlayerId),
		nameof(DiceRolledResponse.PlayerName),
	};

	private static IEnumerable<PropertyInfo> PublicProperties<T>()
		=> typeof(T).GetProperties(BindingFlags.Public | BindingFlags.Instance);

	[Fact]
	public void Every_outcome_field_has_a_home_on_the_response()
	{
		var response = PublicProperties<DiceRolledResponse>().Select(p => p.Name).ToHashSet();

		var orphaned = PublicProperties<DiceRollOutcome>()
			.Where(p => !response.Contains(p.Name))
			.Select(p => p.Name)
			.ToList();

		Assert.True(orphaned.Count == 0,
			$"DiceRollOutcome carries fields the response cannot express: {string.Join(", ", orphaned)}. "
			+ "Add them to DiceRolledResponse and to ToResponse, or the client never learns them.");
	}

	[Fact]
	public void Every_response_field_comes_from_the_outcome_or_is_declared_transport()
	{
		var outcome = PublicProperties<DiceRollOutcome>().Select(p => p.Name).ToHashSet();

		var unsourced = PublicProperties<DiceRolledResponse>()
			.Where(p => !outcome.Contains(p.Name) && !TransportOnly.Contains(p.Name))
			.Select(p => p.Name)
			.ToList();

		Assert.True(unsourced.Count == 0,
			$"DiceRolledResponse has fields nothing fills: {string.Join(", ", unsourced)}. "
			+ "Either source them from DiceRollOutcome or list them in TransportOnly with a reason.");
	}

	[Fact]
	public void ToResponse_actually_carries_every_value_across()
	{
		// Distinct, non-default values everywhere: a field the mapping forgot keeps its default
		// and is caught, which a same-shaped-but-empty outcome would not detect.
		var outcome = new DiceRollOutcome
		{
			Die1 = 3, Die2 = 4, Total = 7, IsDoubles = true,
			FromPosition = 11, ToPosition = 18,
			NextPlayerId = "next-id", NextPlayerName = "Next",
			SquareName = "Square", SquarePrice = 220, CanBuySquare = true, CanAfford = true,
			BonusDie = BonusDieFace.Bus, BonusDieValue = 2, RequiresBusChoice = true,
			ExpressDestination = 24, ExpressSquareName = "Express",
			BusDestinationDie1Name = "D1", BusDestinationDie2Name = "D2", BusDestinationBothName = "Both",
			BusDestinationDie1ColorKey = "c1", BusDestinationDie2ColorKey = "c2", BusDestinationBothColorKey = "cb",
			BusDestinationDie1Rent = 12, BusDestinationDie2Rent = 13, BusDestinationBothRent = 14,
			ReleasedFromHolding = true, StillHeld = true, HoldingTurnsRemaining = 2,
			PaidReleaseCost = true, ReleaseCostAmount = 50,
		};

		var response = outcome.ToResponse("me", "Me");

		Assert.Equal("me", response.PlayerId);
		Assert.Equal("Me", response.PlayerName);

		var responseProperties = PublicProperties<DiceRolledResponse>().ToDictionary(p => p.Name);
		var dropped = PublicProperties<DiceRollOutcome>()
			.Where(p => responseProperties.ContainsKey(p.Name))
			.Where(p => !Equals(p.GetValue(outcome), responseProperties[p.Name].GetValue(response)))
			.Select(p => p.Name)
			.ToList();

		Assert.True(dropped.Count == 0,
			$"ToResponse did not carry these across: {string.Join(", ", dropped)}.");
	}
}
