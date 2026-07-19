using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Unit coverage for the validation branches of
/// <see cref="CorroRulebook.BuyPropertyAsync"/> and the set-completion announcement
/// for utilities (the colour-group and railroad variants are pinned in
/// <see cref="Integration.BugRegressionTests"/>). The happy path is exercised by the
/// integration tests and <see cref="TurnAnnouncementTests"/>.
/// </summary>
public class PropertyPurchaseTests
{
	private static Square Buyable(int id, int price = 100, string type = "property", string? color = null)
		=> new() { Id = id, Name = $"S{id}", Type = type, Price = price, Color = color };

	private static (Player buyer, GameContext context) Buyer(List<Square> squares, int money = 1500)
	{
		var buyer = TestFixtures.NewPlayer("a", money: money);
		var state = TestFixtures.NewState(new[] { buyer }, bankMoney: 10000, squares: squares);
		state.CurrentTurn = "a";
		return (buyer, TestFixtures.NewContext(state));
	}

	private static void Pending(GameContext context, string playerId, int squareIndex, int price)
		=> context.GameState.PendingPurchase = new PendingPurchase
		{
			PlayerId = playerId,
			SquareIndex = squareIndex,
			SquareName = $"S{squareIndex}",
			Price = price
		};

	[Fact]
	public async Task Buy_WithNoPendingPurchase_IsRejected()
	{
		var (buyer, context) = Buyer(new List<Square> { Buyable(0) });

		var outcome = await new CorroRulebook().BuyPropertyAsync(buyer, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NO_PENDING_PURCHASE", outcome.ErrorCode);
	}

	[Fact]
	public async Task Buy_WhenSquareDoesNotMatchPending_IsRejected()
	{
		var (buyer, context) = Buyer(new List<Square> { Buyable(0), Buyable(1) });
		Pending(context, "a", 0, 100);

		var outcome = await new CorroRulebook().BuyPropertyAsync(buyer, 1, context);

		Assert.False(outcome.Success);
		Assert.Equal("SQUARE_MISMATCH", outcome.ErrorCode);
	}

	[Fact]
	public async Task Buy_SquareWithoutPrice_IsRejected()
	{
		var noPrice = new Square { Id = 0, Name = "Free Parking", Type = "corner" };
		var (buyer, context) = Buyer(new List<Square> { noPrice });
		Pending(context, "a", 0, 100);

		var outcome = await new CorroRulebook().BuyPropertyAsync(buyer, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NOT_FOR_SALE", outcome.ErrorCode);
	}

	[Fact]
	public async Task Buy_AlreadyOwnedSquare_IsRejected()
	{
		var owned = Buyable(0);
		owned.OwnerId = "someone";
		var (buyer, context) = Buyer(new List<Square> { owned });
		Pending(context, "a", 0, 100);

		var outcome = await new CorroRulebook().BuyPropertyAsync(buyer, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("ALREADY_OWNED", outcome.ErrorCode);
	}

	[Fact]
	public async Task Buy_WhenTooPoor_IsRejected()
	{
		var (buyer, context) = Buyer(new List<Square> { Buyable(0, price: 100) }, money: 50);
		Pending(context, "a", 0, 100);

		var outcome = await new CorroRulebook().BuyPropertyAsync(buyer, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("INSUFFICIENT_FUNDS", outcome.ErrorCode);
	}

	[Fact]
	public async Task Buy_CompletingBothUtilities_AnnouncesAllUtilitiesOwned()
	{
		// "a" already owns the first utility; buying the second completes the group (announced the
		// same group_completed as any group — the engine privileges no utility type).
		var u1 = Buyable(0, price: 150, type: "utility") with { Key = "utility", GroupNameKey = "groups.utility" };
		u1.OwnerId = "a";
		var u2 = Buyable(1, price: 150, type: "utility") with { Key = "utility", GroupNameKey = "groups.utility" };
		var buyer = TestFixtures.NewPlayer("a", money: 1500);
		buyer.Properties.Add(0);
		var state = TestFixtures.NewState(new[] { buyer }, bankMoney: 10000, squares: new List<Square> { u1, u2 });
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state);
		Pending(context, "a", 1, 150);

		var outcome = await new CorroRulebook().BuyPropertyAsync(buyer, 1, context);

		Assert.True(outcome.Success);
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.group_completed_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.group_completed"));
	}
}
