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
	public async Task The_shipped_rules_and_the_defaults_the_lobby_offers_are_the_same_figures()
	{
		// One rule, two places to write its figure. The form always sends the host's value, so a
		// mismatch plays right and only reads wrong — until the values do not arrive at all and the
		// match falls back to the block below, the figure nobody kept up to date.
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var rules = definition.Manifest.ForbiddenRules!;
		var offered = definition.Manifest.HouseRules.ToDictionary(rule => rule.Id, rule => rule.Default);

		Assert.Equal(rules.EndMode, offered["forbiddenEndMode"]!.Value.GetString());
		Assert.Equal(rules.Cycles, offered["forbiddenCycles"]!.Value.GetInt32());
		Assert.Equal(rules.TargetScore, offered["forbiddenTargetScore"]!.Value.GetInt32());
		Assert.Equal(rules.Mode, offered["forbiddenMode"]!.Value.GetString());
	}

	// Asked for by a family of three: the shipped package could not seat them at all, because two
	// teams of two was the only seating the family knew. The host now chooses the seating, and the
	// package's range starts where the three roles of a turn do.
	[Fact]
	public async Task The_shipped_package_lets_the_host_seat_everyone_for_themselves_from_three_players()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));

		Assert.Equal(3, definition.Manifest.Players.Min);
		var seating = Assert.Single(definition.Manifest.HouseRules, rule => rule.Id == "forbiddenMode");
		Assert.Equal("choice", seating.Type);
		Assert.True(seating.EditableByHost);
		Assert.Equal(new[] { "teams", "solo" }, seating.Options!.Select(option => option.Id));
		Assert.Equal("teams", seating.Default!.Value.GetString()); // the classic stays the default
		new ForbiddenFamily().ValidateDefinition(definition); // an odd floor is a legal range now
	}

	[Fact]
	public async Task A_solo_default_seating_must_be_offered_as_a_house_rule_too()
	{
		// The lobby seats a table from the host's rule choices, so a manifest that defaults to
		// everyone for themselves without exposing the choice would have the lobby arranging teams
		// the match then refuses.
		var shipped = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var soloByDefault = shipped with
		{
			Manifest = shipped.Manifest with
			{
				ForbiddenRules = shipped.Manifest.ForbiddenRules! with { Mode = "solo" },
			},
		};
		new ForbiddenFamily().ValidateDefinition(soloByDefault); // the shipped package offers the choice

		var silent = soloByDefault with
		{
			Manifest = soloByDefault.Manifest with
			{
				HouseRules = soloByDefault.Manifest.HouseRules.Where(rule => rule.Id != "forbiddenMode").ToList(),
			},
		};
		var error = Assert.Throws<InvalidOperationException>(() => new ForbiddenFamily().ValidateDefinition(silent));
		Assert.Contains("forbiddenMode", error.Message);

		var nonsense = shipped with
		{
			Manifest = shipped.Manifest with { ForbiddenRules = shipped.Manifest.ForbiddenRules! with { Mode = "pairs" } },
		};
		Assert.Contains("forbiddenRules.mode", Assert.Throws<InvalidOperationException>(
			() => new ForbiddenFamily().ValidateDefinition(nonsense)).Message);
	}

	[Fact]
	public async Task An_odd_player_range_is_accepted_because_everyone_for_themselves_seats_it()
	{
		var shipped = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var definition = shipped with
		{
			Manifest = shipped.Manifest with { Players = new PlayersDef { Min = 3, Max = 9 } },
		};

		new ForbiddenFamily().ValidateDefinition(definition); // does not throw
	}

	private static Dictionary<string, System.Text.Json.JsonElement> Solo(params (string Id, object Value)[] more)
	{
		var values = new Dictionary<string, System.Text.Json.JsonElement>
		{
			["forbiddenMode"] = System.Text.Json.JsonSerializer.SerializeToElement("solo"),
		};
		foreach (var (id, value) in more)
		{
			values[id] = System.Text.Json.JsonSerializer.SerializeToElement(value);
		}
		return values;
	}

	[Fact]
	public async Task Three_players_play_for_themselves_with_the_three_roles_spread_across_them()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var game = new ForbiddenFamily().CreateGame(new FamilyStartContext
		{
			Players = Players(3), Definition = definition, Lang = "es", RuleValues = Solo(),
		});

		var state = game.State.Forbidden!;
		Assert.Equal("solo", game.State.ForbiddenRules!.Mode);
		// One side per player, in seat order: scores and turns are kept per person.
		Assert.Equal(new[] { "p0", "p1", "p2" }, state.Teams.Select(side => Assert.Single(side.MemberIds)));
		Assert.Equal(("p0", "p1", "p2"), (state.Turn.ClueGiverId, state.Turn.GuesserId, state.Turn.MonitorId));
		Assert.Equal("faro", state.Turn.Target);
		// Each player is their own side, so each gets their own colour rather than a team's.
		Assert.Equal(3, game.State.Players.Select(player => player.Color).Distinct().Count());
	}

	[Fact]
	public async Task Everyone_for_themselves_refuses_two_players_a_team_arrangement_and_bots()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var family = new ForbiddenFamily();

		Assert.Throws<InvalidOperationException>(() => family.CreateGame(new FamilyStartContext
		{
			Players = Players(2), Definition = definition, RuleValues = Solo(),
		}));
		// A team layout under the solo seating is a lobby that let the two settings disagree.
		Assert.Throws<InvalidOperationException>(() => family.CreateGame(new FamilyStartContext
		{
			Players = Players(), Definition = definition, RuleValues = Solo(), Teams = Teams(),
		}));
		var players = Players(3);
		players[2] = players[2] with { IsBot = true };
		Assert.Throws<InvalidOperationException>(() => family.CreateGame(new FamilyStartContext
		{
			Players = players, Definition = definition, RuleValues = Solo(),
		}));
	}

	private static List<IReadOnlyList<string>> Sides(int count)
		=> Enumerable.Range(0, count).Select(index => (IReadOnlyList<string>)new[] { $"p{index}" }).ToList();

	[Fact]
	public void Rulebook_hands_every_player_every_role_once_per_rotation_and_breaks_a_tie_with_a_whole_one()
	{
		var deck = Deck(12);
		var rules = new ForbiddenRulesConfig { Cycles = 1, Mode = "solo" };
		var state = ForbiddenRulebook.CreateInitialState(Sides(3), deck, rules);

		// Clue-giver, guesser, monitor: the active seat and the two after it.
		Assert.Equal((0, "p0", "p1", "p2"),
			(state.Turn.TeamIndex, state.Turn.ClueGiverId, state.Turn.GuesserId, state.Turn.MonitorId));
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		Assert.Equal((1, "p1", "p2", "p0"),
			(state.Turn.TeamIndex, state.Turn.ClueGiverId, state.Turn.GuesserId, state.Turn.MonitorId));
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		Assert.Equal((2, "p2", "p0", "p1"),
			(state.Turn.TeamIndex, state.Turn.ClueGiverId, state.Turn.GuesserId, state.Turn.MonitorId));

		// Three turns, nobody scored: the rotation is complete and level, so another whole one.
		var tie = ForbiddenRulebook.CompleteTurn(state, deck, rules);
		Assert.False(tie.GameOver);
		Assert.True(tie.TieBreakerStarted);
		Assert.Equal(2, state.Cycle);
		Assert.Equal((0, "p0", "p1", "p2"),
			(state.Turn.TeamIndex, state.Turn.ClueGiverId, state.Turn.GuesserId, state.Turn.MonitorId));

		// A lead shared by two of the three is still a tie at the top; a lone leader ends it.
		state.Teams[0].Score = 4;
		state.Teams[1].Score = 4;
		state.Teams[2].Score = 1;
		for (var turn = 0; turn < 2; turn++)
		{
			Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		}
		Assert.True(ForbiddenRulebook.CompleteTurn(state, deck, rules).TieBreakerStarted);
		state.Teams[1].Score = 5;
		for (var turn = 0; turn < 2; turn++)
		{
			Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		}
		var finish = ForbiddenRulebook.CompleteTurn(state, deck, rules);
		Assert.True(finish.GameOver);
		Assert.Equal(1, finish.WinnerTeamIndex);
	}

	[Fact]
	public void Five_players_for_themselves_rotate_the_three_roles_through_the_whole_table()
	{
		// The odd table the seating exists for: five people, three jobs a turn, and over one
		// rotation each of them has given, guessed and monitored exactly once.
		var deck = Deck(12);
		var rules = new ForbiddenRulesConfig { Cycles = 1, Mode = "solo" };
		var state = ForbiddenRulebook.CreateInitialState(Sides(5), deck, rules);
		var gave = new List<string>();
		var guessed = new List<string>();
		var monitored = new List<string>();

		for (var turn = 0; turn < 5; turn++)
		{
			gave.Add(state.Turn.ClueGiverId);
			guessed.Add(state.Turn.GuesserId);
			monitored.Add(state.Turn.MonitorId);
			Assert.Equal(3, new[] { state.Turn.ClueGiverId, state.Turn.GuesserId, state.Turn.MonitorId }.Distinct().Count());
			ForbiddenRulebook.CompleteTurn(state, deck, rules);
		}

		var everyone = Sides(5).Select(side => side[0]).OrderBy(id => id).ToList();
		Assert.Equal(everyone, gave.OrderBy(id => id));
		Assert.Equal(everyone, guessed.OrderBy(id => id));
		Assert.Equal(everyone, monitored.OrderBy(id => id));
	}

	[Fact]
	public void A_correct_guess_credits_the_guesser_too_only_when_everyone_plays_for_themselves()
	{
		var deck = Deck(8);
		var solo = new ForbiddenRulesConfig { Mode = "solo", CorrectPoints = 2 };
		var soloState = ForbiddenRulebook.CreateInitialState(Sides(3), deck, solo);

		var credited = ForbiddenRulebook.AwardCorrect(soloState, solo);

		// Guessing has to pay, or the only player with a reason to try is the one giving clues.
		Assert.Equal(new[] { "p0", "p1" }, credited.Select(side => side.MemberIds[0]));
		Assert.Equal(new[] { 2, 2, 0 }, soloState.Teams.Select(side => side.Score));
		Assert.Equal(1, soloState.Turn.CorrectCount);

		var teams = new ForbiddenRulesConfig { CorrectPoints = 2 };
		var teamState = ForbiddenRulebook.CreateInitialState(Teams().Select(team => (IReadOnlyList<string>)team).ToList(), deck, teams);
		Assert.Equal(new[] { 0 }, ForbiddenRulebook.AwardCorrect(teamState, teams).Select(side => side.TeamIndex));
		Assert.Equal(new[] { 2, 0 }, teamState.Teams.Select(team => team.Score));
	}

	[Fact]
	public void A_reported_slip_costs_the_clue_giver_alone_in_either_seating()
	{
		var deck = Deck(8);
		var solo = new ForbiddenRulesConfig { Mode = "solo", ViolationPenalty = 3 };
		var state = ForbiddenRulebook.CreateInitialState(Sides(3), deck, solo);

		var penalised = ForbiddenRulebook.PenaliseViolation(state, solo);

		Assert.Equal("p0", penalised.MemberIds[0]);
		Assert.Equal(new[] { -3, 0, 0 }, state.Teams.Select(side => side.Score));
		Assert.Equal(1, state.Turn.ViolationCount);
	}

	[Fact]
	public void A_target_score_decides_a_solo_match_only_with_level_turns_and_a_lone_leader()
	{
		var deck = Deck(12);
		var rules = new ForbiddenRulesConfig { Mode = "solo", EndMode = "score", TargetScore = 5, Cycles = 1 };
		var state = ForbiddenRulebook.CreateInitialState(Sides(3), deck, rules);

		state.Teams[0].Score = 5; // the opener is there…
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver); // …but two others are a turn behind
		Assert.False(ForbiddenRulebook.CompleteTurn(state, deck, rules).GameOver);
		var finish = ForbiddenRulebook.CompleteTurn(state, deck, rules);
		Assert.True(finish.GameOver);
		Assert.Equal(0, finish.WinnerTeamIndex);
	}

	[Fact]
	public async Task Everyone_for_themselves_ends_with_the_table_ranked_by_score()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var state = new ForbiddenFamily().CreateGame(new FamilyStartContext
		{
			Players = Players(4), Definition = definition, Lang = "en", RuleValues = Solo(),
		}).State;
		state.Forbidden!.Teams[0].Score = 2;
		state.Forbidden.Teams[1].Score = 7;
		state.Forbidden.Teams[2].Score = 2;
		state.Forbidden.Teams[3].Score = 0;

		ForbiddenFamily.FinishGame(state, winnerTeamIndex: 1);

		// A real ranking, ties sharing a place: not the "winners and everyone else" of team play.
		Assert.Equal(new[] { 2, 1, 2, 4 }, state.Players.Select(player => player.FinishPlace));
		Assert.Equal("p1", state.WinnerId);
		Assert.True(state.IsGameOver);
		Assert.All(state.Players, player => Assert.Equal(PlayerStatus.Finished, player.Status));
	}

	[Fact]
	public async Task A_player_leaving_a_solo_match_ends_it_with_the_best_remaining_score_on_top()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var family = new ForbiddenFamily();
		var state = family.CreateGame(new FamilyStartContext
		{
			Players = Players(3), Definition = definition, Lang = "en", RuleValues = Solo(),
		}).State;
		state.Forbidden!.Teams[0].Score = 9; // the leader is the one who leaves
		state.Forbidden.Teams[1].Score = 3;
		state.Forbidden.Teams[2].Score = 4;
		var context = TestFixtures.NewContext(state, forbiddenRules: state.ForbiddenRules);

		await family.OnPlayerRetiredAsync(state.Players[0], context);

		// The rotation cannot go on truthfully with two: the best of those who stayed wins, and
		// the one who left finishes last whatever their score said.
		Assert.True(state.IsGameOver);
		Assert.Equal("p2", state.WinnerId);
		Assert.Equal(new[] { 3, 2, 1 }, state.Players.Select(player => player.FinishPlace));
		var forfeit = Assert.Single(TestFixtures.Announcer(context).Sent, sent => sent.Key == "game.forbidden_forfeit_solo");
		Assert.Equal("p2", forfeit.Vars["winner"]);
		Assert.Equal(4, forfeit.Vars["score"]);
		// The shared game-over line names a person, not a colour.
		Assert.Equal("p2", Assert.Single(TestFixtures.Announcer(context).Sent, sent => sent.Key == "game.game_over").Vars["winner"]);
	}

	[Fact]
	public async Task The_host_chooses_how_the_match_ends_and_with_which_number()
	{
		// The path a real host takes, which the rulebook tests skip by building the rules by hand:
		// the lobby's RuleValues reaching ForbiddenRulesConfig through CreateGame. This family
		// refused house rules outright until the ending became the host's, so nothing else walks
		// it — and a break here would leave the suite green while every match quietly played the
		// package defaults.
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var byScore = new ForbiddenFamily().CreateGame(new FamilyStartContext
		{
			Players = Players(),
			Definition = definition,
			Lang = "en",
			Teams = Teams(),
			RuleValues = new Dictionary<string, System.Text.Json.JsonElement>
			{
				["forbiddenEndMode"] = System.Text.Json.JsonSerializer.SerializeToElement("score"),
				["forbiddenTargetScore"] = System.Text.Json.JsonSerializer.SerializeToElement(12),
				["forbiddenCycles"] = System.Text.Json.JsonSerializer.SerializeToElement(7),
			},
		});

		var chosen = byScore.State.ForbiddenRules!;
		Assert.Equal("score", chosen.EndMode);
		Assert.Equal(12, chosen.TargetScore);
		Assert.Equal(7, chosen.Cycles); // kept, simply not what ends this match
		// The effective rules travel with the game, so the running match plays what the table
		// agreed on rather than what the package ships.
		Assert.Equal(chosen, Assert.IsType<ForbiddenRuntime>(byScore.Runtime).Rules);

		// An ending the engine does not know leaves the family's own rotations standing.
		var nonsense = new ForbiddenFamily().CreateGame(new FamilyStartContext
		{
			Players = Players(),
			Definition = definition,
			Lang = "en",
			Teams = Teams(),
			RuleValues = new Dictionary<string, System.Text.Json.JsonElement>
			{
				["forbiddenEndMode"] = System.Text.Json.JsonSerializer.SerializeToElement("whenever"),
			},
		}).State.ForbiddenRules!;
		Assert.Equal("rounds", nonsense.EndMode);
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
	public async Task Projection_reveals_the_private_card_only_to_clue_giver_and_monitor_and_only_once_the_clock_runs()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var family = new ForbiddenFamily();
		var full = family.CreateGame(new FamilyStartContext
		{
			Players = Players(), Definition = definition, Lang = "en", Teams = Teams(),
		}).State;
		var turn = full.Forbidden!.Turn;
		Assert.Equal(ForbiddenTurnPhase.Preparing, turn.Phase);

		// Reported from play: the card was dealt with the turn, so the clue-giver could plan
		// clues for as long as they liked before starting the clock and the monitor could learn
		// the forbidden list by heart. Role alone never authorised the words — the turn has to
		// be running too, and it is the SERVER that withholds them, not the screen.
		foreach (var everyone in new[]
		{
			family.ProjectFor(full, turn.ClueGiverId),
			family.ProjectFor(full, turn.MonitorId),
			family.ProjectFor(full, turn.GuesserId),
			family.ProjectFor(full, "p3"),
			family.ProjectFor(full, null),
		})
		{
			Assert.Null(everyone.Forbidden!.Turn.Target);
			Assert.Null(everyone.Forbidden.Turn.CardId);
			Assert.Empty(everyone.Forbidden.Turn.ForbiddenWords);
			Assert.Null(everyone.ForbiddenDeck);
		}

		var running = full with
		{
			Forbidden = full.Forbidden with { Turn = turn with { Phase = ForbiddenTurnPhase.Active } },
		};
		var giver = family.ProjectFor(running, turn.ClueGiverId);
		var monitor = family.ProjectFor(running, turn.MonitorId);

		Assert.Equal("lighthouse", giver.Forbidden!.Turn.Target);
		Assert.Equal("lighthouse", monitor.Forbidden!.Turn.Target);
		Assert.NotEmpty(giver.Forbidden.Turn.ForbiddenWords);
		foreach (var hidden in new[]
		{
			family.ProjectFor(running, turn.GuesserId),
			family.ProjectFor(running, "p3"),
			family.ProjectFor(running, null),
		})
		{
			Assert.Null(hidden.Forbidden!.Turn.Target);
			Assert.Null(hidden.Forbidden.Turn.CardId);
			Assert.Empty(hidden.Forbidden.Turn.ForbiddenWords);
			Assert.Null(hidden.ForbiddenDeck);
		}

		// A finished turn takes the words back: the deck never becomes public by expiring.
		var over = full with
		{
			Forbidden = full.Forbidden with { Turn = turn with { Phase = ForbiddenTurnPhase.Finished } },
		};
		Assert.Null(family.ProjectFor(over, turn.ClueGiverId).Forbidden!.Turn.Target);

		Assert.NotNull(full.ForbiddenDeck); // projection never mutates persistence state
		Assert.Equal("lighthouse", full.Forbidden.Turn.Target);
	}

	// Reported by the maintainer: the shipped package sat eight, and raising it to ten was refused by
	// the family, not by the game. Nothing in the role rotation cares how big a team is, so the only
	// ceiling left is the engine's own table limit — and a token for every seat declared.
	[Fact]
	public async Task Shipped_package_seats_ten_players_with_a_token_for_each()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));

		Assert.Equal(10, definition.Manifest.Players.Max);
		Assert.True(definition.Manifest.Tokens.Count >= 10,
			$"the package offers only {definition.Manifest.Tokens.Count} tokens for ten seats.");
		Assert.Equal(definition.Manifest.Tokens.Count, definition.Manifest.Tokens.Select(token => token.Id).Distinct().Count());
		new ForbiddenFamily().ValidateDefinition(definition); // does not throw
	}

	[Fact]
	public async Task A_ten_player_table_starts_as_two_teams_of_five_and_rotates_every_seat()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var game = new ForbiddenFamily().CreateGame(new FamilyStartContext
		{
			Players = Players(10), Definition = definition, Lang = "en", Teams = Teams(5),
		});

		var state = game.State.Forbidden!;
		Assert.Equal(new[] { 5, 5 }, state.Teams.Select(team => team.MemberIds.Count));
		Assert.Equal("p0", state.Turn.ClueGiverId);
		Assert.Equal("p1", state.Turn.GuesserId);
		Assert.Equal("p5", state.Turn.MonitorId);
	}

	[Theory]
	[InlineData(4, 18)] // beyond the engine's table limit
	[InlineData(2, 4)] // below the three roles a turn needs, in either seating
	[InlineData(6, 4)] // inverted range
	public async Task Definition_rejects_a_range_the_engine_or_a_turn_cannot_seat(int min, int max)
	{
		var shipped = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var tokens = Enumerable.Range(0, 18).Select(index => new TokenDef { Id = $"t{index}" }).ToList();
		var definition = shipped with
		{
			Manifest = shipped.Manifest with { Players = new PlayersDef { Min = min, Max = max }, Tokens = tokens },
		};

		Assert.Throws<InvalidOperationException>(() => new ForbiddenFamily().ValidateDefinition(definition));
	}

	[Fact]
	public async Task Definition_rejects_more_seats_than_tokens()
	{
		var shipped = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var definition = shipped with
		{
			Manifest = shipped.Manifest with { Players = new PlayersDef { Min = 4, Max = 12 } },
		};

		var error = Assert.Throws<InvalidOperationException>(() => new ForbiddenFamily().ValidateDefinition(definition));
		Assert.Contains("cannot exceed the number of tokens", error.Message);
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

	private static List<ForbiddenWordDef> Deck(int count)
		=> Enumerable.Range(0, count)
			.Select(index => new ForbiddenWordDef
			{
				Id = $"w{index}",
				Target = $"target{index}",
				Forbidden = new List<string> { "a", "b", "c" },
			})
			.ToList();

	[Fact]
	public void A_table_is_dealt_what_it_has_never_seen_before_it_meets_a_repeat()
	{
		var deck = Deck(10);
		var seen = new[] { "w0", "w1", "w2" };

		var ordered = ForbiddenFamily.OrderDeck(deck, seen, random: null);

		// Same cards, none lost or duplicated — only the priority changes.
		Assert.Equal(deck.Select(word => word.Id).OrderBy(id => id), ordered.Select(word => word.Id).OrderBy(id => id));
		// The seven unseen ones come first; the three already dealt wait at the back.
		Assert.DoesNotContain(ordered.Take(7).Select(word => word.Id), id => seen.Contains(id));
		Assert.Equal(seen.OrderBy(id => id), ordered.Skip(7).Select(word => word.Id).OrderBy(id => id));
	}

	[Fact]
	public void A_table_that_has_seen_the_whole_deck_starts_a_clean_cycle()
	{
		var deck = Deck(5);

		var ordered = ForbiddenFamily.OrderDeck(deck, deck.Select(word => word.Id).ToList(), random: null);

		// Nothing unseen is left, so the deck is dealt again rather than the match starting empty.
		Assert.Equal(5, ordered.Count);
		Assert.Equal(deck.Select(word => word.Id).OrderBy(id => id), ordered.Select(word => word.Id).OrderBy(id => id));
	}

	[Fact]
	public void A_table_with_no_memory_is_dealt_the_whole_deck()
	{
		var deck = Deck(4);

		var ordered = ForbiddenFamily.OrderDeck(deck, Array.Empty<string>(), random: null);

		Assert.Equal(deck.Select(word => word.Id), ordered.Select(word => word.Id));
	}

	[Fact]
	public async Task A_match_reports_the_cards_it_dealt_not_the_deck_it_shuffled()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var family = new ForbiddenFamily();
		var state = family.CreateGame(new FamilyStartContext
		{
			Players = Players(), Definition = definition, Lang = "en", Teams = Teams(),
		}).State;

		// One card is dealt with the opening turn.
		Assert.Equal(new[] { state.ForbiddenDeck![0].Id }, family.CardsDealt(state).CardIds);

		ForbiddenRulebook.DealNextCard(state.Forbidden!, state.ForbiddenDeck!);
		ForbiddenRulebook.DealNextCard(state.Forbidden!, state.ForbiddenDeck!);
		Assert.Equal(state.ForbiddenDeck!.Take(3).Select(word => word.Id), family.CardsDealt(state).CardIds);
		// The rest of the deck was shuffled, not seen: remembering it would burn the whole deck
		// on a table's first evening.
		Assert.True(state.ForbiddenDeck!.Count > 3);

		// The deck's size travels with them, and it is the WHOLE deck: without it the table could
		// never tell that it had been round the lot and its memory should start a new trip.
		Assert.Equal(state.ForbiddenDeck!.Count, family.CardsDealt(state).DeckSize);
	}

	[Fact]
	public void A_match_that_dealt_nothing_reports_no_deal_at_all()
	{
		// Nothing to remember and nothing to measure against: a table whose match never got going
		// must not be told it has been round a deck of zero cards.
		var deal = new ForbiddenFamily().CardsDealt(new GameState { GameType = "forbidden" });
		Assert.Empty(deal.CardIds);
		Assert.Equal(0, deal.DeckSize);
	}

	[Fact]
	public async Task The_second_match_at_a_table_deals_words_the_first_one_did_not()
	{
		var definition = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("forbidden-words"));
		var family = new ForbiddenFamily();
		var random = new SystemRandomSource(seed: 7);

		var first = family.CreateGame(new FamilyStartContext
		{
			Players = Players(), Definition = definition, Lang = "es", Teams = Teams(), Random = random,
		}).State;
		// Play through twenty cards, roughly a short match.
		for (var card = 1; card < 20; card++)
		{
			ForbiddenRulebook.DealNextCard(first.Forbidden!, first.ForbiddenDeck!);
		}
		var dealtFirst = family.CardsDealt(first).CardIds;
		Assert.Equal(20, dealtFirst.Count);

		var second = family.CreateGame(new FamilyStartContext
		{
			Players = Players(), Definition = definition, Lang = "es", Teams = Teams(),
			Random = random, AlreadyDealt = dealtFirst.ToList(),
		}).State;
		for (var card = 1; card < 20; card++)
		{
			ForbiddenRulebook.DealNextCard(second.Forbidden!, second.ForbiddenDeck!);
		}

		// Reported from play: reshuffling the whole deck for every match made a group of four meet
		// words they had just had. With 556 cards and twenty a match, that was about even odds.
		Assert.Empty(family.CardsDealt(second).CardIds.Intersect(dealtFirst));
	}
}
