using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;
using CorroServer.Tests.Integration;

namespace CorroServer.Tests;

/// <summary>Regression coverage for the optional 1/2/3/Express/Express/Bus die.</summary>
public class BonusDieRulebookTests
{
	private static Player EligiblePlayer(string id = "a", int position = 0)
	{
		var player = TestFixtures.NewPlayer(id, position: position);
		player.LapsCompleted = 1;
		return player;
	}

	private static List<Square> Board(params Square[] replacements)
	{
		var board = TestFixtures.StandardBoard();
		foreach (var square in replacements)
		{
			board[square.Id] = square;
		}
		return board;
	}

	private static Square Property(int id, string name, string? owner = null)
		=> new()
		{
			Id = id,
			Name = name,
			Names = new Dictionary<string, string> { ["en"] = name, ["es"] = $"ES {name}" },
			Type = "property",
			Behavior = "ownable",
			Price = 100,
			Color = "brown",
			GroupNameKey = "groups.brown",
			OwnerId = owner,
			Rent = [10, 50, 150, 450, 625, 750],
		};

	[Fact]
	public async Task NumberedFaceAddsToMovementAfterFirstLap()
	{
		var player = EligiblePlayer();
		var harness = new GameHarness([player], Board(), new GameSettings { UseBonusDie = true });

		var outcome = await harness.RollWithBonusDieAsync("a", 2, 3, GameHarness.BonusDie.Two);

		Assert.Equal(BonusDieFace.Two, outcome.BonusDie);
		Assert.Equal(2, outcome.BonusDieValue);
		Assert.Equal(7, outcome.Total);
		Assert.Equal(7, player.Position);
		Assert.Contains(harness.Announcer.Sent, x => x.Key == "game.dice_rolled_bonus_self");
	}

	[Fact]
	public async Task BonusDieDoesNotRollBeforeFirstLapOrWhileHeld()
	{
		var firstLap = TestFixtures.NewPlayer("a");
		var firstHarness = new GameHarness([firstLap], Board(), new GameSettings { UseBonusDie = true });
		var first = await firstHarness.RollAsync("a", 2, 3);
		Assert.Null(first.BonusDie);
		Assert.Equal(5, first.Total);

		var held = EligiblePlayer();
		held.IsHeld = true;
		held.HoldingTurnsRemaining = 3;
		var heldHarness = new GameHarness([held], Board(), new GameSettings { UseBonusDie = true });
		var heldOutcome = await heldHarness.RollAsync("a", 2, 3);
		Assert.Null(heldOutcome.BonusDie);
		Assert.True(heldOutcome.StillHeld);
	}

	[Fact]
	public async Task BusPersistsDestinationsAndRentUntilThePlayerChooses()
	{
		var player = EligiblePlayer();
		var landlord = TestFixtures.NewPlayer("b");
		var destination1 = Property(2, "Two", "b");
		var destination2 = Property(3, "Three", "b") with { Mortgaged = true };
		var destinationBoth = Property(5, "Five", "b");
		var harness = new GameHarness(
			[player, landlord],
			Board(destination1, destination2, destinationBoth),
			new GameSettings { UseBonusDie = true });

		var outcome = await harness.RollWithBonusDieAsync("a", 2, 3, GameHarness.BonusDie.Bus);

		Assert.True(outcome.RequiresBusChoice);
		Assert.Equal(0, player.Position);
		Assert.Equal(20, outcome.BusDestinationDie1Rent); // landlord owns every brown property in this test board
		Assert.NotNull(harness.State.PendingBusChoice);
		Assert.True(harness.Announcer.Has(AnnouncementAudience.Player, "a", "game.bus_choice_required"));
		var prompt = harness.Announcer.Sent.Single(x => x.Key == "game.bus_choice_required");
		var names = Assert.IsType<Dictionary<string, string>>(prompt.Vars["square1"]);
		Assert.Equal("ES Two", names["es"]);

		var moved = await harness.Rulebook.ProcessBusChoiceAsync(player, "both", harness.Context);
		Assert.Null(harness.State.PendingBusChoice);
		Assert.Equal(5, player.Position);
		Assert.Equal(BonusDieFace.Bus, moved.BonusDie);
		Assert.Contains(harness.Announcer.Sent, x => x.Key == "game.bus_moving_self");
	}

	[Fact]
	public async Task BusFaceStillHonorsTheThirdConsecutiveDoublesPenalty()
	{
		var player = EligiblePlayer(position: 7);
		var harness = new GameHarness([player], Board(), new GameSettings { UseBonusDie = true });
		harness.State.ConsecutiveDoubles = 2;

		var outcome = await harness.RollWithBonusDieAsync("a", 4, 4, GameHarness.BonusDie.Bus);

		Assert.True(player.IsHeld);
		Assert.Null(harness.State.PendingBusChoice);
		Assert.Equal(BonusDieFace.Bus, outcome.BonusDie);
		Assert.Contains(harness.Announcer.Sent, x => x.Key == "game.holding_speeding_self");
	}

	[Fact]
	public async Task ExpressResolvesTheNormalLandingThenMovesInASeparateSegment()
	{
		var player = EligiblePlayer();
		var board = Board(
			new Square { Id = 5, Name = "Tax", Type = "tax", Behavior = "tax", Amount = 100 },
			Property(6, "Next property"));
		var harness = new GameHarness([player], board, new GameSettings { UseBonusDie = true });

		var outcome = await harness.RollWithBonusDieAsync("a", 2, 3, GameHarness.BonusDie.Express);

		Assert.Equal(1400, player.Money);
		Assert.Equal(6, player.Position);
		Assert.Equal(6, outcome.ExpressDestination);
		Assert.Equal(1, TestFixtures.Presenter(harness.Context).CheckpointCount);
		var move = harness.Announcer.Sent.Single(x => x.Key == "game.express_move_self");
		Assert.Equal(AnnouncementPhase.Move, move.Phase);
		Assert.IsType<Dictionary<string, string>>(move.Vars["property"]);
	}

	[Fact]
	public async Task ExpressWaitsForPurchaseThenOffersTheNextProperty()
	{
		var player = EligiblePlayer();
		var harness = new GameHarness(
			[player],
			Board(Property(5, "First"), Property(6, "Second")),
			new GameSettings { UseBonusDie = true, AuctionOnDecline = false });

		await harness.RollWithBonusDieAsync("a", 2, 3, GameHarness.BonusDie.Express);
		Assert.Equal(5, harness.State.PendingPurchase?.SquareIndex);
		Assert.NotNull(harness.State.PendingExpressMove);

		await harness.Rulebook.BuyPropertyAsync(player, 5, harness.Context);

		Assert.Equal(6, player.Position);
		Assert.Equal(6, harness.State.PendingPurchase?.SquareIndex);
		Assert.Null(harness.State.PendingExpressMove);
	}

	[Fact]
	public async Task AuctionDoesNotHandOffWhenDeferredExpressCreatesRentDebt()
	{
		var player = EligiblePlayer();
		player.Money = 0;
		var landlord = TestFixtures.NewPlayer("b");
		var harness = new GameHarness(
			[player, landlord],
			Board(Property(5, "Auctioned"), Property(6, "Rival", "b")),
			new GameSettings { UseBonusDie = true, AuctionOnDecline = true });

		await harness.RollWithBonusDieAsync("a", 2, 3, GameHarness.BonusDie.Express);
		var decline = await harness.Rulebook.DeclinePropertyAsync(player, 5, harness.Context);
		Assert.True(decline.AuctionStarted);
		// Make the auctioned lot owned as well, so no unowned property remains and Express
		// targets the next unmortgaged rival lot (square 6), where rent becomes debt.
		harness.State.ActiveAuction!.CurrentBid = 1;
		harness.State.ActiveAuction.HighestBidderId = "b";
		harness.State.ActiveAuction.HighestBidderName = landlord.Name;

		await new AuctionRulebook().EndAuctionAsync(harness.Context);

		Assert.Equal("a", harness.State.CurrentTurn);
		Assert.Contains(harness.State.PendingDebts, debt => debt.DebtorId == "a");
		Assert.Null(harness.State.PendingExpressMove);
	}

	[Fact]
	public void PendingBusChoiceFreezesEveryMutatingCommandExceptItsAnswer()
	{
		var state = TestFixtures.NewState([EligiblePlayer()]);
		state.PendingBusChoice = new PendingBusChoice
		{
			PlayerId = "a", Die1 = 2, Die2 = 3, FromPosition = 0,
		};

		Assert.Equal("BUS_CHOICE_REQUIRED", CommandDispatcher.CheckBusChoiceFreeze(
			new EndTurnCommand { PlayerId = "a" }, state));
		Assert.Null(CommandDispatcher.CheckBusChoiceFreeze(
			new BusChoiceCommand { PlayerId = "a", Choice = "both" }, state));
		Assert.Null(CommandDispatcher.CheckBusChoiceFreeze(
			new GetMoneyCommand { PlayerId = "a" }, state));
	}

	/// <summary>
	/// Live-play report: while one player sat on their bonus-die choice, everyone ELSE was told
	/// "choose your bonus-die movement before taking another action" — for a die they never threw —
	/// and could not build, mortgage or answer a trade until that player decided.
	///
	/// Unlike a trade or an auction, this is not a table event. It freezes its owner only.
	/// </summary>
	[Fact]
	public void PendingBusChoiceDoesNotFreezeTheOtherPlayers()
	{
		var state = TestFixtures.NewState([EligiblePlayer()]);
		state.PendingBusChoice = new PendingBusChoice
		{
			PlayerId = "a", Die1 = 2, Die2 = 3, FromPosition = 0,
		};

		// A rival's off-turn economy keeps working…
		Assert.Null(CommandDispatcher.CheckBusChoiceFreeze(
			new BuildCommand { PlayerId = "b", SquareIndex = 1, Count = 1 }, state));
		Assert.Null(CommandDispatcher.CheckBusChoiceFreeze(
			new MortgagePropertyCommand { PlayerId = "b", SquareIndex = 1 }, state));
		Assert.Null(CommandDispatcher.CheckBusChoiceFreeze(
			new RespondTradeCommand { PlayerId = "b", TradeId = "t1", Accept = true }, state));

		// …while the owner still cannot slip past their own pending choice.
		Assert.Equal("BUS_CHOICE_REQUIRED", CommandDispatcher.CheckBusChoiceFreeze(
			new BuildCommand { PlayerId = "a", SquareIndex = 1, Count = 1 }, state));
	}
}
