using CorroServer.Models;
using CorroServer.Tests.Integration;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Regression tests for two rules verified against the official Hasbro rules — both were
/// previously implemented incorrectly and are now fixed:
///   1. A complete colour group still charges DOUBLE rent on its unmortgaged lots even when
///      another lot in the group is mortgaged ("mortgaged streets in a classic do not prevent
///      the unmortgaged properties charging double rent").
///   2. A third consecutive double is "caught speeding" and sends the player straight to holding,
///      without moving and with the turn over.
/// </summary>
public class OfficialRulesComplianceTests
{
	// ── Rule 1: double rent survives a mortgaged group-mate ──────────────────────
	[Fact]
	public async Task A_mortgaged_group_mate_does_not_stop_the_unmortgaged_lots_charging_double()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 36);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var board = TestFixtures.StandardBoard();
		board[1] = new Square
		{
			Id = 1,
			Name = "Brown A",
			Type = "property",
			Color = "brown",
			Price = 60,
			Rent = new List<int> { 2, 10, 30, 90, 160, 250 },
			OwnerId = "b",
		};
		board[3] = new Square
		{
			Id = 3,
			Name = "Brown B",
			Type = "property",
			Color = "brown",
			Price = 60,
			Rent = new List<int> { 4, 20, 60, 180, 320, 450 },
			OwnerId = "b",
			Mortgaged = true,
		};
		var harness = new GameHarness(new[] { a, b }, board);

		// a rolls 2+3 = 5 from 36 -> wraps past GO and lands on square 1 (the unmortgaged brown).
		await harness.RollAsync("a", 2, 3);

		Assert.Equal(1, harness.Player("a").Position);
		// Base rent 2, doubled to 4 because b owns the whole brown group — the mortgaged lot
		// does not break the classic bonus on the unmortgaged one.
		Assert.Equal(1504, harness.Player("b").Money);
	}

	// ── Rule 2: three consecutive doubles -> holding ────────────────────────────────
	[Fact]
	public async Task A_third_consecutive_double_sends_the_player_straight_to_holding()
	{
		var a = TestFixtures.NewPlayer("a");
		var board = TestFixtures.StandardBoard();
		foreach (var s in board)
		{
			s.OwnerId = "a"; // a owns everything -> intermediate landings are inert
		}

		var harness = new GameHarness(new[] { a }, board);

		await harness.RollAsync("a", 1, 1); // double #1
		await harness.RollAsync("a", 2, 2); // double #2
		Assert.False(harness.Player("a").IsHeld);

		await harness.RollAsync("a", 3, 3); // double #3 -> caught speeding

		Assert.True(harness.Player("a").IsHeld);
		Assert.Equal(10, harness.Player("a").Position);     // held; did NOT advance the extra 6
		Assert.Equal(0, harness.State.ConsecutiveDoubles);  // run reset
		Assert.False(harness.State.MustRollAgain);           // no re-roll owed — the turn is over
															 // Announced in the MOVE phase: there is no dice hop to pace it to (the player is teleported
															 // straight to holding), so the client must speak/show it at once instead of holding it in the
															 // move gate — otherwise going to holding on the third double is silent. Regression.
		Assert.Contains(harness.Announcer.Sent,
			s => s.Key == "game.holding_speeding" && s.Phase == AnnouncementPhase.Move);
	}

	[Fact]
	public async Task A_board_that_walks_to_holding_paces_the_speeding_line_to_the_hop()
	{
		var a = TestFixtures.NewPlayer("a");
		var board = TestFixtures.StandardBoard();
		foreach (var s in board)
		{
			s.OwnerId = "a";
		}

		var harness = new GameHarness(new[] { a }, board);
		harness.State.WalkToHolding = true; // this board animates the walk to holding instead of teleporting

		await harness.RollAsync("a", 1, 1);
		await harness.RollAsync("a", 2, 2);
		await harness.RollAsync("a", 3, 3); // third double

		Assert.True(harness.Player("a").IsHeld);
		// Paced to the walk: Resolve, so the client holds it until the token finishes hopping to holding.
		Assert.Contains(harness.Announcer.Sent,
			s => s.Key == "game.holding_speeding" && s.Phase == AnnouncementPhase.Resolve);
	}

	[Fact]
	public async Task Rolling_doubles_onto_send_to_holding_forfeits_the_extra_roll()
	{
		var a = TestFixtures.NewPlayer("a", position: 28);
		var board = TestFixtures.StandardBoard();
		board[30] = new Square { Id = 30, Name = "Go To Holding", Type = "corner", Key = "goto_holding" };
		var harness = new GameHarness(new[] { a }, board);

		await harness.RollAsync("a", 1, 1); // doubles: 28 -> 30 (Go To Holding)

		Assert.True(harness.Player("a").IsHeld);
		Assert.Equal(10, harness.Player("a").Position);  // sent to holding
		Assert.False(harness.State.MustRollAgain);         // doubles re-roll is forfeited
	}

	[Fact]
	public async Task Two_doubles_then_a_normal_roll_does_not_holding_and_resets_the_run()
	{
		var a = TestFixtures.NewPlayer("a");
		var board = TestFixtures.StandardBoard();
		foreach (var s in board)
		{
			s.OwnerId = "a";
		}

		var harness = new GameHarness(new[] { a }, board);

		await harness.RollAsync("a", 1, 1); // double #1
		await harness.RollAsync("a", 2, 2); // double #2
		await harness.RollAsync("a", 1, 2); // not a double -> the run resets, no holding

		Assert.False(harness.Player("a").IsHeld);
		Assert.Equal(0, harness.State.ConsecutiveDoubles);
	}
}
