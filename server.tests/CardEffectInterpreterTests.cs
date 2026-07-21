using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The card interpreter turns a generic CardEffect into a declarative CardOutcome (move / money /
/// holding…) without mutating state. Tests cover each effect type and resolve the real Galactic deck,
/// using the shipped board for movement (transits at 5/15/25/35, 40 squares).
/// </summary>
public class CardEffectInterpreterTests
{
	private static List<SquareDef> Board() =>
		  new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("galactic-empire"))
			.GetAwaiter().GetResult().Board;

	private static CardOutcome Resolve(CardEffect e, IReadOnlyList<SquareDef> board, int from)
		=> CardEffectInterpreter.Resolve(e, board, from);

	[Fact]
	public void MoveTo_an_id_collects_the_pass_bonus_only_when_it_wraps_past_start()
	{
		var board = Board();
		// Advance to the start (0) from 7 wraps around -> collect.
		var toStart = Resolve(new CardEffect { Type = "moveTo", Target = "0", CollectPass = true }, board, 7);
		Assert.Equal(CardOutcomeKind.MoveTo, toStart.Kind);
		Assert.Equal(0, toStart.Position);
		Assert.True(toStart.CollectPass);

		// Advancing forward to a higher space (39) does not pass start -> no bonus.
		var forward = Resolve(new CardEffect { Type = "moveTo", Target = "39", CollectPass = true }, board, 7);
		Assert.Equal(39, forward.Position);
		Assert.False(forward.CollectPass);
	}

	[Fact]
	public void MoveTo_nearest_finds_the_next_matching_type_forward_and_wraps()
	{
		var board = Board();
		// From 7 the next transit forward is 15 (no wrap).
		var near = Resolve(new CardEffect { Type = "moveTo", Target = "nearest:transit", CollectPass = true }, board, 7);
		Assert.Equal(15, near.Position);
		Assert.False(near.CollectPass);

		// From 36 the next transit is 5 (wraps past start) -> collect.
		var wrap = Resolve(new CardEffect { Type = "moveTo", Target = "nearest:transit", CollectPass = true }, board, 36);
		Assert.Equal(5, wrap.Position);
		Assert.True(wrap.CollectPass);
	}

	[Fact]
	public void MoveBy_wraps_and_never_collects()
	{
		var board = Board();
		Assert.Equal(4, Resolve(new CardEffect { Type = "moveBy", Steps = -3 }, board, 7).Position);
		var wrapped = Resolve(new CardEffect { Type = "moveBy", Steps = -3 }, board, 2);
		Assert.Equal(39, wrapped.Position);
		Assert.False(wrapped.CollectPass);
	}

	[Fact]
	public void Money_collect_each_pay_per_building_holding_and_card_map_through()
	{
		var board = Board();
		Assert.Equal(150, Resolve(new CardEffect { Type = "money", Amount = 150 }, board, 0).Amount);
		Assert.Equal(-50, Resolve(new CardEffect { Type = "money", Amount = -50 }, board, 0).Amount);

		var each = Resolve(new CardEffect { Type = "collectFromEach", Amount = 25 }, board, 0);
		Assert.Equal(CardOutcomeKind.CollectFromEach, each.Kind);
		Assert.Equal(25, each.Amount);

		var repairs = Resolve(new CardEffect { Type = "payPerBuilding", PerSmallBuilding = 25, PerBigBuilding = 100 }, board, 0);
		Assert.Equal(CardOutcomeKind.PayPerBuilding, repairs.Kind);
		Assert.Equal(25, repairs.PerSmallBuilding);
		Assert.Equal(100, repairs.PerBigBuilding);

		Assert.Equal(CardOutcomeKind.SendToHolding, Resolve(new CardEffect { Type = "sendToHolding" }, board, 0).Kind);
		Assert.Equal(CardOutcomeKind.GrantReleasePass, Resolve(new CardEffect { Type = "grantReleasePass" }, board, 0).Kind);
		Assert.Equal(CardOutcomeKind.None, Resolve(new CardEffect { Type = "unknown" }, board, 0).Kind);
	}

	[Fact]
	public void MoveTo_carries_a_rent_modifier_for_the_nearest_railway_and_utility_rules()
	{
		var board = Board();

		// Plain moveTo: normal rent (multiplier 1, no utility-dice rule).
		var plain = Resolve(new CardEffect { Type = "moveTo", Target = "nearest:transit", CollectPass = true }, board, 7);
		Assert.Equal(1, plain.RentMultiplier);
		Assert.False(plain.UtilityTimesDice);

		// "nearest railway, pay double": multiplier travels through.
		var railway = Resolve(
			new CardEffect { Type = "moveTo", Target = "nearest:transit", CollectPass = true, RentMultiplier = 2 }, board, 7);
		Assert.Equal(2, railway.RentMultiplier);

		// "nearest utility, 10× dice": the flag travels through.
		var utility = Resolve(
			new CardEffect { Type = "moveTo", Target = "nearest:utility", CollectPass = true, UtilityTimesDice = true }, board, 7);
		Assert.True(utility.UtilityTimesDice);
	}

	[Fact]
	public async Task Resolves_the_real_Galactic_deck()
	{
		 var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("galactic-empire"));
		var board = def.Board;
		CardEffect Effect(string id) => def.Cards.Single(c => c.Id == id).Effect;

		Assert.Equal(0, Resolve(Effect("f1"), board, 7).Position);                       // advance to Launch Pad
		Assert.Equal(15, Resolve(Effect("f3"), board, 7).Position);                      // nearest hyperjump
		Assert.Equal(CardOutcomeKind.SendToHolding, Resolve(Effect("f8"), board, 7).Kind);    // wormhole -> Black Hole
		Assert.Equal(CardOutcomeKind.PayPerBuilding, Resolve(Effect("f12"), board, 7).Kind);
		Assert.Equal(10, Resolve(Effect("b13"), board, 7).Amount);                       // birthday: each pays 10
		Assert.Equal(CardOutcomeKind.GrantReleasePass, Resolve(Effect("b12"), board, 7).Kind);
	}

	[Fact]
	public void Resolves_targets_over_a_live_game_board_too()
	{
		// The same resolution, but driven by the runtime Square board (so a package deck plays).
		// "nearest:<x>" matches the GROUP id (Square.Key), so the engine privileges no square type.
		var board = new List<Square>();
		for (var i = 0; i < 40; i++)
		{
			board.Add(new Square { Id = i, Type = "property" });
		}

		board[5] = new Square { Id = 5, Type = "transit", Key = "transit" };
		board[15] = new Square { Id = 15, Type = "transit", Key = "transit" };

		Assert.Equal(15, CardEffectInterpreter.Resolve(
			new CardEffect { Type = "moveTo", Target = "nearest:transit" }, board, 7).Position);
		Assert.Equal(0, CardEffectInterpreter.Resolve(
			new CardEffect { Type = "moveTo", Target = "0" }, board, 7).Position);
		Assert.Equal(39, CardEffectInterpreter.Resolve(
			new CardEffect { Type = "moveBy", Steps = -3 }, board, 2).Position);
	}
}
