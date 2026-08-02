using System.Reflection;
using System.Text.RegularExpressions;
using CorroServer.Services.Commands;

namespace CorroServer.Tests;

/// <summary>
/// Architectural guard on what a turn carries. <see cref="GameContext"/> is handed to every
/// family's handlers, so anything declared on it directly is something ALL ten families are told
/// they might need. The property family's economy — rent rules, the landing in flight, the
/// callbacks that break its dependency cycles — is not that, and it now lives in
/// <see cref="PropertyTurnContext"/> behind <c>context.Property</c>.
///
/// The pressure this resists is real: the easiest place to put "one more field the rulebook needs"
/// is straight onto GameContext, and each one makes the answer to "what does a shedding turn
/// actually need?" less honest. These tests make that a red build instead of a slow drift.
/// </summary>
public class FamilyContextBoundaryTests
{
	/// <summary>Property-family vocabulary. A member named with any of these on the SHARED context
	/// is the mistake this guards; the same word inside PropertyTurnContext is exactly right.</summary>
	private static readonly string[] PropertyVocabulary =
	{
		"Rent", "Landing", "Express", "Mortgage", "Building", "Auction", "Debt", "Bankrupt",
	};

	private static IEnumerable<MemberInfo> SharedContextMembers() =>
		typeof(GameContext).GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
			.Where(m => m is PropertyInfo or FieldInfo);

	[Fact]
	public void The_shared_context_declares_nothing_in_the_property_family_vocabulary()
	{
		var leaked = SharedContextMembers()
			.Where(m => PropertyVocabulary.Any(word => m.Name.Contains(word, StringComparison.Ordinal)))
			.Select(m => m.Name)
			.ToList();

		Assert.True(leaked.Count == 0,
			$"GameContext declares property-family members: {string.Join(", ", leaked)}.\n"
			+ "Every family's handlers receive this object. Put them on PropertyTurnContext "
			+ "(context.Property) so a card family's turn is not told about rent.");
	}

	[Fact]
	public void The_property_slice_is_reachable_only_through_its_own_object()
	{
		// The five members that moved. If one reappears on GameContext, the split has been undone.
		var moved = new[]
		{
			nameof(PropertyTurnContext.RentRules),
			nameof(PropertyTurnContext.ProcessLanding),
			nameof(PropertyTurnContext.ResolveDeferredExpressMove),
			nameof(PropertyTurnContext.PendingRentModifier),
			nameof(PropertyTurnContext.LastDiceTotal),
		};
		var shared = SharedContextMembers().Select(m => m.Name).ToHashSet(StringComparer.Ordinal);

		Assert.All(moved, member => Assert.DoesNotContain(member, shared));
		Assert.Equal("Property", typeof(GameContext).GetProperty("Property")!.Name);
	}

	/// <summary>
	/// The other half of the boundary: a family that is NOT property must not reach into the
	/// property slice. Nothing stops it at compile time — the slice is on the context every family
	/// gets — so this reads the sources the way PackageContentBoundaryTests does.
	/// </summary>
	[Fact]
	public void No_card_or_board_family_reaches_into_the_property_slice()
	{
		var repositoryRoot = Directory.GetParent(Directory.GetParent(CorroTestPaths.PackagesRoot())!.FullName)!.FullName;
		var commands = Path.Combine(repositoryRoot, "server", "Services", "Commands");

		// Every handler file except the property family's own turn flow.
		var propertyOwned = new[]
		{
			"RollDiceHandler.cs", "BuyPropertyHandler.cs", "EndTurnHandler.cs", "BusChoiceHandler.cs",
			"PropertyManagementHandlers.cs", "DebtHandlers.cs", "TradeHandlers.cs", "AuctionHandlers.cs",
			"HoldingHandlers.cs", "QueryHandlers.cs", "RentModifier.cs",
		};

		var trespassers = Directory.GetFiles(commands, "*.cs")
			.Where(path => !propertyOwned.Contains(Path.GetFileName(path)))
			.Where(path => Regex.IsMatch(File.ReadAllText(path), @"\b(context|ctx)\.Property\b"))
			.Select(path => Path.GetRelativePath(repositoryRoot, path))
			.ToList();

		Assert.True(trespassers.Count == 0,
			$"These read the property family's turn slice: {string.Join(", ", trespassers)}.\n"
			+ "A card or board family needs none of it; if one genuinely does, the concept belongs "
			+ "on GameContext under a family-neutral name.");
	}
}
