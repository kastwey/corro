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
		var forcedPasses = announcements
			.Where(a => a.Key == "game.assembly_passed")
			.Select(a => Assert.IsType<string>(a.Vars["actorId"]))
			.ToArray();
		Assert.Equal(new[] { "b", "c" }, forcedPasses);
		Assert.True(TestFixtures.Announcer(context).Has(
			AnnouncementAudience.Player, "b", "game.assembly_refilled_self_3"));
		Assert.True(TestFixtures.Announcer(context).Has(
			AnnouncementAudience.Player, "c", "game.assembly_refilled_self_3"));

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
}
