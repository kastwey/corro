using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Bots;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// The draft bot: acts whenever it holds cards and hasn't committed (no turn in this
/// family), never re-picks, and its greedy pick maximises immediate expected points —
/// completing a set, cashing a waiting multiplier, climbing a scale ladder, weighting
/// desserts up as the game ages.
/// </summary>
public class DraftBotPolicyTests
{
	private static readonly DraftBotPolicy Policy = new();

	private static List<DraftCardDef> Deck() => new()
	{
		new() { Id = "bite1", Type = "points", Value = 1, Count = 10, NameKey = "c.bite1" },
		new() { Id = "bite3", Type = "points", Value = 3, Count = 10, NameKey = "c.bite3" },
		new() { Id = "sauce", Type = "multiplier", Factor = 3, Count = 4, NameKey = "c.sauce" },
		new() { Id = "trio", Type = "set", SetSize = 3, SetPoints = 10, Count = 8, NameKey = "c.trio" },
		new() { Id = "olive", Type = "scale", Scale = new() { 1, 3, 6 }, Count = 8, NameKey = "c.olive" },
		new() { Id = "caramel-custard", Type = "dessert", Count = 8, NameKey = "c.flan" },
		new() { Id = "stick", Type = "extra", Count = 4, NameKey = "c.stick" },
	};

	private static DraftCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}#{n}", CardId = cardId };

	private static GameState View(DraftSeatState seat, int round = 1)
	{
		var state = new GameState
		{
			GameType = "draft",
			CurrentTurn = null,
			Draft = new DraftState { Round = round, Seats = new() { seat, new DraftSeatState { PlayerId = "rival" } } },
			DraftDeck = Deck(),
			DraftRules = new DraftRulesConfig(),
			Players = new()
			{
				TestFixtures.NewPlayer("bot"),
				TestFixtures.NewPlayer("rival"),
			},
		};
		return state;
	}

	private static DraftSeatState BotSeat(params string[] hand)
		=> new() { PlayerId = "bot", Hand = hand.Select((c, i) => Inst(c, i)).ToList() };

	private static string PickedCard(GameState view)
	{
		var command = Assert.IsType<DraftPickCommand>(Policy.Decide(view, "bot"));
		return command.InstanceId.Split('#')[0];
	}

	[Fact]
	public void Sits_still_after_committing_or_with_nothing_to_pick()
	{
		var seat = BotSeat("bite1");
		seat.HasPicked = true;
		Assert.Null(Policy.Decide(View(seat), "bot"));

		Assert.Null(Policy.Decide(View(BotSeat()), "bot")); // empty hand

		var over = View(BotSeat("bite1"));
		over.IsGameOver = true;
		Assert.Null(Policy.Decide(over, "bot"));
	}

	[Fact]
	public void Completing_a_set_beats_small_points()
	{
		var seat = BotSeat("trio", "bite1");
		seat.Table.Add(new DraftTableSlot { Card = Inst("trio", 7) });
		seat.Table.Add(new DraftTableSlot { Card = Inst("trio", 8) });

		Assert.Equal("trio", PickedCard(View(seat)));
	}

	[Fact]
	public void A_waiting_multiplier_makes_the_points_card_shine()
	{
		var seat = BotSeat("bite3", "trio");
		seat.Table.Add(new DraftTableSlot { Card = Inst("sauce", 9) });

		Assert.Equal("bite3", PickedCard(View(seat))); // 9 boosted > a first trio copy
	}

	[Fact]
	public void The_scale_ladder_counts_its_marginal_step()
	{
		var seat = BotSeat("olive", "bite1");
		seat.Table.Add(new DraftTableSlot { Card = Inst("olive", 7) });

		Assert.Equal("olive", PickedCard(View(seat))); // step 1→3 nets 2 > 1 point
	}

	[Fact]
	public void An_extra_on_the_table_turns_the_pick_into_a_double()
	{
		var seat = BotSeat("bite3", "caramel-custard", "bite1");
		seat.Table.Add(new DraftTableSlot { Card = Inst("stick", 9) });

		var command = Assert.IsType<DraftPickCommand>(Policy.Decide(View(seat), "bot"));
		Assert.Equal("bite3#0", command.InstanceId);   // 3 points…
		Assert.Equal("caramel-custard#1", command.SecondInstanceId); // …then the dessert (2 in round 1)
	}

	[Fact]
	public void A_double_pick_sends_the_multiplier_FIRST_so_the_points_land_on_it()
	{
		// A waiting sauce boosts bite3 to rank 9, above the hand's own sauce (4.5):
		// the bot must still LEAD with the multiplier it drafts, or it boosts nothing.
		var seat = BotSeat("bite3", "sauce", "bite1", "trio");
		seat.Table.Add(new DraftTableSlot { Card = Inst("stick", 9) });
		seat.Table.Add(new DraftTableSlot { Card = Inst("sauce", 8) });

		var command = Assert.IsType<DraftPickCommand>(Policy.Decide(View(seat), "bot"));
		Assert.Equal("sauce#1", command.InstanceId);
		Assert.Equal("bite3#0", command.SecondInstanceId);
	}

	[Fact]
	public void Desserts_weigh_more_as_the_game_ages()
	{
		var early = BotSeat("caramel-custard", "bite3");
		Assert.Equal("bite3", PickedCard(View(early, round: 1)));

		var late = BotSeat("caramel-custard", "bite3");
		Assert.Equal("caramel-custard", PickedCard(View(late, round: 3)));
	}
}
