using System.Text.Json;
using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using CorroServer.Services.Bots;
using CorroServer.Services.Corro;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The driver plays REAL games from outside the engine through the very same GameService
/// pipeline a human's commands take: it completes a journey bot's whole turn and makes an
/// exploding bot answer an off-turn Favor without wedging the table.
/// </summary>
public class BotDriverTests
{
	private static async Task<GameService> StartHumanVsBotAsync()
	{
		var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("great-route"));
		var svc = new GameService(new CorroRulebook(), new AuctionRulebook());
		await svc.InitializeFromDefinitionAsync(new List<Player>
		{
			new() { Id = "a", Name = "Ana", Token = "car" },
			new() { Id = "b", Name = "Bot 1", Token = "motorbike", IsBot = true },
		}, def, "es");
		return svc;
	}

	private static async Task<GameService> StartHumanVsSheddingBotAsync()
	{
		var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("four-colours"));
		var svc = new GameService(new CorroRulebook(), new AuctionRulebook());
		await svc.InitializeFromDefinitionAsync(new List<Player>
		{
			new() { Id = "a", Name = "Ana", Token = "disc" },
			new() { Id = "b", Name = "Bot 1", Token = "star", IsBot = true },
		}, def, "es");
		return svc;
	}

	private static async Task<GameService> StartHumanVsExplodingBotAsync()
	{
		var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("the-mine"));
		var svc = new GameService(new CorroRulebook(), new AuctionRulebook());
		await svc.InitializeFromDefinitionAsync(new List<Player>
		{
			new() { Id = "a", Name = "Ana", Token = "mine-cart" },
			new() { Id = "b", Name = "Bot 1", Token = "helmet", IsBot = true },
		}, def, "es");
		return svc;
	}

	/// <summary>
	/// Wait for something the bot driver does on its own thread.
	///
	/// The deadline is generous on purpose. It is not a performance budget — the bot finishes in
	/// about 300 ms on an idle machine — it is only the point at which "still working" becomes
	/// "never going to happen". Five seconds looked like plenty until the pre-push hook ran this
	/// straight after a full build and the suite failed on a machine that was merely busy, which
	/// is a false alarm about somebody's unrelated change. A hung driver still fails, just later.
	/// </summary>
	private static async Task WaitUntilAsync(Func<bool> condition, string what, int timeoutMs = 30_000)
	{
		var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
		while (!condition() && DateTime.UtcNow < deadline)
		{
			await Task.Delay(25);
		}

		Assert.True(condition(), $"timed out waiting for: {what}");
	}

	[Fact]
	public async Task The_bot_completes_its_whole_turn_and_hands_the_turn_back()
	{
		var svc = await StartHumanVsBotAsync();
		var driver = new BotDriver(new BotOptions { ActionDelay = TimeSpan.Zero });
		driver.Attach("g1", svc);

		// The HUMAN's turn, played by hand: draw, then discard the first card.
		Assert.Equal("a", svc.GameState!.CurrentTurn);
		await svc.ExecuteCommandAsync(new JourneyDrawCommand { PlayerId = "a" });
		var myCard = JourneyRulebook.MemberOf(svc.GameState.Journey!, "a").Hand[0].InstanceId;
		await svc.ExecuteCommandAsync(new JourneyDiscardCommand { PlayerId = "a", InstanceId = myCard });

		// The state change wakes the driver: the bot must draw AND play/discard, then the
		// turn returns to the human — a full unattended bot turn.
		//
		// One deal in a hundred or so hands the bot a speed limit and the human the right of
		// way: the bot's attack then lands on a victim holding the shield, and the GAME pauses
		// for the human's coup fourré answer — which is correct play, and which this test used to
		// sit out for thirty seconds and call a timeout. The human plays their part here, as a
		// person would (the deterministic version of that deal is the test below).
		await WaitUntilAsync(
			() => svc.GameState.CurrentTurn == "a" || svc.GameState.Journey!.PendingCoup?.VictimId == "a",
			"the turn to come back to the human, or a coup fourré to be offered to them");
		if (svc.GameState.Journey!.PendingCoup?.VictimId == "a")
		{
			await svc.ExecuteCommandAsync(new JourneyCoupCommand { PlayerId = "a", Accept = false });
		}
		await WaitUntilAsync(() => svc.GameState.CurrentTurn == "a", "the turn to come back to the human");
		// Deterministic traces, whatever the (shuffled) bot hand held: two draws left the
		// pile, and the bot's hand is back to size after playing or discarding one card.
		var journey = svc.GameState.Journey!;
		Assert.Equal(94 - 2, journey.DrawCount); // 106 − 12 dealt − the human's draw − the bot's
		Assert.Equal(6, JourneyRulebook.MemberOf(journey, "b").Hand.Count);
	}

	/// <summary>
	/// Rig the deal so the bot's turn is an attack the human can answer: the bot holds one speed
	/// limit and otherwise distance it cannot play while stopped, the human holds the right of way
	/// (which shields the speed limit) at the back of their hand, and the next two cards of the pile
	/// are distance too, so neither draw hands anybody a better play. Every card stays in the game:
	/// the hands are refilled from the pool and the rest goes back on the pile.
	/// </summary>
	private static void DealASpeedLimitIntoTheRightOfWay(GameService svc)
	{
		var journey = svc.GameState!.Journey!;
		var human = JourneyRulebook.MemberOf(journey, "a").Hand;
		var bot = JourneyRulebook.MemberOf(journey, "b").Hand;
		var pool = human.Concat(bot).Concat(journey.DrawPile).ToList();
		human.Clear();
		bot.Clear();
		journey.DrawPile.Clear();

		JourneyCardInstance Take(string cardId)
		{
			var card = pool.First(c => c.CardId == cardId);
			pool.Remove(card);
			return card;
		}

		bot.Add(Take("speed-limit"));
		for (var i = 0; i < 5; i++) bot.Add(Take("distance-25"));
		for (var i = 0; i < 5; i++) human.Add(Take("distance-25"));
		human.Add(Take("right-of-way"));
		var nextDraws = new[] { Take("distance-50"), Take("distance-50") };
		journey.DrawPile.AddRange(pool);
		journey.DrawPile.AddRange(nextDraws); // top last: the human draws one, the bot the other
		JourneyRulebook.SyncCounts(journey);
	}

	// The failure this pins down was a flake: the test above timed out once in a long while, on
	// whatever deal put a speed limit in the bot's hand and the right of way in the human's. The
	// bot's attack then opens the victim's coup fourré window and the game waits — for the human,
	// not for the bot — which is exactly what it should do, and what the driver must not "fix" by
	// acting again or spinning.
	[Theory]
	[InlineData(false)]
	[InlineData(true)]
	public async Task The_bot_waits_for_the_humans_coup_fourre_answer_and_the_game_goes_on_from_it(bool accept)
	{
		var svc = await StartHumanVsBotAsync();
		DealASpeedLimitIntoTheRightOfWay(svc);
		var driver = new BotDriver(new BotOptions { ActionDelay = TimeSpan.Zero });
		driver.Attach("g1", svc);

		await svc.ExecuteCommandAsync(new JourneyDrawCommand { PlayerId = "a" });
		var myCard = JourneyRulebook.MemberOf(svc.GameState!.Journey!, "a").Hand[0].InstanceId;
		await svc.ExecuteCommandAsync(new JourneyDiscardCommand { PlayerId = "a", InstanceId = myCard });

		// The bot draws and attacks; the human holds the shield, so the game pauses on them.
		await WaitUntilAsync(() => svc.GameState.Journey!.PendingCoup != null, "the bot's speed limit to offer the coup fourré");
		var journey = svc.GameState.Journey!;
		var coup = journey.PendingCoup!;
		Assert.Equal("a", coup.VictimId);
		Assert.Equal("b", coup.AttackerId);
		Assert.Equal("speedLimit", coup.HazardKind);
		Assert.Equal("b", svc.GameState.CurrentTurn); // the attacker's turn is paused, not over
		Assert.Contains("speedLimit", JourneyRulebook.SeatOf(journey, "a").Hazards);

		// And it STAYS paused: the driver neither repeats the bot's move nor answers for the human.
		await Task.Delay(200);
		Assert.Same(coup, journey.PendingCoup);
		Assert.Equal(94 - 2, journey.DrawCount);
		Assert.Equal(6, JourneyRulebook.MemberOf(journey, "b").Hand.Count);

		var response = await svc.ExecuteCommandAsync(new JourneyCoupCommand { PlayerId = "a", Accept = accept });

		Assert.IsType<JourneyActionResponse>(response);
		Assert.Null(journey.PendingCoup);
		// Either answer ends the pause with the human to play: declining ends the bot's turn the
		// ordinary way, accepting hands the turn to the coup's author with the hazard cancelled,
		// the shield on the table and a replacement card drawn.
		await WaitUntilAsync(() => svc.GameState.CurrentTurn == "a", "the turn to reach the human");
		var humanSeat = JourneyRulebook.SeatOf(journey, "a");
		if (accept)
		{
			Assert.DoesNotContain("speedLimit", humanSeat.Hazards);
			Assert.Contains("right-of-way", humanSeat.Immunities);
			Assert.Equal(1, humanSeat.CoupFourres);
			Assert.Equal(94 - 3, journey.DrawCount);
		}
		else
		{
			Assert.Contains("speedLimit", humanSeat.Hazards);
			Assert.Empty(humanSeat.Immunities);
			Assert.Equal(94 - 2, journey.DrawCount);
		}
	}

	[Fact]
	public async Task A_bot_move_runs_the_callers_after_command_work_exactly_like_a_human_one()
	{
		// Reported from play: a one-round game of Four Colours won by the BOT left the table
		// believing a match was still running, so the group could not start another. The driver
		// broadcast the new state — copied from the hub — but not what the hub does next, which is
		// where a finished match is retired. Anything the caller does after a command must run for
		// a bot's command too; the engine cannot tell the two apart, and neither should the table.
		var svc = await StartHumanVsBotAsync();
		var afterCommand = 0;
		var driver = new BotDriver(new BotOptions { ActionDelay = TimeSpan.Zero });
		driver.Attach("g1", svc, () => { Interlocked.Increment(ref afterCommand); return Task.CompletedTask; });

		await svc.ExecuteCommandAsync(new JourneyDrawCommand { PlayerId = "a" });
		var myCard = JourneyRulebook.MemberOf(svc.GameState!.Journey!, "a").Hand[0].InstanceId;
		await svc.ExecuteCommandAsync(new JourneyDiscardCommand { PlayerId = "a", InstanceId = myCard });

		await WaitUntilAsync(() => Volatile.Read(ref afterCommand) > 0, "the bot's move to run the after-command work");
	}

	[Fact]
	public async Task A_match_the_BOT_ends_leaves_the_table_ready_to_play_again()
	{
		// The test above proves the wiring: the driver runs whatever the caller handed it. This one
		// proves the CONSEQUENCE the wiring exists for, which is what was actually reported — the
		// table going back to waiting. They are two claims, and only the second one bit: a table
		// whose match the bot won answered "the game has already started" for good.
		//
		// So the callback here is the real one both hub sites pass, against a real registry, rather
		// than a counter.
		var svc = await StartHumanVsSheddingBotAsync();

		// One card from going out, with a score that its win carries past the 500-point target: the
		// command that ends the MATCH is then the bot's own, which is the whole point.
		var shedding = svc.GameState!.Shedding!;
		var bot = SheddingRulebook.SeatOf(shedding, "b");
		bot.Score = 495;
		bot.Hand.Clear();
		bot.Hand.Add(new SheddingCardInstance { InstanceId = "red-7#99", CardId = "red-7" });
		shedding.DiscardPile.Clear();
		shedding.DiscardPile.Add(new SheddingCardInstance { InstanceId = "red-3#98", CardId = "red-3" });
		shedding.CurrentColor = "red";
		SheddingRulebook.SyncCounts(shedding);
		svc.GameState.CurrentTurn = "b";

		var repo = new GameSessionRegistryTests.RecordingRepo();
		repo.Documents["g1"] = new GameDocument
		{
			Id = "game-g1", GameId = "g1", Status = GameStatus.Active, HostId = "a", InviteCode = "INV",
		};
		var registry = new GameSessionRegistry(
			new GameSessionRegistryTests.NoopHubContext(), repo,
			new GameSessionRegistryTests.RecordingTimer(), TestFixtures.NewPackageRestorer());
		registry.RegisterService("g1", svc);

		var driver = new BotDriver(new BotOptions { ActionDelay = TimeSpan.Zero });
		driver.Attach("g1", svc, () => registry.CleanupIfGameOverAsync("g1", svc));

		await WaitUntilAsync(() => repo.Documents["g1"].Status == GameStatus.WaitingForPlayers,
			"the table to go back to waiting after the bot's winning move");

		var table = repo.Documents["g1"];
		Assert.Null(table.GameState);              // no match running: the host may start another
		Assert.True(table.LastMatch!.IsGameOver);  // …and the result outlived the game
		Assert.Equal("b", table.LastMatch.WinnerId);
	}

	[Fact]
	public async Task The_exploding_bot_pays_a_pending_favor_through_the_command_pipeline()
	{
		var svc = await StartHumanVsExplodingBotAsync();
		var exploding = svc.GameState!.Exploding!;
		var catalog = ExplodingRulebook.Catalog(svc.GameState.ExplodingDeck!);
		var human = ExplodingRulebook.SeatOf(exploding, "a");
		var bot = ExplodingRulebook.SeatOf(exploding, "b");
		var defuse = bot.Hand.Single(card => ExplodingRulebook.IsDefuse(catalog[card.CardId]));
		var expectedGift = bot.Hand.First(card => !ExplodingRulebook.IsDefuse(catalog[card.CardId]));
		exploding.PendingFavor = new PendingExplodingFavor { RequesterId = "a", TargetId = "b" };

		var driver = new BotDriver(new BotOptions { ActionDelay = TimeSpan.Zero });
		driver.Attach("exploding-favor", svc);

		await WaitUntilAsync(() => exploding.PendingFavor == null, "the bot to pay the Favor");

		Assert.Contains(expectedGift, human.Hand);
		Assert.DoesNotContain(expectedGift, bot.Hand);
		Assert.Contains(defuse, bot.Hand);
	}

	[Fact]
	public async Task Attach_is_a_safe_no_op_without_bots_or_without_a_policy()
	{
		var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("great-route"));
		var svc = new GameService(new CorroRulebook(), new AuctionRulebook());
		await svc.InitializeFromDefinitionAsync(new List<Player>
		{
			new() { Id = "a", Name = "Ana", Token = "car" },
			new() { Id = "b", Name = "Berto", Token = "motorbike" },
		}, def, "es");

		var driver = new BotDriver(new BotOptions { ActionDelay = TimeSpan.Zero });
		driver.Attach("g2", svc); // no bot seats: nothing to do, nothing to break

		await svc.ExecuteCommandAsync(new JourneyDrawCommand { PlayerId = "a" });
		await Task.Delay(100);
		Assert.Equal("a", svc.GameState!.CurrentTurn); // nobody played for Berto
	}
}
