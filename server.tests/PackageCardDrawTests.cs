using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Tests.Integration;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The full package-card draw: landing on a deck square in a package game draws from the package's
/// own deck and applies the card's effect through the engine — no card classes, no CardCatalog.
/// The draw pile is pre-seeded so the top card is deterministic.
/// </summary>
public class PackageCardDrawTests
{
	private static (List<Square> board, GameHarness harness) Setup(Player a, CardEffect topCardEffect)
	{
		var board = TestFixtures.StandardBoard();
		board[5] = new Square { Id = 5, Name = "Deck", Type = "deck", Deck = "d", Behavior = "drawCard" };
		var harness = new GameHarness(new[] { a }, board);
		harness.State.PackageCards = new List<CardDef>
		{
			new() { Id = "c1", Deck = "d", Effect = topCardEffect },
		};
		harness.State.PackageDecks["d"] = new CardDeck
		{
			Cards = new List<string> { "c1" },
			HeldCards = new List<string>(),
			IsInitialized = true,
		};
		return (board, harness);
	}

	[Fact]
	public async Task Landing_on_a_deck_square_draws_and_applies_a_money_card()
	{
		var a = TestFixtures.NewPlayer("a", money: 1000, position: 3);
		var (_, harness) = Setup(a, new CardEffect { Type = "money", Amount = 100 });

		await harness.RollAsync("a", 1, 1); // 3 -> 5 (deck), draws c1

		Assert.Equal(5, harness.Player("a").Position);
		Assert.Equal(1100, harness.Player("a").Money);
		// The drawn card recycled to the bottom of its pile.
		Assert.Contains("c1", harness.State.PackageDecks["d"].Cards);
	}

	[Fact]
	public async Task Landing_on_a_deck_square_draws_and_applies_a_go_to_release_pass()
	{
		var a = TestFixtures.NewPlayer("a", money: 1000, position: 3);
		var (_, harness) = Setup(a, new CardEffect { Type = "sendToHolding" });

		await harness.RollAsync("a", 1, 1); // 3 -> 5 (deck), draws the go-to-release pass

		Assert.True(harness.Player("a").IsHeld);
	}

	[Fact]
	public async Task Drawing_a_package_card_reveals_its_localized_text_to_the_client()
	{
		var a = TestFixtures.NewPlayer("a", money: 1000, position: 3);
		var board = TestFixtures.StandardBoard();
		board[5] = new Square { Id = 5, Name = "Deck", Type = "deck", Deck = "d", Behavior = "drawCard" };
		var harness = new GameHarness(new[] { a }, board);
		harness.State.PackageCards = new List<CardDef>
		{
			new() { Id = "c1", Deck = "d", TextKey = "cards.c1",
					Effect = new CardEffect { Type = "money", Amount = 50 } },
		};
		harness.State.PackageDecks["d"] = new CardDeck { Cards = new List<string> { "c1" }, HeldCards = new List<string>(), IsInitialized = true };

		await harness.RollAsync("a", 1, 1); // land on the deck square, draw c1

		var reveal = TestFixtures.Presenter(harness.Context).CardsDrawn.Single();
		Assert.Equal("c1", reveal.CardId);
		Assert.Equal("d", reveal.DeckType);
		Assert.Equal("cards.c1", reveal.DescriptionKey); // the i18n key travels; the client resolves it
	}

	[Fact]
	public async Task Drawing_from_an_empty_package_deck_returns_DECK_EMPTY()
	{
		var p = TestFixtures.NewPlayer("p");
		var state = TestFixtures.NewState(new[] { p }, squares: TestFixtures.StandardBoard());
		// A package game (PackageCards set) but no cards for the "d" deck.
		state.PackageCards = new List<CardDef> { new() { Id = "x", Deck = "other", Effect = new CardEffect { Type = "money", Amount = 1 } } };
		var context = TestFixtures.NewContext(state);

		var result = await new CorroServer.Services.Rules.CorroRulebook().DrawCardAsync(p, "d", context);

		Assert.False(result.Success);
		Assert.Equal("DECK_EMPTY", result.Error);
	}

	[Fact]
	public async Task A_card_that_moves_onto_an_unowned_property_offers_to_buy_it()
	{
		// A movement card re-enters the landing pipeline, so landing on an unowned property by card
		// offers the purchase exactly like landing there by a dice roll (the path the deleted classic
		// CardPurchaseOfferTests covered).
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 3);
		var board = TestFixtures.StandardBoard();
		board[5] = new Square { Id = 5, Name = "Deck", Type = "deck", Deck = "d", Behavior = "drawCard" };
		board[11] = new Square { Id = 11, Name = "Prop", Type = "property", Price = 200 };
		var harness = new GameHarness(new[] { a }, board);
		harness.State.PackageCards = new List<CardDef>
		{
			new() { Id = "c1", Deck = "d", Effect = new CardEffect { Type = "moveTo", Target = "11" } },
		};
		harness.State.PackageDecks["d"] = new CardDeck { Cards = new List<string> { "c1" }, HeldCards = new List<string>(), IsInitialized = true };

		await harness.RollAsync("a", 1, 1); // 3 -> 5 (deck) -> card moves to 11 (unowned property)

		Assert.Equal(11, a.Position);
		var pending = harness.State.PendingPurchase;
		Assert.NotNull(pending);
		Assert.Equal("a", pending!.PlayerId);
		Assert.Equal(11, pending.SquareIndex);
		Assert.Equal(200, pending.Price);
	}

	[Fact]
	public async Task A_drawn_grant_release_pass_is_held_out_of_the_pile()
	{
		var a = TestFixtures.NewPlayer("a", money: 1000, position: 3);
		var (_, harness) = Setup(a, new CardEffect { Type = "grantReleasePass" });

		await harness.RollAsync("a", 1, 1); // draws the release-pass card

		Assert.Equal(1, harness.Player("a").ReleasePasses);
		Assert.Contains("c1", harness.State.PackageDecks["d"].HeldCards); // held, not recycled
		Assert.DoesNotContain("c1", harness.State.PackageDecks["d"].Cards);
	}
}
