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
		Assert.Equal("lighthouse", definition.ForbiddenWords!["en"][0].Target);
		Assert.Equal("faro", definition.ForbiddenWords["es"][0].Target);
		Assert.Equal(60, definition.Manifest.ForbiddenRules!.TurnSeconds);

		// A party deck is judged by how long it takes to come round again: a turn burns through
		// several cards, and a table plays a whole evening. Five hundred is the floor, not a
		// milestone — the number is asserted so shrinking the deck has to be a decision.
		Assert.True(definition.ForbiddenWords["en"].Count >= 500,
			$"the English deck has only {definition.ForbiddenWords["en"].Count} cards.");

		// The two locales are ONE deck written twice. A card missing on one side means a table
		// that switches its shared word language silently loses words.
		var english = definition.ForbiddenWords["en"].Select(word => word.Id).ToList();
		var spanish = definition.ForbiddenWords["es"].Select(word => word.Id).ToList();
		Assert.Equal(english, spanish);
	}

	// The failure this guards against was reported from a real game: "submarino" banned "océano"
	// but not "mar", and "cascada" never banned "catarata", so the clue-giver's most natural word
	// was legal in one language and a violation in the other. A synonym gap cannot be detected
	// automatically, but the SHAPE of a thin card can: every card carries a full hand of traps.
	[Fact]
	public async Task Every_shipped_card_bans_a_full_hand_of_words_in_both_languages()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));

		foreach (var locale in new[] { "en", "es" })
		{
			foreach (var card in definition.ForbiddenWords![locale])
			{
				Assert.True(card.Forbidden.Count >= 5,
					$"card '{card.Id}' ({locale}) bans only {card.Forbidden.Count} words.");
				Assert.All(card.Forbidden, word => Assert.False(string.IsNullOrWhiteSpace(word)));
			}
		}
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

	[Fact]
	public void A_target_score_ends_the_match_only_once_both_teams_have_played_the_same_turns()
	{
		// The host's other ending. Stopping the instant a team crosses would hand the match to
		// whoever happens to play first, so the crossing waits for the turns to be level — the
		// same equal-opportunity rule that makes a tie add a WHOLE rotation.
		var deck = Enumerable.Range(0, 12).Select(index => new ForbiddenWordDef
		{
			Id = $"w{index}", Target = $"word {index}", Forbidden = new() { "a", "b", "c" },
		}).ToList();
		var rules = new ForbiddenRulesConfig { EndMode = "score", TargetScore = 3, Cycles = 1 };
		var teams = Teams().Select(team => (IReadOnlyList<string>)team).ToList();
		var state = ForbiddenRulebook.CreateInitialState(teams, deck, rules);

		state.Teams[0].Score = 3; // the opening team is already there…
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver); // …but is one turn up
		var finish = ForbiddenRulebook.CompleteTurn(state, deck, rules);
		Assert.True(finish.GameOver);
		Assert.Equal(0, finish.WinnerTeamIndex);
	}

	[Fact]
	public void A_target_score_match_ignores_the_rotation_count_and_plays_on_through_a_tie()
	{
		var deck = Enumerable.Range(0, 12).Select(index => new ForbiddenWordDef
		{
			Id = $"w{index}", Target = $"word {index}", Forbidden = new() { "a", "b", "c" },
		}).ToList();
		var rules = new ForbiddenRulesConfig { EndMode = "score", TargetScore = 5, Cycles = 1 };
		var teams = Teams().Select(team => (IReadOnlyList<string>)team).ToList();
		var state = ForbiddenRulebook.CreateInitialState(teams, deck, rules);

		// A complete rotation with nobody at the target decides nothing here: the rotation count
		// is what the OTHER ending uses.
		for (var turn = 0; turn < 4; turn++)
		{
			Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		}

		// Level ON the target is not a win either — there is no winner to name yet.
		state.Teams[0].Score = 5;
		state.Teams[1].Score = 5;
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);

		state.Teams[1].Score = 7;
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver); // turns uneven
		var finish = ForbiddenRulebook.CompleteTurn(state, deck, rules);
		Assert.True(finish.GameOver);
		Assert.Equal(1, finish.WinnerTeamIndex);
	}
}
