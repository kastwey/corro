using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// End-to-end for package cards: real cards from the shipped Galactic deck, resolved and applied
/// through the engine (interpreter over the adapted board + the shared effect primitives). Proves
/// a .corro deck plays without any card class in the rulebook.
/// </summary>
public class PackageCardApplicationTests
{
	private static (GameDefinition Def, List<Square> Board) Galactic()
	{
		 var def = new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("galactic-empire"))
			.GetAwaiter().GetResult();
		return (def, GameDefinitionAdapter.ToSquares(def, "es"));
	}

	private static GameContext Context(List<Square> board, params Player[] players)
		=> TestFixtures.NewContext(TestFixtures.NewState(players, squares: board));

	[Fact]
	public async Task A_go_to_release_pass_holdings_the_player()
	{
		var (def, board) = Galactic();
		var card = def.Cards.First(c => c.Effect.Type == "sendToHolding");
		var a = TestFixtures.NewPlayer("a");

		await new CorroRulebook().ApplyPackageCardAsync(a, card, Context(board, a));

		Assert.True(a.IsHeld);
	}

	[Fact]
	public async Task A_collect_from_each_card_collects_from_every_other_player()
	{
		var (def, board) = Galactic();
		var card = def.Cards.First(c => c.Effect.Type == "collectFromEach");
		var amount = card.Effect.Amount ?? 0;
		var a = TestFixtures.NewPlayer("a", money: 1000);
		var b = TestFixtures.NewPlayer("b", money: 1000);

		await new CorroRulebook().ApplyPackageCardAsync(a, card, Context(board, a, b));

		Assert.Equal(1000 + amount, a.Money);
		Assert.Equal(1000 - amount, b.Money);
	}

	[Fact]
	public async Task A_money_card_changes_the_balance()
	{
		var (def, board) = Galactic();
		var card = def.Cards.First(c => c.Effect.Type == "money");
		var a = TestFixtures.NewPlayer("a", money: 1000);

		await new CorroRulebook().ApplyPackageCardAsync(a, card, Context(board, a));

		Assert.Equal(1000 + (card.Effect.Amount ?? 0), a.Money);
	}

	[Fact]
	public async Task A_grant_release_pass_grants_one()
	{
		var (def, board) = Galactic();
		var card = def.Cards.First(c => c.Effect.Type == "grantReleasePass");
		var a = TestFixtures.NewPlayer("a");

		await new CorroRulebook().ApplyPackageCardAsync(a, card, Context(board, a));

		Assert.Equal(1, a.ReleasePasses);
	}

	[Fact]
	public async Task An_advance_card_relocates_the_player()
	{
		var (def, board) = Galactic();
		var card = def.Cards.First(c => c.Effect.Type == "moveTo" && c.Effect.Target == "0"); // advance to start
		var a = TestFixtures.NewPlayer("a", money: 1000, position: 7);

		await new CorroRulebook().ApplyPackageCardAsync(a, card, Context(board, a));

		Assert.Equal(0, a.Position);
	}
}
