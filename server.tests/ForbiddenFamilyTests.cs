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
