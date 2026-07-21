using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Bots;

namespace CorroServer.Tests;

/// <summary>
/// The v1 exploding bot over its projected view: it draws to take its turn, tucks a bomb it
/// defused back into the pile, pays a Favor directed at it, and stays quiet when another
/// player owns the pending decision or the game is over.
/// </summary>
public class ExplodingBotPolicyTests
{
	private static readonly ExplodingBotPolicy Bot = new();

	private static GameState View(string currentTurn, ExplodingState exploding, bool gameOver = false)
		=> new()
		{
			GameType = "exploding",
			CurrentTurn = currentTurn,
			IsGameOver = gameOver,
			Exploding = exploding,
			ExplodingDeck = new List<ExplodingCardDef>
			{
				new() { Id = "defuse", Type = "defuse", NameKey = "c.defuse" },
				new() { Id = "skip", Type = "skip", NameKey = "c.skip" },
			},
			Players = new List<Player>
			{
				TestFixtures.NewPlayer("bot"), TestFixtures.NewPlayer("human"),
			},
		};

	private static ExplodingState WithSeats() => new()
	{
		Seats = { new() { PlayerId = "bot" }, new() { PlayerId = "human" } },
		DrawCount = 5,
	};

	[Fact]
	public void On_its_turn_it_draws()
	{
		var command = Bot.Decide(View("bot", WithSeats()), "bot");
		Assert.IsType<ExplodingDrawCommand>(command);
	}

	[Theory]
	[InlineData(0, 0)]
	[InlineData(1, 0)]
	[InlineData(2, 1)]
	[InlineData(5, 2)]
	[InlineData(6, 3)]
	public void A_defused_bomb_of_its_own_is_tucked_into_the_middle(int drawCount, int expectedDepth)
	{
		var exploding = WithSeats();
		exploding.DrawCount = drawCount;
		exploding.PendingBomb = new PendingExplodingBomb { PlayerId = "bot", InstanceId = "bomb#0", CardId = "bomb" };

		var command = Assert.IsType<ExplodingDefuseCommand>(Bot.Decide(View("bot", exploding), "bot"));
		Assert.Equal(expectedDepth, command.Depth);
	}

	[Fact]
	public void A_favor_targeted_at_it_is_paid_off_turn_without_sacrificing_a_defuse()
	{
		var exploding = WithSeats();
		var hand = exploding.Seats.First(s => s.PlayerId == "bot").Hand;
		hand.Add(new ExplodingCardInstance { InstanceId = "defuse#0", CardId = "defuse" });
		hand.Add(new ExplodingCardInstance { InstanceId = "skip#0", CardId = "skip" });
		exploding.PendingFavor = new PendingExplodingFavor { RequesterId = "human", TargetId = "bot" };

		var command = Assert.IsType<ExplodingGiveCommand>(Bot.Decide(View("human", exploding), "bot"));

		Assert.Equal("bot", command.PlayerId);
		Assert.Equal("skip#0", command.InstanceId);
	}

	[Fact]
	public void A_favor_is_still_paid_when_only_a_defuse_can_be_given()
	{
		var exploding = WithSeats();
		exploding.Seats.First(s => s.PlayerId == "bot").Hand.Add(
			new ExplodingCardInstance { InstanceId = "defuse#0", CardId = "defuse" });
		exploding.PendingFavor = new PendingExplodingFavor { RequesterId = "human", TargetId = "bot" };

		var command = Assert.IsType<ExplodingGiveCommand>(Bot.Decide(View("human", exploding), "bot"));

		Assert.Equal("defuse#0", command.InstanceId);
	}

	[Fact]
	public void It_waits_when_a_pending_favor_is_someone_elses_decision()
	{
		var exploding = WithSeats();
		exploding.PendingFavor = new PendingExplodingFavor { RequesterId = "bot", TargetId = "human" };

		Assert.Null(Bot.Decide(View("bot", exploding), "bot"));
	}

	[Fact]
	public void It_stays_quiet_off_turn_and_once_the_game_is_over()
	{
		Assert.Null(Bot.Decide(View("human", WithSeats()), "bot"));            // not its turn
		Assert.Null(Bot.Decide(View("bot", WithSeats(), gameOver: true), "bot")); // game over
	}

	[Fact]
	public void It_waits_out_an_open_nope_window()
	{
		var exploding = WithSeats();
		exploding.PendingAction = new PendingExplodingAction { ActorId = "bot", CardId = "skip" };
		Assert.Null(Bot.Decide(View("bot", exploding), "bot"));
	}
}
