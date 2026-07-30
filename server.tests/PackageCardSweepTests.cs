using System.Reflection;
using CorroServer.Models.Corro;

namespace CorroServer.Tests;

/// <summary>
/// Three passes over a package treat every card alike regardless of family: resolving art files,
/// validating accent colours, and collecting translation keys. They used to enumerate the five card
/// decks by hand, in three different files — so adding a sixth card family meant remembering all
/// three, and forgetting one failed SILENTLY (art that never loads, a colour never checked, a
/// missing translation nobody reports).
///
/// <c>GameDefinition.AllFamilyCards</c> and <c>WithResolvedCardArt</c> are now the only places the
/// decks are listed. These tests make a deck missing from either one a red build instead of a
/// silent gap.
/// </summary>
public class PackageCardSweepTests
{
	/// <summary>Every card-deck slot on GameDefinition, found by shape rather than by name so a
	/// new family's deck is picked up here the moment it is declared.</summary>
	private static List<PropertyInfo> DeckSlots() => typeof(GameDefinition)
		.GetProperties(BindingFlags.Public | BindingFlags.Instance)
		.Where(p => p.PropertyType.IsGenericType
			&& p.PropertyType.GetGenericTypeDefinition() == typeof(List<>)
			&& typeof(IPackageCardDef).IsAssignableFrom(p.PropertyType.GetGenericArguments()[0]))
		.ToList();

	/// <summary>One card in each deck, so a slot the sweep skips shows up as a missing id.</summary>
	private static GameDefinition DefinitionWithOneCardPerDeck()
	{
		var definition = new GameDefinition
		{
			JourneyDeck = new() { new JourneyCardDef { Id = "journey-1", Type = "distance", NameKey = "n" } },
			AssemblyDeck = new() { new AssemblyCardDef { Id = "assembly-1", Type = "piece", NameKey = "n" } },
			DraftDeck = new() { new DraftCardDef { Id = "draft-1", Type = "points", NameKey = "n" } },
			SheddingDeck = new() { new SheddingCardDef { Id = "shedding-1", Type = "number", NameKey = "n" } },
			ExplodingDeck = new() { new ExplodingCardDef { Id = "exploding-1", Type = "bomb", NameKey = "n" } },
		};

		// If a family adds a deck slot without seeding it here, the coverage assertions below would
		// pass vacuously — so the fixture itself has to keep up with the model.
		var seeded = DeckSlots().Count(slot => slot.GetValue(definition) is not null);
		Assert.True(seeded == DeckSlots().Count,
			$"This fixture seeds {seeded} of {DeckSlots().Count} card decks. Add the new family's deck "
			+ "to DefinitionWithOneCardPerDeck so the sweeps below are actually exercised.");
		return definition;
	}

	[Fact]
	public void AllFamilyCards_reaches_every_card_deck()
	{
		var definition = DefinitionWithOneCardPerDeck();

		var swept = definition.AllFamilyCards.Select(card => card.Id).ToHashSet();

		var missed = DeckSlots()
			.Select(slot => ((System.Collections.IEnumerable)slot.GetValue(definition)!).Cast<IPackageCardDef>().Single())
			.Where(card => !swept.Contains(card.Id))
			.Select(card => card.Id)
			.ToList();

		Assert.True(missed.Count == 0,
			$"AllFamilyCards skips: {string.Join(", ", missed)}. Add the deck to it, or its cards get "
			+ "no accent-colour check and no translation-key report.");
	}

	[Fact]
	public void WithResolvedCardArt_reaches_every_card_deck()
	{
		var definition = DefinitionWithOneCardPerDeck() with
		{
			Cards = new() { new CardDef { Id = "property-1" } },
		};

		// Art keyed by id, so a deck the rewrite skips keeps its null Svg.
		var resolved = definition.WithResolvedCardArt(id => ($"path-for-{id}", true));

		var unresolved = resolved.AllFamilyCards
			.Cast<object>()
			.Append(resolved.Cards.Single())
			.Select(card => (
				Id: (string)card.GetType().GetProperty("Id")!.GetValue(card)!,
				Svg: (string?)card.GetType().GetProperty("Svg")!.GetValue(card)))
			.Where(card => card.Svg != $"path-for-{card.Id}")
			.Select(card => card.Id)
			.ToList();

		Assert.True(unresolved.Count == 0,
			$"WithResolvedCardArt skips: {string.Join(", ", unresolved)}. Those cards would silently "
			+ "never show their assets/cards/<id> art.");
	}

	[Fact]
	public void A_package_with_no_card_family_sweeps_to_nothing()
	{
		// The spatial families (property, race, track…) carry no family deck at all: the sweep must
		// be empty rather than throwing on the null slots.
		var definition = new GameDefinition();

		Assert.Empty(definition.AllFamilyCards);
		Assert.Empty(definition.WithResolvedCardArt(_ => ("x", true)).AllFamilyCards);
	}
}
