using CorroServer.Models;
using CorroServer.Services;

namespace CorroServer.Tests;

/// <summary>
/// Tests for <see cref="GameStateHelper"/> money transfers. Money must always be
/// conserved across the closed system of players + bank.
/// </summary>
public class GameStateHelperTests
{
	[Fact]
	public void TryPay_PlayerToPlayer_ConservesMoney()
	{
		var a = TestFixtures.NewPlayer("a", money: 500);
		var b = TestFixtures.NewPlayer("b", money: 200);
		var state = TestFixtures.NewState(new[] { a, b }, bankMoney: 1000);
		var helper = new GameStateHelper(state);
		var before = TestFixtures.TotalMoney(state);

		var (success, debtId) = helper.TryPay("a", "b", 150, DebtReason.Card, "test");

		Assert.True(success);
		Assert.Null(debtId);
		Assert.Equal(350, helper.GetPlayerMoney("a"));
		Assert.Equal(350, helper.GetPlayerMoney("b"));
		Assert.Equal(before, TestFixtures.TotalMoney(state));
	}

	[Fact]
	public void TryPay_PlayerToBank_ConservesMoney()
	{
		var a = TestFixtures.NewPlayer("a", money: 500);
		var state = TestFixtures.NewState(new[] { a }, bankMoney: 1000);
		var helper = new GameStateHelper(state);
		var before = TestFixtures.TotalMoney(state);

		var (success, _) = helper.TryPay("a", null, 200, DebtReason.Tax, "tax");

		Assert.True(success);
		Assert.Equal(300, helper.GetPlayerMoney("a"));
		Assert.Equal(1200, helper.GetBankMoney());
		Assert.Equal(before, TestFixtures.TotalMoney(state));
	}

	[Fact]
	public void TryPay_InsufficientFunds_CreatesDebtAndDoesNotMoveMoney()
	{
		var a = TestFixtures.NewPlayer("a", money: 50);
		var b = TestFixtures.NewPlayer("b", money: 200);
		var state = TestFixtures.NewState(new[] { a, b }, bankMoney: 1000);
		var helper = new GameStateHelper(state);
		var before = TestFixtures.TotalMoney(state);

		var (success, debtId) = helper.TryPay("a", "b", 150, DebtReason.Rent, "rent");

		Assert.False(success);
		Assert.NotNull(debtId);
		// No money moved until the debt is resolved.
		Assert.Equal(50, helper.GetPlayerMoney("a"));
		Assert.Equal(200, helper.GetPlayerMoney("b"));
		Assert.Equal(before, TestFixtures.TotalMoney(state));
	}

	[Fact]
	public void TryPay_UnknownPayer_FailsWithoutDebt()
	{
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a") });
		var helper = new GameStateHelper(state);

		var (success, debtId) = helper.TryPay("ghost", null, 10, DebtReason.Tax, "tax");

		Assert.False(success);
		Assert.Null(debtId);
		Assert.False(helper.HasPendingDebts("ghost"));
	}

	// ============================================================
	// State helpers (money clamps, holding, ownership, turns, board)
	// ============================================================

	private static (GameStateHelper helper, GameState state) Build(params Player[] players)
	{
		var state = TestFixtures.NewState(players.Length == 0 ? new[] { TestFixtures.NewPlayer("a") } : players);
		return (new GameStateHelper(state), state);
	}

	[Fact]
	public void SetPlayerMoney_ClampsNegativeToZero()
	{
		var (helper, _) = Build(TestFixtures.NewPlayer("a", money: 100));
		helper.SetPlayerMoney("a", -50);
		Assert.Equal(0, helper.GetPlayerMoney("a"));
	}

	[Fact]
	public void AddPlayerMoney_NeverDropsBelowZero()
	{
		var (helper, _) = Build(TestFixtures.NewPlayer("a", money: 30));
		helper.AddPlayerMoney("a", -100);
		Assert.Equal(0, helper.GetPlayerMoney("a"));
	}

	[Fact]
	public void GetPlayerMoney_UnknownPlayer_IsZero()
	{
		var (helper, _) = Build();
		Assert.Equal(0, helper.GetPlayerMoney("ghost"));
	}

	[Fact]
	public void SetBankMoney_ClampsNegativeToZero()
	{
		var (helper, _) = Build();
		helper.SetBankMoney(-1);
		Assert.Equal(0, helper.GetBankMoney());
	}

	[Fact]
	public void FreeParkingPot_AccumulatesAndIsCollectedOnce()
	{
		var (helper, _) = Build();

		helper.AddToFreeParkingPot(40);
		helper.AddToFreeParkingPot(60);
		Assert.Equal(100, helper.GetFreeParkingPot());

		Assert.Equal(100, helper.CollectFreeParkingPot());
		Assert.Equal(0, helper.GetFreeParkingPot());
	}

	[Fact]
	public void ReleasePasses_AddAndRemove_NeverNegative()
	{
		var (helper, _) = Build(TestFixtures.NewPlayer("a"));

		helper.AddPlayerReleasePass("a");
		Assert.Equal(1, helper.GetPlayerReleasePasses("a"));

		helper.RemovePlayerReleasePass("a");
		helper.RemovePlayerReleasePass("a"); // already at zero, must not go negative
		Assert.Equal(0, helper.GetPlayerReleasePasses("a"));
	}

	[Fact]
	public void SendToHolding_SetsPositionFlagsAndTurns()
	{
		var (helper, _) = Build(TestFixtures.NewPlayer("a"));

		helper.SendToHolding("a", holdingSquareIndex: 10);

		Assert.True(helper.IsPlayerHeld("a"));
		Assert.Equal(3, helper.GetPlayerHoldingTurnsRemaining("a"));
		Assert.Equal(10, helper.GetPlayer("a")!.Position);
	}

	[Fact]
	public void ReleaseFromHolding_ClearsFlags()
	{
		var (helper, _) = Build(TestFixtures.NewPlayer("a"));
		helper.SendToHolding("a", 10);

		helper.ReleaseFromHolding("a");

		Assert.False(helper.IsPlayerHeld("a"));
		Assert.Equal(0, helper.GetPlayerHoldingTurnsRemaining("a"));
	}

	[Fact]
	public void DecrementHoldingTurns_StopsAtZero()
	{
		var (helper, _) = Build(TestFixtures.NewPlayer("a"));
		helper.SendToHolding("a", 10, maxTurns: 1);

		helper.DecrementHoldingTurns("a");
		helper.DecrementHoldingTurns("a"); // already zero

		Assert.Equal(0, helper.GetPlayerHoldingTurnsRemaining("a"));
	}

	[Fact]
	public void AddPlayerProperty_IsIdempotentAndUpdatesOwnership()
	{
		var (helper, state) = Build(TestFixtures.NewPlayer("a"));

		helper.AddPlayerProperty("a", 3);
		helper.AddPlayerProperty("a", 3); // duplicate must not be added twice

		Assert.Equal(new[] { 3 }, helper.GetPlayer("a")!.Properties);
		Assert.Single(state.Ownership, o => o.Index == 3 && o.OwnerId == "a");
	}

	[Fact]
	public void RemovePlayerProperty_RemovesFromPlayerAndOwnership()
	{
		var (helper, state) = Build(TestFixtures.NewPlayer("a"));
		helper.AddPlayerProperty("a", 3);

		helper.RemovePlayerProperty("a", 3);

		Assert.Empty(helper.GetPlayer("a")!.Properties);
		Assert.DoesNotContain(state.Ownership, o => o.Index == 3);
	}

	[Fact]
	public void GetSquare_OutOfRange_ReturnsNull()
	{
		var (helper, _) = Build();
		helper.LoadBoard(new List<BoardData> { new() { Name = "Go" } });

		Assert.NotNull(helper.GetSquare(0));
		Assert.Null(helper.GetSquare(-1));
		Assert.Null(helper.GetSquare(5));
	}

	[Fact]
	public void NextTurn_WrapsAroundAndResetsTurnFlags()
	{
		var (helper, state) = Build(TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b"));
		state.HasRolledThisTurn = true;
		state.MustRollAgain = true;

		helper.NextTurn(); // a -> b
		Assert.Equal("b", helper.GetCurrentTurn());
		Assert.False(state.HasRolledThisTurn);
		Assert.False(state.MustRollAgain);

		helper.NextTurn(); // b -> a (wrap)
		Assert.Equal("a", helper.GetCurrentTurn());
	}

	[Fact]
	public void NextTurn_SkipsBankruptPlayers()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var c = TestFixtures.NewPlayer("c");
		b.IsBankrupt = true;
		b.Status = PlayerStatus.Eliminated; // out of the game — the rotation reads Status
		var (helper, state) = Build(a, b, c);

		helper.NextTurn(); // a -> (skip b) -> c
		Assert.Equal("c", helper.GetCurrentTurn());

		helper.NextTurn(); // c -> a (wrap, b still skipped)
		Assert.Equal("a", helper.GetCurrentTurn());
	}

	[Fact]
	public void NextTurn_SkipsFinishedPlayers()
	{
		var a = TestFixtures.NewPlayer("a");
		var b = TestFixtures.NewPlayer("b");
		var c = TestFixtures.NewPlayer("c");
		// A racer who reached the goal leaves the rotation without being eliminated: the
		// agnostic skip reads Status, so Finished is skipped exactly like Eliminated.
		b.Status = PlayerStatus.Finished;
		b.FinishPlace = 1;
		var (helper, state) = Build(a, b, c);

		helper.NextTurn(); // a -> (skip b) -> c
		Assert.Equal("c", helper.GetCurrentTurn());
	}

	[Fact]
	public void Player_DeserializedWithoutStatus_ReconcilesFromLegacySignals()
	{
		// A game persisted before Status existed carries no such field: a player who had
		// already left must still be reconstructed as out, or the restored rotation would
		// hand them a turn. IJsonOnDeserialized backfills from IsBankrupt / FinishPlace.
		var bankrupt = System.Text.Json.JsonSerializer.Deserialize<Player>(
			"""{"Id":"a","Name":"A","Token":"disc","IsBankrupt":true,"FinishPlace":3}""");
		var finished = System.Text.Json.JsonSerializer.Deserialize<Player>(
			"""{"Id":"b","Name":"B","Token":"disc","FinishPlace":2}""");
		var playing = System.Text.Json.JsonSerializer.Deserialize<Player>(
			"""{"Id":"c","Name":"C","Token":"disc"}""");

		Assert.Equal(PlayerStatus.Eliminated, bankrupt!.Status);
		Assert.Equal(PlayerStatus.Finished, finished!.Status);
		Assert.Equal(PlayerStatus.Active, playing!.Status);
	}

	[Fact]
	public void GetCurrentPlayer_NoCurrentTurn_IsNull()
	{
		var (helper, state) = Build(TestFixtures.NewPlayer("a"));
		state.CurrentTurn = null;

		Assert.Null(helper.GetCurrentPlayer());
	}

	[Fact]
	public void GetNextTurnInfo_ReturnsCurrentPlayerWhenItIsNotTheActor()
	{
		var (helper, state) = Build(TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b"));
		state.CurrentTurn = "b";

		var (id, name) = helper.GetNextTurnInfo("a");

		Assert.Equal("b", id);
		Assert.Equal("b", name);
	}

	[Fact]
	public void GetNextTurnInfo_ReturnsNullsWhenActorIsTheCurrentPlayer()
	{
		var (helper, state) = Build(TestFixtures.NewPlayer("a"));
		state.CurrentTurn = "a";

		var (id, name) = helper.GetNextTurnInfo("a");

		Assert.Null(id);
		Assert.Null(name);
	}

	[Fact]
	public void CreateDebt_RegistersAndIsQueryable()
	{
		var (helper, _) = Build(TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b"));

		var id = helper.CreateDebt("a", "b", 120, DebtReason.Rent, "rent");

		Assert.True(helper.HasPendingDebts("a"));
		Assert.Equal(120, helper.GetTotalDebt("a"));
		Assert.Equal(id, helper.GetDebt(id)!.Id);
		Assert.Single(helper.GetDebtsFor("a"));
		Assert.Equal("b", helper.GetDebt(id)!.CreditorId);
	}

	[Fact]
	public void CreateDebt_WithNullCreditor_DefaultsToBank()
	{
		var (helper, _) = Build(TestFixtures.NewPlayer("a"));

		var id = helper.CreateDebt("a", null, 50, DebtReason.Tax, "tax");

		Assert.Equal("Bank", helper.GetDebt(id)!.CreditorId);
		Assert.Equal("Bank", helper.GetDebt(id)!.CreditorName);
	}

	[Fact]
	public void RemoveDebt_ClearsIt()
	{
		var (helper, _) = Build(TestFixtures.NewPlayer("a"));
		var id = helper.CreateDebt("a", null, 50, DebtReason.Tax, "tax");

		helper.RemoveDebt(id);

		Assert.False(helper.HasPendingDebts("a"));
		Assert.Null(helper.GetDebt(id));
	}

	[Fact]
	public void LoadBoard_BuildsSquaresWithCoordinatesAndMetadata()
	{
		var (helper, _) = Build();

		helper.LoadBoard(new List<BoardData>
		{
			new() { Name = "Go" },
			new() { Name = "Old Kent Road", Price = 60, Color = "brown", Key = "okr" }
		});

		var squares = helper.GetSquares();
		Assert.Equal(2, squares.Count);
		Assert.Equal("Old Kent Road", squares[1].Name);
		Assert.Equal(60, squares[1].Price);
		Assert.Equal("brown", squares[1].Color);
		Assert.Equal(1, squares[1].Id);
	}

}
