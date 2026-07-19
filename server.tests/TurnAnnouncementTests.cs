using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Verifies that the SERVER is the source of the spoken voice for turn handover
/// and landing/purchase availability — the announcements that used to be driven
/// by the client (DiceRolledHandler / PropertyHandlers). Each acting player hears
/// the first-person "_self" variant; everyone else hears the third-person base key.
/// </summary>
public class TurnAnnouncementTests
{
	private static List<Square> SmallBoard() => new()
	{
		new Square { Id = 0, Name = "Go", Type = "go" },
		new Square { Id = 1, Name = "Baltic", Type = "property", Price = 100 },
		new Square { Id = 2, Name = "Square 2", Type = "property" },
		new Square { Id = 3, Name = "Square 3", Type = "property" },
	};

	private static PendingPurchase Pending() => new()
	{
		PlayerId = "a",
		SquareIndex = 1,
		SquareName = "Baltic",
		Price = 100
	};

	[Fact]
	public async Task BuyProperty_KeepsTurn_DoesNotAnnounceNextPlayer()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 1);
		var b = TestFixtures.NewPlayer("b", money: 1500, position: 0);
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.CurrentTurn = "a";
		state.PendingPurchase = Pending();
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().BuyPropertyAsync(a, 1, context);

		Assert.True(outcome.Success);
		// Buying is a turn action: the player keeps control and ends the turn explicitly.
		Assert.Equal("a", state.CurrentTurn);
		var announcer = TestFixtures.Announcer(context);
		Assert.DoesNotContain(announcer.Sent, x => x.Key == "game.turn_of");
		Assert.DoesNotContain(announcer.Sent, x => x.Key == "game.turn_of_self");
	}

	[Fact]
	public async Task BuyProperty_OnDoublesRoll_KeepsTurn_DoesNotReannounce()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 1);
		var b = TestFixtures.NewPlayer("b", money: 1500, position: 0);
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.CurrentTurn = "a";
		state.PendingPurchase = Pending();
		// The player still owes a roll from the doubles; buying must not clear or re-voice it.
		state.MustRollAgain = true;
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().BuyPropertyAsync(a, 1, context);

		Assert.True(outcome.Success);
		Assert.Equal("a", state.CurrentTurn); // same player still in control
		Assert.True(state.MustRollAgain); // the re-roll obligation persists through the purchase
		var announcer = TestFixtures.Announcer(context);
		// The roll-again voice belongs to the roll, not the purchase. Buying re-announces
		// neither the turn handover nor the doubles re-roll.
		Assert.DoesNotContain(announcer.Sent, x => x.Key == "game.turn_of");
		Assert.DoesNotContain(announcer.Sent, x => x.Key == "game.doubles_roll_again");
	}

	[Fact]
	public async Task DeclineProperty_StartsAuction_DoesNotAnnounceTurn()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 1);
		var b = TestFixtures.NewPlayer("b", money: 1500, position: 0);
		var state = TestFixtures.NewState(new[] { a, b }, squares: SmallBoard());
		state.PendingPurchase = Pending();
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().DeclinePropertyAsync(a, 1, context);

		Assert.True(outcome.AuctionStarted);
		var announcer = TestFixtures.Announcer(context);
		// The auction owns turn flow; declining must NOT hand the turn over.
		Assert.DoesNotContain(announcer.Sent, x => x.Key == "game.turn_of");
	}

}
