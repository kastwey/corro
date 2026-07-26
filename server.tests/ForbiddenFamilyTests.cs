using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;
using CorroServer.Services.Sounds;

namespace CorroServer.Tests;

public class ForbiddenFamilyTests
{
	private static List<Player> Players(int count = 4)
		=> Enumerable.Range(0, count).Select(index => TestFixtures.NewPlayer($"p{index}", token: $"t{index}"))
			.ToList();

	private static List<List<string>> Teams(int size = 2)
		=> new()
		{
			Enumerable.Range(0, size).Select(index => $"p{index}").ToList(),
			Enumerable.Range(size, size).Select(index => $"p{index}").ToList(),
		};

	[Fact]
	public async Task Shipped_package_loads_bilingual_real_content_and_valid_rules()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));

		Assert.Equal("forbidden", definition.Manifest.GameType);
		Assert.Equal(24, definition.ForbiddenWords!["en"].Count);
		Assert.Equal("lighthouse", definition.ForbiddenWords["en"][0].Target);
		Assert.Equal("faro", definition.ForbiddenWords["es"][0].Target);
		Assert.Equal(60, definition.Manifest.ForbiddenRules!.TurnSeconds);
	}

	[Fact]
	public void Shipped_package_bundles_the_auction_clock_under_its_own_timer_event()
	{
		var packageDir = CorroTestPaths.PackageDir("forbidden-words");
		var soundsDir = Path.Combine(packageDir, "assets", "sounds");
		var provider = new DefaultSoundPackProvider(soundsDir);
		var events = provider.ResolveEvents(null);

		Assert.Equal("timer-tick.ogg", Assert.Single(events["forbidden.tick"]));
		Assert.True(provider.TryGetSoundFile("forbidden-words", "timer-tick.ogg", out var timerPath, out var contentType));
		Assert.Equal("audio/ogg", contentType);

		var attributedAuctionClock = Path.Combine(
			CorroTestPaths.PackageDir("galactic-empire"), "assets", "sounds", "auction-tick.ogg");
		Assert.True(File.ReadAllBytes(attributedAuctionClock).SequenceEqual(File.ReadAllBytes(timerPath)),
			"Forbidden Words must bundle the verified CC0 auction-clock audio, not an unrelated timer cue.");
	}

	[Fact]
	public async Task Game_content_uses_the_explicit_shared_word_language()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var family = new ForbiddenFamily();
		var game = family.CreateGame(new FamilyStartContext
		{
			Players = Players(),
			Definition = definition,
			Lang = "es",
			Teams = Teams(),
		});

		Assert.Equal("faro", game.State.Forbidden!.Turn.Target);
		Assert.Equal("faro", game.State.ForbiddenDeck![0].Target);
		Assert.Equal("p0", game.State.Forbidden.Turn.ClueGiverId);
		Assert.Equal("p1", game.State.Forbidden.Turn.GuesserId);
		Assert.Equal("p2", game.State.Forbidden.Turn.MonitorId);
	}

	[Fact]
	public async Task Game_rejects_a_word_language_the_package_does_not_supply()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var error = Assert.Throws<InvalidOperationException>(() => new ForbiddenFamily().CreateGame(new FamilyStartContext
		{
			Players = Players(),
			Definition = definition,
			Lang = "fr",
			Teams = Teams(),
		}));

		Assert.Contains("selected language 'fr'", error.Message);
	}

	[Fact]
	public async Task Projection_reveals_the_private_card_only_to_clue_giver_and_monitor()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var family = new ForbiddenFamily();
		var full = family.CreateGame(new FamilyStartContext
		{
			Players = Players(), Definition = definition, Lang = "en", Teams = Teams(),
		}).State;
		var turn = full.Forbidden!.Turn;

		var giver = family.ProjectFor(full, turn.ClueGiverId);
		var monitor = family.ProjectFor(full, turn.MonitorId);
		var guesser = family.ProjectFor(full, turn.GuesserId);
		var spectator = family.ProjectFor(full, "p3");
		var publicView = family.ProjectFor(full, null);

		Assert.Equal("lighthouse", giver.Forbidden!.Turn.Target);
		Assert.Equal("lighthouse", monitor.Forbidden!.Turn.Target);
		foreach (var hidden in new[] { guesser, spectator, publicView })
		{
			Assert.Null(hidden.Forbidden!.Turn.Target);
			Assert.Null(hidden.Forbidden.Turn.CardId);
			Assert.Empty(hidden.Forbidden.Turn.ForbiddenWords);
			Assert.Null(hidden.ForbiddenDeck);
		}
		Assert.NotNull(full.ForbiddenDeck); // projection never mutates persistence state
		Assert.Equal("lighthouse", full.Forbidden.Turn.Target);
	}

	[Fact]
	public async Task Game_requires_two_equal_complete_human_teams()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var family = new ForbiddenFamily();
		var players = Players();

		Assert.Throws<InvalidOperationException>(() => family.CreateGame(new FamilyStartContext
		{
			Players = players, Definition = definition, Teams = new() { new() { "p0", "p1", "p2" }, new() { "p3" } },
		}));

		players[3] = players[3] with { IsBot = true };
		Assert.Throws<InvalidOperationException>(() => family.CreateGame(new FamilyStartContext
		{
			Players = players, Definition = definition, Teams = Teams(),
		}));
	}

	[Fact]
	public void Rulebook_rotates_roles_alternates_teams_and_starts_a_full_tie_breaker_cycle()
	{
		var deck = Enumerable.Range(0, 8).Select(index => new ForbiddenWordDef
		{
			Id = $"w{index}", Target = $"word {index}", Forbidden = new() { "a", "b", "c" },
		}).ToList();
		var rules = new ForbiddenRulesConfig { Cycles = 1 };
		var teams = Teams().Select(team => (IReadOnlyList<string>)team).ToList();
		var state = ForbiddenRulebook.CreateInitialState(teams, deck, rules);

		Assert.Equal((0, "p0", "p1", "p2"),
			(state.Turn.TeamIndex, state.Turn.ClueGiverId, state.Turn.GuesserId, state.Turn.MonitorId));
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		Assert.Equal((1, "p2", "p3", "p0"),
			(state.Turn.TeamIndex, state.Turn.ClueGiverId, state.Turn.GuesserId, state.Turn.MonitorId));
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		Assert.Equal((0, "p1", "p0", "p3"),
			(state.Turn.TeamIndex, state.Turn.ClueGiverId, state.Turn.GuesserId, state.Turn.MonitorId));
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		var tie = ForbiddenRulebook.CompleteTurn(state, deck, rules);

		Assert.False(tie.GameOver);
		Assert.True(tie.TieBreakerStarted);
		Assert.Equal(2, state.Cycle);
		Assert.Equal(0, state.ActiveTeamIndex);
	}

	[Fact]
	public void Rulebook_decides_the_winner_only_after_both_teams_received_equal_turns()
	{
		var deck = Enumerable.Range(0, 8).Select(index => new ForbiddenWordDef
		{
			Id = $"w{index}", Target = $"word {index}", Forbidden = new() { "a", "b", "c" },
		}).ToList();
		var rules = new ForbiddenRulesConfig();
		var teams = Teams().Select(team => (IReadOnlyList<string>)team).ToList();
		var state = ForbiddenRulebook.CreateInitialState(teams, deck, rules);
		state.Teams[0].Score = 2;

		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		var finish = ForbiddenRulebook.CompleteTurn(state, deck, rules);

		Assert.True(finish.GameOver);
		Assert.Equal(0, finish.WinnerTeamIndex);
	}
}
