using CorroServer.Models;

namespace CorroServer.Tests.Integration;

/// <summary>
/// End-to-end-ish scenarios driven through the deterministic <see cref="GameHarness"/>:
/// real rulebook, real landing pipeline, scripted dice and stacked decks. These double
/// as living documentation for how to build integration scenarios (debt, card effects…)
/// without any SignalR or Cosmos.
/// </summary>
public class IntegrationScenarioTests
{
	private static List<Square> BoardWith(params (int index, Square square)[] overrides)
	{
		var board = TestFixtures.StandardBoard();
		foreach (var (index, square) in overrides)
		{
			board[index] = square;
		}

		return board;
	}

	[Fact]
	public async Task ScriptedDice_MoveTheTokenToTheExpectedSquare()
	{
		var harness = new GameHarness(
			new[] { TestFixtures.NewPlayer("a", position: 0) },
			TestFixtures.StandardBoard());

		var outcome = await harness.RollAsync("a", die1: 2, die2: 5);

		Assert.Equal(7, outcome.Total);
		Assert.Equal(7, harness.Player("a").Position);
		Assert.False(outcome.IsDoubles);
	}

	[Fact]
	public async Task Doubles_OweAnotherRoll_WhilePlainRollsDoNot()
	{
		var harness = new GameHarness(
			new[] { TestFixtures.NewPlayer("a") },
			TestFixtures.StandardBoard());

		await harness.RollAsync("a", die1: 3, die2: 3); // doubles
		Assert.True(harness.State.MustRollAgain);

		await harness.RollAsync("a", die1: 2, die2: 5); // the obligatory extra roll, not doubles
		Assert.False(harness.State.MustRollAgain);
	}

	[Fact]
	public async Task StackedChanceDeck_DrawsTheTopCard_WhenLandingOnAChanceSquare()
	{
		var harness = new GameHarness(
			new[] { TestFixtures.NewPlayer("a", money: 1500, position: 0) },
			BoardWith(
				(0, new Square { Id = 0, Name = "GO", Type = "corner" }),
				(7, new Square { Id = 7, Name = "Chance", Type = "chance" })));

		// Stack the deck so the next Chance card is guaranteed to be "advance to GO".
		harness.StackChanceDeck("chance_advance_go", "chance_advance_11");

		await harness.RollAsync("a", die1: 3, die2: 4); // 0 -> 7 (Chance) -> card sends to GO

		Assert.Equal(0, harness.Player("a").Position);
		Assert.Equal(1700, harness.Context.Helper.GetPlayerMoney("a")); // +200 GO salary from the card
																		// The drawn card recycled to the bottom; the next stacked card is now on top.
		Assert.Equal("chance_advance_11", harness.State.PackageDecks["chance"].Cards[0]);
	}

	[Fact]
	public async Task UnaffordableRent_CreatesAPendingDebt_ForTheIntegratedDebtSystem()
	{
		var tenant = TestFixtures.NewPlayer("a", money: 100, position: 0);
		var landlord = TestFixtures.NewPlayer("b", money: 1500);
		var ownedSquare = new Square
		{
			Id = 4,
			Name = "Main Square",
			Type = "property",
			OwnerId = "b",
			Price = 350,
			Rent = new List<int> { 200, 400, 600, 800, 1000, 1200 },
		};
		var harness = new GameHarness(
			new[] { tenant, landlord },
			BoardWith((4, ownedSquare)),
			bankMoney: 10000);

		await harness.RollAsync("a", die1: 1, die2: 3); // 0 -> 4 (b's property), rent 200 > 100

		Assert.True(harness.Context.Helper.HasPendingDebts("a"));
		var debt = harness.Context.Helper.GetDebtsFor("a").Single();
		Assert.Equal(200, debt.Amount);
		Assert.Equal("b", debt.CreditorId);
		Assert.Equal(DebtReason.Rent, debt.Reason);
		// The tenant could not pay, so no money moved yet — the debt blocks the game.
		Assert.Equal(100, harness.Player("a").Money);
		Assert.Equal(1500, harness.Player("b").Money);
	}
}
