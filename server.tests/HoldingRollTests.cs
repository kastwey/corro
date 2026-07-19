using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Unit coverage for the holding branch of <see cref="CorroRulebook.ProcessDiceRollAsync"/>
/// and the voluntary escape actions (<see cref="CorroRulebook.PayReleaseCostAsync"/>,
/// <see cref="CorroRulebook.UseReleasePassAsync"/>).
///
/// Dice are made deterministic by injecting a <see cref="ScriptedRandomSource"/> into the
/// rulebook: every roll consumes exactly two scripted values (die1, die2).
/// </summary>
public class HoldingRollTests
{
	private const int HoldingPosition = 10;

	/// <summary>A held player sitting on the holding square, holding the current turn.</summary>
	private static (CorroRulebook rulebook, Player player, GameContext context) HeldRoller(
		int die1, int die2, int holdingTurnsRemaining = 3, int money = 1500)
	{
		var player = TestFixtures.NewPlayer("a", money: money, position: HoldingPosition);
		player.IsHeld = true;
		player.HoldingTurnsRemaining = holdingTurnsRemaining;
		var state = TestFixtures.NewState(new[] { player }, bankMoney: 10000, squares: TestFixtures.StandardBoard());
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);
		var rulebook = new CorroRulebook(randomSource: new ScriptedRandomSource().Enqueue(die1, die2));
		return (rulebook, player, context);
	}

	// ── Rolling in holding ───────────────────────────────────────────────────────

	[Fact]
	public async Task RollingDoubles_EscapesHolding_MovesAndKeepsTheTurn()
	{
		var (rulebook, player, context) = HeldRoller(die1: 3, die2: 3);
		var before = TestFixtures.TotalMoney(context.GameState);

		var outcome = await rulebook.ProcessDiceRollAsync(player, context);

		Assert.True(outcome.IsDoubles);
		Assert.True(outcome.ReleasedFromHolding);
		Assert.False(player.IsHeld);
		Assert.Equal(HoldingPosition + 6, player.Position);
		// Doubles in holding do NOT grant an extra turn — escaping is free, no money moved.
		Assert.Equal(before, TestFixtures.TotalMoney(context.GameState));
		Assert.True(TestFixtures.Announcer(context)
			.Has(AnnouncementAudience.AllExcept, "a", "game.escaped_holding_doubles"));
	}

	[Fact]
	public async Task RollingNonDoubles_WithTurnsLeft_StaysInHolding_AndDoesNotMove()
	{
		var (rulebook, player, context) = HeldRoller(die1: 2, die2: 3, holdingTurnsRemaining: 3);

		var outcome = await rulebook.ProcessDiceRollAsync(player, context);

		Assert.True(outcome.StillHeld);
		Assert.True(player.IsHeld);
		Assert.Equal(HoldingPosition, player.Position); // did not move
		Assert.Equal(2, outcome.HoldingTurnsRemaining); // 3 - 1
		Assert.True(TestFixtures.Announcer(context)
			.Has(AnnouncementAudience.AllExcept, "a", "game.holding_still_in"));
	}

	[Fact]
	public async Task RollingNonDoubles_OnLastTurn_PaysReleaseCost_ThenMoves()
	{
		var (rulebook, player, context) = HeldRoller(die1: 2, die2: 3, holdingTurnsRemaining: 1, money: 1500);
		var before = TestFixtures.TotalMoney(context.GameState);

		var outcome = await rulebook.ProcessDiceRollAsync(player, context);

		Assert.True(outcome.PaidReleaseCost);
		Assert.Equal(50, outcome.ReleaseCostAmount);
		Assert.True(outcome.ReleasedFromHolding);
		Assert.False(player.IsHeld);
		Assert.Equal(1500 - 50, player.Money);
		Assert.Equal(HoldingPosition + 5, player.Position);
		// ReleaseCost is a closed transfer player -> bank.
		Assert.Equal(before, TestFixtures.TotalMoney(context.GameState));
		Assert.True(TestFixtures.Announcer(context)
			.Has(AnnouncementAudience.AllExcept, "a", "game.paid_holding_release_cost"));
		// Paying release cost is the CAUSE that precedes the move, so it must be a MOVE-phase line:
		// spoken immediately with the dice roll, BEFORE the token hops — otherwise the
		// client's gate would hold it and the player would hear "moved, then paid the release cost".
		Assert.All(
			TestFixtures.Announcer(context).Sent.Where(x => x.Key == "game.paid_holding_release_cost"),
			x => Assert.Equal(AnnouncementPhase.Move, x.Phase));
	}

	[Fact]
	public async Task RollingNonDoubles_OnLastTurn_WhenBroke_CreatesDebt_ButStillReleases()
	{
		var (rulebook, player, context) = HeldRoller(die1: 2, die2: 3, holdingTurnsRemaining: 1, money: 0);

		var outcome = await rulebook.ProcessDiceRollAsync(player, context);

		Assert.True(outcome.ReleasedFromHolding);
		Assert.False(player.IsHeld);
		Assert.Equal(0, player.Money); // could not afford release cost, no deduction
		Assert.True(TestFixtures.Announcer(context)
			.Has(AnnouncementAudience.AllExcept, "a", "game.debt_created"));
		// The unpaid the release cost is still the pre-move cause, so its debt line is MOVE-phase too.
		Assert.All(
			TestFixtures.Announcer(context).Sent.Where(x => x.Key == "game.debt_created"),
			x => Assert.Equal(AnnouncementPhase.Move, x.Phase));
	}

	[Fact]
	public async Task PayingReleaseCost_OnLastTurn_FeedsTheFreeParkingPot_WhenEnabled()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500, position: HoldingPosition);
		player.IsHeld = true;
		player.HoldingTurnsRemaining = 1;
		var state = TestFixtures.NewState(new[] { player }, bankMoney: 10000, squares: TestFixtures.StandardBoard());
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = true });
		var rulebook = new CorroRulebook(randomSource: new ScriptedRandomSource().Enqueue(2, 3));

		await rulebook.ProcessDiceRollAsync(player, context);

		Assert.Equal(50, context.Helper.GetFreeParkingPot());
	}

	// ── PayReleaseCostAsync (voluntary, pre-roll) ────────────────────────────────

	[Fact]
	public async Task PayReleaseCost_WhenNotInHolding_IsRejected()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500);
		var state = TestFixtures.NewState(new[] { player });
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().PayReleaseCostAsync(player, context);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_HELD", outcome.ErrorCode);
	}

	[Fact]
	public async Task PayReleaseCost_WhenNotYourTurn_IsRejected()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500);
		player.IsHeld = true;
		var other = TestFixtures.NewPlayer("b", money: 1500);
		var state = TestFixtures.NewState(new[] { player, other });
		state.CurrentTurn = "b";
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().PayReleaseCostAsync(player, context);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_YOUR_TURN", outcome.ErrorCode);
		Assert.True(player.IsHeld);
	}

	[Fact]
	public async Task PayReleaseCost_WhenBroke_CreatesDebt_ButStillReleases()
	{
		var player = TestFixtures.NewPlayer("a", money: 0);
		player.IsHeld = true;
		var state = TestFixtures.NewState(new[] { player });
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().PayReleaseCostAsync(player, context);

		Assert.True(outcome.Success);
		Assert.True(outcome.Released);
		Assert.False(player.IsHeld);
		Assert.True(TestFixtures.Announcer(context)
			.Has(AnnouncementAudience.AllExcept, "a", "game.debt_created"));
	}

	[Fact]
	public async Task PayReleaseCost_FeedsTheFreeParkingPot_WhenEnabled()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500);
		player.IsHeld = true;
		var state = TestFixtures.NewState(new[] { player });
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = true });

		var outcome = await new CorroRulebook().PayReleaseCostAsync(player, context);

		Assert.True(outcome.Success);
		Assert.Equal(50, context.Helper.GetFreeParkingPot());
	}

	// ── UseReleasePassAsync ──────────────────────────────────────────────────────

	[Fact]
	public async Task UseReleasePass_WhenHeld_ReleasesAndConsumesTheCard()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500);
		player.IsHeld = true;
		player.ReleasePasses = 1;
		var state = TestFixtures.NewState(new[] { player });
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().UseReleasePassAsync(player, context);

		Assert.True(outcome.Success);
		Assert.True(outcome.Released);
		Assert.False(player.IsHeld);
		Assert.Equal(0, player.ReleasePasses);
		Assert.Equal(0, outcome.CardsRemaining);
		// The release is VOICED (live-play bug: the shortcut worked in silence): the actor
		// hears the first-person variant, everyone else the named one.
		Assert.True(TestFixtures.Announcer(context)
			.Has(AnnouncementAudience.Player, "a", "game.used_release_pass_self"));
		Assert.True(TestFixtures.Announcer(context)
			.Has(AnnouncementAudience.AllExcept, "a", "game.used_release_pass"));
	}

	[Fact]
	public async Task UseReleasePass_WhenNotInHolding_IsRejected()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500);
		player.ReleasePasses = 1;
		var state = TestFixtures.NewState(new[] { player });
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().UseReleasePassAsync(player, context);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_HELD", outcome.ErrorCode);
		Assert.Equal(1, player.ReleasePasses);
	}

	[Fact]
	public async Task UseReleasePass_WhenNotYourTurn_IsRejected()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500);
		player.IsHeld = true;
		player.ReleasePasses = 1;
		var other = TestFixtures.NewPlayer("b", money: 1500);
		var state = TestFixtures.NewState(new[] { player, other });
		state.CurrentTurn = "b";
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().UseReleasePassAsync(player, context);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_YOUR_TURN", outcome.ErrorCode);
		Assert.True(player.IsHeld);
	}

	[Fact]
	public async Task UseReleasePass_WithNoCards_IsRejected()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500);
		player.IsHeld = true;
		player.ReleasePasses = 0;
		var state = TestFixtures.NewState(new[] { player });
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().UseReleasePassAsync(player, context);

		Assert.False(outcome.Success);
		Assert.Equal("NO_RELEASE_PASSES", outcome.ErrorCode);
		Assert.True(player.IsHeld);
	}
}
