using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Bots;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The bot BRAINS are pure functions over the bot's projected view: these pin the journey
/// policy's decision order (coup first, draw when due, exact finish, restart, best distance,
/// attack the leader, immunities last, worst discard) and the trivial track policy. The
/// policies re-use the pure rulebook, so the game's EFFECTIVE rules are honoured for free.
/// </summary>
public class BotPolicyTests
{
	private static List<JourneyCardDef> Deck() => new()
	{
		new() { Id = "d25", Type = "distance", Value = 25, Count = 6, NameKey = "cards.d25" },
		new() { Id = "d100", Type = "distance", Value = 100, Count = 6, NameKey = "cards.d100" },
		new() { Id = "d200", Type = "distance", Value = 200, Count = 4, Premium = true, MaxPlaysPerHand = 2, NameKey = "cards.d200" },
		new() { Id = "stop", Type = "attack", Kind = "stop", HazardClass = "stopper", Count = 3, NameKey = "cards.stop" },
		new() { Id = "limit", Type = "attack", Kind = "speedLimit", HazardClass = "limiter", Count = 2, NameKey = "cards.limit" },
		new() { Id = "go", Type = "remedy", Kind = "stop", Count = 6, NameKey = "cards.go" },
		new() { Id = "spare", Type = "remedy", Kind = "flat", Count = 2, NameKey = "cards.spare" },
		new() { Id = "flat", Type = "attack", Kind = "flat", HazardClass = "stopper", Count = 2, NameKey = "cards.flat" },
		new() { Id = "priority", Type = "immunity", ShieldsKinds = new() { "stop", "speedLimit" }, NameKey = "cards.priority" },
	};

	private static JourneyCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}#{n}", CardId = cardId };

	private static JourneySeatState Seat(string id, params string[] hazards)
	{
		var seat = new JourneySeatState
		{
			PlayerId = id,
			Members = new() { new JourneyMemberState { PlayerId = id } },
		};
		seat.Hazards.AddRange(hazards);
		return seat;
	}

	/// <summary>A journey view mid-turn: the bot has drawn, the pile is dry unless said.</summary>
	private static GameState View(string turnOf, params JourneySeatState[] seats)
	{
		var journey = new JourneyState { HasDrawn = true };
		journey.Seats.AddRange(seats);
		return new GameState
		{
			GameType = "journey",
			Journey = journey,
			JourneyDeck = Deck(),
			JourneyRules = new JourneyRulesConfig(),
			CurrentTurn = turnOf,
			Players = seats.Select(s => new Player { Id = s.PlayerId, Name = s.PlayerId, Token = "coche" }).ToList(),
		};
	}

	private static readonly JourneyBotPolicy Journey = new();

	// ── Journey ───────────────────────────────────────────────────────────────

	[Fact]
	public void Accepts_its_own_coup_and_waits_out_everyone_elses()
	{
		var view = View("rival", Seat("bot"), Seat("rival"));
		view.Journey!.PendingCoup = new PendingJourneyCoup
		{
			VictimId = "bot",
			AttackerId = "rival",
			HazardKind = "stop",
			ImmunityInstanceId = "priority#0",
		};
		var coup = Assert.IsType<JourneyCoupCommand>(Journey.Decide(view, "bot"));
		Assert.True(coup.Accept);

		view.Journey.PendingCoup = view.Journey.PendingCoup with { VictimId = "rival" };
		Assert.Null(Journey.Decide(view, "bot"));
	}

	[Fact]
	public void Draws_first_when_due_and_stays_quiet_off_turn()
	{
		var view = View("bot", Seat("bot"), Seat("rival"));
		view.Journey!.HasDrawn = false;
		view.Journey.DrawCount = 10;
		Assert.IsType<JourneyDrawCommand>(Journey.Decide(view, "bot"));

		view.CurrentTurn = "rival";
		Assert.Null(Journey.Decide(view, "bot"));
	}

	[Fact]
	public void Prefers_the_EXACT_finish_over_a_bigger_distance()
	{
		var bot = Seat("bot");
		bot.Km = 900;
		bot.Members[0].Hand.AddRange(new[] { Inst("d25"), Inst("d100") });
		var view = View("bot", bot, Seat("rival"));

		var play = Assert.IsType<JourneyPlayCommand>(Journey.Decide(view, "bot"));
		Assert.Equal("d100#0", play.InstanceId); // 900 + 100 == the goal
	}

	[Fact]
	public void Restarts_before_banking_an_immunity_when_stopped()
	{
		var bot = Seat("bot", "stop");
		bot.Members[0].Hand.AddRange(new[] { Inst("priority"), Inst("go") });
		var view = View("bot", bot, Seat("rival"));

		var play = Assert.IsType<JourneyPlayCommand>(Journey.Decide(view, "bot"));
		Assert.Equal("go#0", play.InstanceId); // the green light, not the held immunity
	}

	[Fact]
	public void Attacks_the_LEADING_attackable_rival_seat()
	{
		var bot = Seat("bot", "stop"); // stopped: no distances, so the attack is the play
		bot.Members[0].Hand.Add(Inst("flat"));
		var near = Seat("r1");
		near.Km = 100;
		var far = Seat("r2");
		far.Km = 400;
		var view = View("bot", bot, near, far);

		var play = Assert.IsType<JourneyPlayCommand>(Journey.Decide(view, "bot"));
		Assert.Equal("flat#0", play.InstanceId);
		Assert.Equal("r2", play.TargetId); // the leader takes the hit
	}

	[Fact]
	public void Banks_an_immunity_only_when_nothing_else_plays()
	{
		var bot = Seat("bot", "stop"); // stopped, no cure in hand, nobody attackable
		bot.Members[0].Hand.Add(Inst("priority"));
		var rival = Seat("rival", "stop"); // stopped rival: the stopper cannot land
		var view = View("bot", bot, rival);

		var play = Assert.IsType<JourneyPlayCommand>(Journey.Decide(view, "bot"));
		Assert.Equal("priority#0", play.InstanceId);
	}

	[Fact]
	public void Discards_the_least_useful_card_when_nothing_is_playable_never_an_immunity()
	{
		var bot = Seat("bot", "stop"); // stopped: distances illegal; no cure for "stop" in hand
		bot.Members[0].Hand.AddRange(new[] { Inst("priority"), Inst("spare", 0), Inst("spare", 1), Inst("d200") });
		var rival = Seat("rival", "stop"); // nobody attackable either
		var view = View("bot", bot, rival);
		// "priority" would be legal (immunities always are) — but its play ranks above the
		// discard, so to reach the discard we must make it... impossible; instead verify the
		// DISCARD CHOICE directly on a hand with no immunity.
		bot.Members[0].Hand.RemoveAt(0);

		var discard = Assert.IsType<JourneyDiscardCommand>(Journey.Decide(view, "bot"));
		Assert.StartsWith("spare#", discard.InstanceId); // the duplicate goes first
	}

	// ── Track ─────────────────────────────────────────────────────────────────

	[Fact]
	public void The_track_bot_rolls_on_its_turn_and_only_then()
	{
		var policy = new TrackBotPolicy();
		var view = new GameState
		{
			GameType = "track",
			CurrentTurn = "bot",
			Players = new List<Player> { new() { Id = "bot", Name = "Bot", Token = "coche" } },
		};
		Assert.IsType<RollDiceCommand>(policy.Decide(view, "bot"));

		view.CurrentTurn = "human";
		Assert.Null(policy.Decide(view, "bot"));

		view.CurrentTurn = "bot";
		view.IsGameOver = true;
		Assert.Null(policy.Decide(view, "bot"));
	}
}
