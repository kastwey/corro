using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Assembly turn orchestration beyond the pure rulebook: automatic refill, forced passes
/// after a hand-scrapping effect, private draw identities and the final turn handoff.
/// </summary>
public class AssemblyTurnFlowTests
{
	private static readonly AssemblyRulesConfig Rules = new();

	private static readonly List<AssemblyCardDef> Deck = new()
	{
		new() { Id = "piece", Type = "piece", Color = "red", Count = 20, NameKey = "cards.piece" },
		new()
		{
			Id = "scrap",
			Type = "special",
			SpecialKind = "scrapHands",
			Count = 1,
			NameKey = "cards.scrap",
			PlayedKey = "cards.scrap_played",
		},
	};

	private static AssemblyCardInstance Card(string cardId, string instanceId)
		=> new() { CardId = cardId, InstanceId = instanceId };

	private static (GameState State, GameContext Context) Game()
	{
		var players = new[]
		{
			TestFixtures.NewPlayer("a"),
			TestFixtures.NewPlayer("b"),
			TestFixtures.NewPlayer("c"),
		};
		var assembly = new AssemblyState
		{
			Seats = new()
			{
				new() { PlayerId = "a", Hand = new() { Card("scrap", "scrap#0") } },
				new()
				{
					PlayerId = "b",
					Hand = new()
					{
						Card("piece", "b#0"), Card("piece", "b#1"), Card("piece", "b#2"),
					},
				},
				new()
				{
					PlayerId = "c",
					Hand = new()
					{
						Card("piece", "c#0"), Card("piece", "c#1"), Card("piece", "c#2"),
					},
				},
			},
			DrawPile = Enumerable.Range(0, 9)
				.Select(i => Card("piece", $"draw#{i}"))
				.ToList(),
		};
		AssemblyRulebook.SyncCounts(assembly);

		var state = TestFixtures.NewState(players);
		state.GameType = "assembly";
		state.Assembly = assembly;
		state.AssemblyDeck = Deck;
		state.AssemblyRules = Rules;

		var baseContext = TestFixtures.NewContext(state);
		var context = new GameContext
		{
			GameState = state,
			Helper = baseContext.Helper,
			Settings = baseContext.Settings,
			FamilyRuntime = new AssemblyRuntime(AssemblyRulebook.Catalog(Deck), Deck, Rules),
			Random = baseContext.Random,
			Announce = baseContext.Announce,
			Announcer = baseContext.Announcer,
			Presenter = baseContext.Presenter,
		};
		return (state, context);
	}

	[Fact]
	public async Task ScrapHands_forces_empty_rivals_to_pass_refill_and_cannot_block_the_game()
	{
		var (state, context) = Game();

		var response = await AssemblyTurnFlow.PlayAsync(
			new AssemblyPlayCommand { PlayerId = "a", InstanceId = "scrap#0" },
			state.Players[0], context, new ScriptedRandomSource());

		var action = Assert.IsType<AssemblyActionResponse>(response);
		Assert.True(action.TurnEnded);
		Assert.Equal("a", state.CurrentTurn);
		Assert.All(state.Assembly!.Seats, seat => Assert.Equal(Rules.HandSize, seat.Hand.Count));

		var announcements = TestFixtures.Announcer(context).Sent;
		var scrap = announcements.Single(a => a.Key == "cards.scrap_played_self");
		Assert.Equal("cards-discard", scrap.Vars["visualKind"]);
		Assert.Equal("scrap", scrap.Vars["visualCardId"]);
		var forcedPasses = announcements
			.Where(a => a.Key == "game.assembly_passed")
			.Select(a => Assert.IsType<string>(a.Vars["actorId"]))
			.ToArray();
		Assert.Equal(new[] { "b", "c" }, forcedPasses);
		Assert.True(TestFixtures.Announcer(context).Has(
			AnnouncementAudience.Player, "b", "game.assembly_refilled_self_3"));
		Assert.True(TestFixtures.Announcer(context).Has(
			AnnouncementAudience.Player, "c", "game.assembly_refilled_self_3"));
		var refill = announcements.Single(a =>
			a.Audience == AnnouncementAudience.Player && a.PlayerId == "b"
			&& a.Key == "game.assembly_refilled_self_3");
		Assert.Equal("card-draw", refill.Vars["visualKind"]);
		Assert.Equal("b", refill.Vars["visualTargetPlayerId"]);
		Assert.Equal("piece", refill.Vars["visualCard1Id"]);

		var passB = announcements.FindIndex(a =>
			a.Key == "game.assembly_passed" && Equals(a.Vars["actorId"], "b"));
		var refillB = announcements.FindIndex(a =>
			a.Key == "game.assembly_refilled_self_3" && a.PlayerId == "b");
		var passC = announcements.FindIndex(a =>
			a.Key == "game.assembly_passed" && Equals(a.Vars["actorId"], "c"));
		var finalTurn = announcements.FindIndex(a =>
			a.Key == "game.turn_of" && Equals(a.Vars["player"], "a"));
		Assert.True(passB < refillB && refillB < passC && passC < finalTurn);
		Assert.DoesNotContain(announcements, a =>
			a.Key == "game.turn_of" && !Equals(a.Vars["player"], "a"));
	}

	// ── The completed rack ────────────────────────────────────────────────────

	private static readonly List<AssemblyCardDef> RackDeck = new()
	{
		new() { Id = "red", Type = "piece", Color = "red", Count = 4, NameKey = "cards.red" },
		new() { Id = "blue", Type = "piece", Color = "blue", Count = 4, NameKey = "cards.blue" },
		new() { Id = "green", Type = "piece", Color = "green", Count = 4, NameKey = "cards.green" },
		new() { Id = "yellow", Type = "piece", Color = "yellow", Count = 4, NameKey = "cards.yellow" },
		new() { Id = "hit", Type = "attack", Color = "green", Count = 4, NameKey = "cards.hit" },
	};

	private static AssemblySlot Slot(string owner, string color, bool afflicted = false)
		=> new()
		{
			Color = color,
			Piece = Card(color, $"{owner}-{color}"),
			Afflictions = afflicted
				? new List<AssemblyCardInstance> { Card("hit", $"{owner}-hit") }
				: new List<AssemblyCardInstance>(),
		};

	/// <summary>Three racks a match could really be sitting on when it ends: one a single piece
	/// short, one carrying an afflicted piece, one barely started.</summary>
	private static (GameState State, GameContext Context) RackGame()
	{
		var assembly = new AssemblyState
		{
			Seats = new()
			{
				new()
				{
					PlayerId = "a",
					Hand = new() { Card("yellow", "a-yellow#0") },
					Slots = { Slot("a", "red"), Slot("a", "blue"), Slot("a", "green") },
				},
				new()
				{
					PlayerId = "b",
					Slots = { Slot("b", "red"), Slot("b", "blue"), Slot("b", "green", afflicted: true) },
				},
				new() { PlayerId = "c", Slots = { Slot("c", "red") } },
			},
			DrawPile = Enumerable.Range(0, 4).Select(i => Card("red", $"draw#{i}")).ToList(),
		};
		AssemblyRulebook.SyncCounts(assembly);

		var state = TestFixtures.NewState(new[]
		{
			TestFixtures.NewPlayer("a"),
			TestFixtures.NewPlayer("b"),
			TestFixtures.NewPlayer("c"),
		});
		state.GameType = "assembly";
		state.Assembly = assembly;
		state.AssemblyDeck = RackDeck;
		state.AssemblyRules = Rules;

		var baseContext = TestFixtures.NewContext(state);
		var context = new GameContext
		{
			GameState = state,
			Helper = baseContext.Helper,
			Settings = baseContext.Settings,
			FamilyRuntime = new AssemblyRuntime(AssemblyRulebook.Catalog(RackDeck), RackDeck, Rules),
			Random = baseContext.Random,
			Announce = baseContext.Announce,
			Announcer = baseContext.Announcer,
			Presenter = baseContext.Presenter,
		};
		return (state, context);
	}

	[Fact]
	public async Task The_finished_rack_ends_the_match_and_the_table_counts_the_parts_that_still_work()
	{
		var (state, context) = RackGame();

		var response = await AssemblyTurnFlow.PlayAsync(
			new AssemblyPlayCommand { PlayerId = "a", InstanceId = "a-yellow#0" },
			state.Players[0], context, new ScriptedRandomSource());

		Assert.True(Assert.IsType<AssemblyActionResponse>(response).GameEnded);
		Assert.True(state.IsGameOver);
		Assert.Equal("a", state.WinnerId);

		var standings = new AssemblyFamily().FinalStandings(state);
		StandingsSanity.AssertSane(state, standings);
		Assert.Equal("game.end_measure_parts", standings!.MeasureKey);
		Assert.Equal(new[] { "a", "b", "c" }, standings.Sides.Select(side => side.MemberIds.Single()));
		// b holds THREE pieces and is credited with two: the hit one is not helping anybody
		// finish a rack, and the placings behind the winner are decided the same way. A table
		// reading the rack size would show a bigger number above a worse place.
		Assert.Equal(3, state.Assembly!.Seats[1].Slots.Count);
		Assert.Equal(new[] { 4, 2, 1 }, standings.Sides.Select(side => side.Value));
	}
}
