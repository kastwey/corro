using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Bots;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// The shedding bot: sheds the most expensive legal coloured card, saves wilds for when
/// nothing else fits (naming its favourite colour), resolves its own drawn-card pause by
/// playing the card, and draws when its hand offers nothing.
/// </summary>
public class SheddingBotPolicyTests
{
	private static readonly SheddingBotPolicy Policy = new();

	private static List<SheddingCardDef> Deck() => new()
	{
		new() { Id = "red-3", Type = "number", Color = "red", Value = 3, Count = 4, NameKey = "c.red3" },
		new() { Id = "red-9", Type = "number", Color = "red", Value = 9, Count = 4, NameKey = "c.red9" },
		new() { Id = "blue-9", Type = "number", Color = "blue", Value = 9, Count = 4, NameKey = "c.blue9" },
		new() { Id = "skip-red", Type = "skip", Color = "red", Count = 2, NameKey = "c.skipred" },
		new() { Id = "d2-blue", Type = "drawTwo", Color = "blue", Count = 2, NameKey = "c.d2blue" },
		new() { Id = "wild", Type = "wild", Count = 2, NameKey = "c.wild" },
	};

	private static SheddingCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}#{n}", CardId = cardId };

	private static GameState View(SheddingSeatState seat, string top = "red-3")
	{
		var shedding = new SheddingState
		{
			Seats = { seat, new SheddingSeatState { PlayerId = "rival", HandCount = 5 } },
		};
		shedding.DiscardPile.Add(Inst(top, 9));
		shedding.CurrentColor = SheddingRulebook.Catalog(Deck())[top].Color ?? "red";
		SheddingRulebook.SyncCounts(shedding);
		return new GameState
		{
			GameType = "shedding",
			CurrentTurn = "bot",
			Shedding = shedding,
			SheddingDeck = Deck(),
			SheddingRules = new SheddingRulesConfig(),
			Players = new() { TestFixtures.NewPlayer("bot"), TestFixtures.NewPlayer("rival") },
		};
	}

	private static SheddingSeatState BotSeat(params string[] hand)
		=> new() { PlayerId = "bot", Hand = hand.Select((c, i) => Inst(c, i)).ToList() };

	[Fact]
	public void Sits_still_off_turn_and_when_the_game_is_over()
	{
		var view = View(BotSeat("red-9"));
		view.CurrentTurn = "rival";
		Assert.Null(Policy.Decide(view, "bot"));

		var over = View(BotSeat("red-9"));
		over.IsGameOver = true;
		Assert.Null(Policy.Decide(over, "bot"));
	}

	[Fact]
	public void Sheds_the_most_expensive_legal_coloured_card_and_saves_the_wild()
	{
		var view = View(BotSeat("red-3", "skip-red", "wild", "red-9"));
		var command = Assert.IsType<SheddingPlayCommand>(Policy.Decide(view, "bot"));
		Assert.Equal("skip-red#1", command.InstanceId); // 20 points beats the 9 and the 3
		Assert.Null(command.ChosenColor);
	}

	[Fact]
	public void Plays_the_wild_only_when_nothing_coloured_fits_naming_its_favourite_colour()
	{
		// Blue cards on a red top: only the wild fits; the hand leans blue.
		var view = View(BotSeat("blue-9", "blue-9", "wild"));
		var command = Assert.IsType<SheddingPlayCommand>(Policy.Decide(view, "bot"));
		Assert.Equal("wild#2", command.InstanceId);
		Assert.Equal("blue", command.ChosenColor);
	}

	[Fact]
	public void Draws_when_the_hand_offers_nothing()
	{
		var view = View(BotSeat("blue-9")); // no wilds, no red, no 3
		Assert.IsType<SheddingDrawCommand>(Policy.Decide(view, "bot"));
	}

	// Stacking (house rule): the bot needs no special code — CanPlay restricts a pending
	// penalty to stacking draw cards, so the bot stacks when it holds one and draws the
	// pile when it doesn't. These lock that emergent behaviour.
	[Fact]
	public void Faced_with_a_penalty_it_stacks_a_matching_draw_card()
	{
		var view = View(BotSeat("d2-blue", "red-9"));
		view.SheddingRules = new SheddingRulesConfig { Stacking = "sameType" };
		view.Shedding!.PendingPenalty = new SheddingPenalty { Amount = 2, LastType = "drawTwo" };

		var command = Assert.IsType<SheddingPlayCommand>(Policy.Decide(view, "bot"));
		Assert.Equal("d2-blue#0", command.InstanceId); // stacks the +2 rather than drawing
	}

	[Fact]
	public void Faced_with_a_penalty_it_cannot_answer_it_draws_the_pile()
	{
		var view = View(BotSeat("red-9", "blue-9")); // no draw card to stack
		view.SheddingRules = new SheddingRulesConfig { Stacking = "sameType" };
		view.Shedding!.PendingPenalty = new SheddingPenalty { Amount = 4, LastType = "drawTwo" };

		Assert.IsType<SheddingDrawCommand>(Policy.Decide(view, "bot"));
	}

	// Last-card house rule: the bot catches a rival who forgot to declare (a separate pass
	// plays its own turn afterwards). Bots declare automatically, so the exposed one is a human.
	[Fact]
	public void Faced_with_a_rival_who_forgot_the_last_card_declaration_it_catches_them_first()
	{
		var view = View(BotSeat("red-9"));
		view.SheddingRules = new SheddingRulesConfig { LastCardCall = true };
		view.Shedding!.PendingLastCardCall = "rival";

		Assert.IsType<SheddingCatchLastCardCommand>(Policy.Decide(view, "bot"));
	}

	[Fact]
	public void It_only_catches_when_the_rule_is_on_and_someone_is_exposed()
	{
		var off = View(BotSeat("red-9"));
		off.Shedding!.PendingLastCardCall = "rival"; // exposed, but the rule is off (default)
		Assert.IsNotType<SheddingCatchLastCardCommand>(Policy.Decide(off, "bot"));

		var clear = View(BotSeat("red-9"));
		clear.SheddingRules = new SheddingRulesConfig { LastCardCall = true }; // on, but nobody exposed
		Assert.IsNotType<SheddingCatchLastCardCommand>(Policy.Decide(clear, "bot"));
	}

	[Fact]
	public void Resolves_its_own_drawn_card_pause_by_playing_the_card()
	{
		var seat = BotSeat("blue-9", "red-9");
		var view = View(seat);
		view.Shedding!.PendingDrawnPlay = new PendingDrawnPlay
		{
			PlayerId = "bot",
			InstanceId = "red-9#1",
		};
		var command = Assert.IsType<SheddingPlayCommand>(Policy.Decide(view, "bot"));
		Assert.Equal("red-9#1", command.InstanceId);
	}
}
