using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;

namespace CorroServer.Tests;

/// <summary>
/// The structural deck checks every card family shares. They used to be copied verbatim into each
/// family's <c>ValidateDefinition</c>, differing only in the family word, so a fix or a wording
/// improvement had to be applied five times — and a NEW family started by copying them a sixth.
///
/// These messages are what a package author sees from <c>corro-package validate</c>, so the tests
/// pin the wording, not just the throw.
/// </summary>
public class DeckValidationTests
{
	private static readonly string[] KnownTypes = { "number", "skip" };

	private static List<SheddingCardDef> GoodDeck() => new()
	{
		new SheddingCardDef { Id = "red-1", Type = "number", NameKey = "c.r1", Count = 2, Color = "red" },
		new SheddingCardDef { Id = "red-skip", Type = "skip", NameKey = "c.rs", Count = 1, Color = "red" },
	};

	private static InvalidOperationException Rejects(List<SheddingCardDef>? deck)
		=> Assert.Throws<InvalidOperationException>(
			() => DeckValidation.RequireWellFormedDeck(deck, "shedding", KnownTypes));

	[Fact]
	public void A_well_formed_deck_passes_and_comes_back_non_null()
	{
		var deck = GoodDeck();

		// Returning the deck is what lets a family write `var deck = RequireWellFormedDeck(...)`
		// and carry straight on with its own rules.
		Assert.Same(deck, DeckValidation.RequireWellFormedDeck(deck, "shedding", KnownTypes));
	}

	[Fact]
	public void A_missing_deck_names_the_file_the_author_forgot()
		=> Assert.Contains("shedding package has no deck (cards.json).", Rejects(null).Message);

	[Fact]
	public void An_empty_deck_is_rejected()
		=> Assert.Contains("shedding deck has no cards.", Rejects(new List<SheddingCardDef>()).Message);

	[Fact]
	public void Ids_must_be_present_and_unique()
	{
		var blank = GoodDeck();
		blank[0] = blank[0] with { Id = "  " };
		Assert.Contains("every shedding card needs a unique id.", Rejects(blank).Message);

		var duplicated = GoodDeck();
		duplicated[1] = duplicated[1] with { Id = duplicated[0].Id };
		Assert.Contains("every shedding card needs a unique id.", Rejects(duplicated).Message);
	}

	[Fact]
	public void An_unknown_type_names_the_card_and_the_type()
	{
		var deck = GoodDeck();
		deck[0] = deck[0] with { Type = "teleport" };

		Assert.Contains("shedding card 'red-1' has an unknown type 'teleport'.", Rejects(deck).Message);
	}

	[Fact]
	public void A_nameless_card_is_rejected_because_it_could_never_be_spoken()
	{
		var deck = GoodDeck();
		deck[0] = deck[0] with { NameKey = "" };

		Assert.Contains("shedding card 'red-1' has no name (add a nameKey).", Rejects(deck).Message);
	}

	[Fact]
	public void A_card_needs_at_least_one_copy()
	{
		var deck = GoodDeck();
		deck[0] = deck[0] with { Count = 0 };

		Assert.Contains("shedding card 'red-1' needs a positive count.", Rejects(deck).Message);
	}

	[Fact]
	public void The_family_word_travels_into_every_message_so_each_family_reads_as_its_own()
	{
		// The one reason these checks were duplicated. A second family gets identical wording
		// with its own name, for free.
		var deck = new List<ExplodingCardDef>
		{
			new() { Id = "bomb-1", Type = "bomb", NameKey = "", Count = 1 },
		};

		var error = Assert.Throws<InvalidOperationException>(
			() => DeckValidation.RequireWellFormedDeck(deck, "exploding", new[] { "bomb" }));

		Assert.Contains("exploding card 'bomb-1' has no name (add a nameKey).", error.Message);
	}
}
