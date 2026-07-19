using CorroServer.Models;
using CorroServer.Services.Corro;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The applier turns a resolved <see cref="CardOutcome"/> into real mutations via the shared
/// <see cref="ICardActions"/> primitives. These pin every outcome kind, so a package deck's cards
/// take effect through the same, tested code the legacy cards use.
/// </summary>
public class CardOutcomeApplierTests
{
	private static readonly ICardActions Actions = new CardActions();

	private static CorroServer.Services.Commands.GameContext Context(params Player[] players)
		=> TestFixtures.NewContext(TestFixtures.NewState(players, squares: TestFixtures.StandardBoard()));

	[Fact]
	public async Task MoveTo_moves_the_player_and_awards_the_pass_bonus_when_it_wraps()
	{
		var a = TestFixtures.NewPlayer("a", money: 100, position: 38);
		var ctx = Context(a);

		await CardOutcomeApplier.ApplyAsync(
			new CardOutcome { Kind = CardOutcomeKind.MoveTo, Position = 2, CollectPass = true }, a, Actions, ctx);

		Assert.Equal(2, a.Position);
		Assert.Equal(300, a.Money); // 100 + the 200 GO bonus for wrapping past start
	}

	[Fact]
	public async Task Card_moves_close_the_previous_turn_segment_first()
	{
		// A card that MOVES splits the turn: the "landed on the card square" segment is
		// checkpointed BEFORE the card's own move, so the client
		// animates walk → card → walk instead of one lump narrated over a single hop
		// (live-play bug: "the card sent me to GO and it all played as one sequence").
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 7);
		var ctx = Context(a);

		await CardOutcomeApplier.ApplyAsync(
			new CardOutcome { Kind = CardOutcomeKind.MoveTo, Position = 0, CollectPass = true }, a, Actions, ctx);

		Assert.Equal(1, TestFixtures.Presenter(ctx).CheckpointCount);
		Assert.Equal(0, a.Position);
	}

	[Fact]
	public async Task Non_move_cards_do_not_checkpoint()
	{
		// Money/release-pass outcomes have no token movement, so they must NOT cut a segment:
		// an empty checkpoint would push a redundant state mid-command.
		var a = TestFixtures.NewPlayer("a", money: 100);
		var ctx = Context(a);

		await CardOutcomeApplier.ApplyAsync(
			new CardOutcome { Kind = CardOutcomeKind.MoneyDelta, Amount = 50 }, a, Actions, ctx);

		Assert.Equal(0, TestFixtures.Presenter(ctx).CheckpointCount);
	}

	[Fact]
	public async Task MoveTo_with_a_rent_multiplier_charges_double_on_arrival()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 0);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var board = TestFixtures.StandardBoard();
		board.First(s => s.Id == 5).OwnerId = "b"; // b owns the railroad at 5
		var state = TestFixtures.NewState(new[] { a, b }, bankMoney: 10000, squares: board);
		var ctx = TestFixtures.NewContext(state, processLanding: new CorroRulebook().ProcessLandingEffectsAsync);
		var before = TestFixtures.TotalMoney(state);

		await CardOutcomeApplier.ApplyAsync(
			new CardOutcome { Kind = CardOutcomeKind.MoveTo, Position = 5, CollectPass = false, RentMultiplier = 2 },
			a, Actions, ctx);

		// Single-railroad rent is 25; the multiplier doubles it to 50 — same as the legacy card.
		Assert.Equal(5, a.Position);
		Assert.Equal(1450, a.Money);
		Assert.Equal(1550, b.Money);
		Assert.Equal(before, TestFixtures.TotalMoney(state));

		// The modifier must not leak into a later landing.
		Assert.Null(ctx.PendingRentModifier);
	}

	[Fact]
	public async Task MoveTo_with_the_utility_dice_rule_charges_ten_times_a_throw()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 0);
		var b = TestFixtures.NewPlayer("b", money: 1500);
		var board = TestFixtures.StandardBoard();
		board.First(s => s.Id == 12).OwnerId = "b"; // b owns the utility at 12
		var state = TestFixtures.NewState(new[] { a, b }, bankMoney: 10000, squares: board);
		var ctx = TestFixtures.NewContext(state, processLanding: new CorroRulebook().ProcessLandingEffectsAsync);
		var before = TestFixtures.TotalMoney(state);

		await CardOutcomeApplier.ApplyAsync(
			new CardOutcome { Kind = CardOutcomeKind.MoveTo, Position = 12, CollectPass = false, UtilityTimesDice = true },
			a, Actions, ctx);

		var paid = 1500 - a.Money;
		Assert.Equal(12, a.Position);
		Assert.InRange(paid, 20, 120);   // 10× a 2..12 dice throw, not the ownership-based amount
		Assert.Equal(0, paid % 10);
		Assert.Equal(1500 + paid, b.Money);
		Assert.Equal(before, TestFixtures.TotalMoney(state));
		Assert.Null(ctx.PendingRentModifier);
	}

	[Fact]
	public async Task MoneyDelta_collects_from_or_pays_the_bank()
	{
		var a = TestFixtures.NewPlayer("a", money: 100);
		var ctx = Context(a);

		await CardOutcomeApplier.ApplyAsync(new CardOutcome { Kind = CardOutcomeKind.MoneyDelta, Amount = 150 }, a, Actions, ctx);
		Assert.Equal(250, a.Money);

		await CardOutcomeApplier.ApplyAsync(new CardOutcome { Kind = CardOutcomeKind.MoneyDelta, Amount = -50 }, a, Actions, ctx);
		Assert.Equal(200, a.Money);
	}

	[Fact]
	public async Task CollectFromEach_takes_the_amount_from_every_other_player()
	{
		var a = TestFixtures.NewPlayer("a", money: 100);
		var b = TestFixtures.NewPlayer("b", money: 100);
		var c = TestFixtures.NewPlayer("c", money: 100);
		var ctx = Context(a, b, c);

		await CardOutcomeApplier.ApplyAsync(new CardOutcome { Kind = CardOutcomeKind.CollectFromEach, Amount = 10 }, a, Actions, ctx);

		Assert.Equal(120, a.Money); // +10 from b, +10 from c
		Assert.Equal(90, b.Money);
		Assert.Equal(90, c.Money);
	}

	[Fact]
	public async Task PayEach_pays_the_amount_to_every_other_player()
	{
		var a = TestFixtures.NewPlayer("a", money: 100);
		var b = TestFixtures.NewPlayer("b", money: 100);
		var c = TestFixtures.NewPlayer("c", money: 100);
		var ctx = Context(a, b, c);

		await CardOutcomeApplier.ApplyAsync(new CardOutcome { Kind = CardOutcomeKind.PayEach, Amount = 10 }, a, Actions, ctx);

		Assert.Equal(80, a.Money); // -10 to b, -10 to c
		Assert.Equal(110, b.Money);
		Assert.Equal(110, c.Money);
	}

	[Fact]
	public async Task PayPerBuilding_charges_per_house_and_hotel()
	{
		var a = TestFixtures.NewPlayer("a", money: 1000);
		var board = TestFixtures.StandardBoard();
		board[1] = new Square { Id = 1, Name = "P", Type = "property", OwnerId = "a", SmallBuildings = 2 };
		board[3] = new Square { Id = 3, Name = "Q", Type = "property", OwnerId = "a", BigBuildings = 1 };
		var ctx = TestFixtures.NewContext(TestFixtures.NewState(new[] { a }, squares: board));

		await CardOutcomeApplier.ApplyAsync(
			new CardOutcome { Kind = CardOutcomeKind.PayPerBuilding, PerSmallBuilding = 25, PerBigBuilding = 100 }, a, Actions, ctx);

		Assert.Equal(1000 - (2 * 25 + 1 * 100), a.Money); // 2 smallBuildings + 1 bigBuilding
	}

	[Fact]
	public async Task SendToHolding_holds_the_player()
	{
		var a = TestFixtures.NewPlayer("a");
		var ctx = Context(a);

		await CardOutcomeApplier.ApplyAsync(new CardOutcome { Kind = CardOutcomeKind.SendToHolding }, a, Actions, ctx);

		Assert.True(a.IsHeld);
	}

	[Fact]
	public async Task GrantReleasePass_gives_a_grant_release_pass()
	{
		var a = TestFixtures.NewPlayer("a");
		var ctx = Context(a);

		await CardOutcomeApplier.ApplyAsync(new CardOutcome { Kind = CardOutcomeKind.GrantReleasePass }, a, Actions, ctx);

		Assert.Equal(1, a.ReleasePasses);
	}

	[Fact]
	public async Task None_does_nothing()
	{
		var a = TestFixtures.NewPlayer("a", money: 100, position: 5);
		var ctx = Context(a);

		await CardOutcomeApplier.ApplyAsync(new CardOutcome { Kind = CardOutcomeKind.None }, a, Actions, ctx);

		Assert.Equal(100, a.Money);
		Assert.Equal(5, a.Position);
		Assert.False(a.IsHeld);
	}
}
