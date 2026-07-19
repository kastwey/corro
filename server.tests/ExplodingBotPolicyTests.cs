using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Bots;

namespace CorroServer.Tests;

/// <summary>
/// The v1 exploding bot over its projected view: it draws to take its turn, tucks a bomb it
/// defused back into the pile, and stays quiet when it is not its turn or the game is over.
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
			ExplodingDeck = new List<ExplodingCardDef>(),
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

	[Fact]
	public void A_defused_bomb_of_its_own_is_tucked_back()
	{
		var exploding = WithSeats();
		exploding.PendingBomb = new PendingExplodingBomb { PlayerId = "bot", InstanceId = "bomb#0", CardId = "bomb" };

		var command = Assert.IsType<ExplodingDefuseCommand>(Bot.Decide(View("bot", exploding), "bot"));
		Assert.InRange(command.Depth, 0, 5);
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
