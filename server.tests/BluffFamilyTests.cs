using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Corro.Validation;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

public class BluffFamilyTests
{
	private static Task<GameDefinition> LoadPackage()
		=> new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("tall-tales"));

	private static List<Player> Seats(int players)
		=> Enumerable.Range(0, players).Select(index => TestFixtures.NewPlayer($"p{index}", token: "seat")).ToList();

	private static async Task<FamilyGame> StartGame(int players = 3, string? hostId = "p0")
	{
		var definition = await LoadPackage();
		return new BluffFamily().CreateGame(new FamilyStartContext
		{
			Players = Seats(players),
			Definition = definition,
			Lang = "en",
			HostId = hostId,
		});
	}

	[Fact]
	public async Task The_shipped_package_loads_a_deck_per_locale_offers_both_languages_and_needs_no_pieces()
	{
		var definition = await LoadPackage();
		var family = new BluffFamily();

		Assert.Equal(new[] { "en", "es" }, family.ContentLanguages(definition));
		Assert.True(definition.BluffQuestions!["en"].Count >= 30);
		Assert.True(definition.BluffQuestions["es"].Count >= 30);
		Assert.Empty(definition.Manifest.Tokens);
		Assert.False(family.UsesTokens);
		Assert.True(family.OpenSeating);
		Assert.Equal(500, family.SeatLimit);
		family.ValidateDefinition(definition);
		Assert.Empty(new PackageValidator().Validate(definition));
	}

	[Fact]
	public async Task The_package_summary_tells_the_lobby_there_are_no_pieces_and_no_seat_count()
	{
		var summary = PackageSummaries.For("tall-tales", await LoadPackage());

		Assert.False(summary.UsesTokens);
		Assert.True(summary.OpenSeating);
		Assert.Equal(500, summary.MaxPlayers);
		Assert.Equal(3, summary.MinPlayers);
		Assert.Equal(new[] { "en", "es" }, summary.ContentLanguages);
	}

	[Theory]
	[InlineData(2)]
	[InlineData(501)]
	public async Task A_table_outside_the_family_bounds_cannot_start(int players)
	{
		var definition = await LoadPackage();

		Assert.Throws<InvalidOperationException>(() => new BluffFamily().CreateGame(new FamilyStartContext
		{
			Players = Seats(players),
			Definition = definition,
			Lang = "en",
		}));
	}

	[Fact]
	public async Task Bots_cannot_be_seated_because_nobody_can_bluff_for_them()
	{
		var definition = await LoadPackage();
		var seats = Seats(2);
		seats.Add(new Player { Id = "bot", Name = "Bot", Token = "seat", IsBot = true });

		Assert.Throws<InvalidOperationException>(() => new BluffFamily().CreateGame(new FamilyStartContext
		{
			Players = seats,
			Definition = definition,
			Lang = "en",
		}));
	}

	[Fact]
	public async Task The_host_runs_the_table_and_the_first_seat_does_when_no_host_is_named()
	{
		Assert.Equal("p1", (await StartGame(hostId: "p1")).State.Bluff!.MasterId);
		Assert.Equal("p0", (await StartGame(hostId: null)).State.Bluff!.MasterId);
		Assert.Equal("p0", (await StartGame(hostId: "stranger")).State.Bluff!.MasterId);
	}

	[Fact]
	public async Task The_host_house_rules_override_the_package_defaults_and_are_kept_on_the_state()
	{
		var definition = await LoadPackage();
		var values = new Dictionary<string, System.Text.Json.JsonElement>
		{
			["bluffRounds"] = System.Text.Json.JsonSerializer.SerializeToElement(3),
			["bluffWriteSeconds"] = System.Text.Json.JsonSerializer.SerializeToElement(60),
		};

		var game = new BluffFamily().CreateGame(new FamilyStartContext
		{
			Players = Seats(3),
			Definition = definition,
			Lang = "es",
			RuleValues = values,
		});

		Assert.Equal(3, game.State.BluffRules!.Rounds);
		Assert.Equal(60, game.State.BluffRules.WriteSeconds);
		Assert.Equal(3, game.State.Bluff!.RoundsToPlay);
		Assert.Equal(3, ((BluffRuntime)new BluffFamily().RuntimeFromState(game.State)!).Rules.Rounds);
		// Spanish content for the whole table.
		Assert.Contains(game.State.Bluff.Round.Question, definition.BluffQuestions!["es"].Select(question => question.Question));
	}

	[Fact]
	public async Task A_content_language_the_deck_lacks_is_refused()
	{
		var definition = await LoadPackage();

		Assert.Throws<InvalidOperationException>(() => new BluffFamily().CreateGame(new FamilyStartContext
		{
			Players = Seats(3),
			Definition = definition,
			Lang = "fr",
		}));
	}

	[Fact]
	public void Rules_outside_the_family_bounds_are_refused()
	{
		Assert.Throws<InvalidOperationException>(() => BluffFamily.ValidateRules(new BluffRulesConfig { WriteSeconds = 5 }));
		Assert.Throws<InvalidOperationException>(() => BluffFamily.ValidateRules(new BluffRulesConfig { VoteSeconds = 500 }));
		Assert.Throws<InvalidOperationException>(() => BluffFamily.ValidateRules(new BluffRulesConfig { Rounds = 0 }));
		Assert.Throws<InvalidOperationException>(() => BluffFamily.ValidateRules(new BluffRulesConfig { BallotSize = 2 }));
		Assert.Throws<InvalidOperationException>(() => BluffFamily.ValidateRules(new BluffRulesConfig { Finalists = 9 }));
		BluffFamily.ValidateRules(new BluffRulesConfig());
	}

	[Fact]
	public async Task A_deck_with_a_blank_truth_or_a_duplicate_id_is_refused()
	{
		var definition = await LoadPackage();
		var broken = definition with
		{
			BluffQuestions = new Dictionary<string, List<BluffQuestionDef>>
			{
				["en"] = definition.BluffQuestions!["en"].Select(question => question with { Truth = " " }).ToList(),
				["es"] = definition.BluffQuestions["es"],
			},
		};
		Assert.Throws<InvalidOperationException>(() => new BluffFamily().ValidateDefinition(broken));

		var duplicate = definition with
		{
			BluffQuestions = new Dictionary<string, List<BluffQuestionDef>>
			{
				["en"] = definition.BluffQuestions["en"].Select(question => question with { Id = "same" }).ToList(),
				["es"] = definition.BluffQuestions["es"],
			},
		};
		Assert.Throws<InvalidOperationException>(() => new BluffFamily().ValidateDefinition(duplicate));
	}

	[Fact]
	public async Task A_house_rule_the_family_does_not_implement_is_refused()
	{
		var definition = await LoadPackage();
		var foreign = definition with
		{
			Manifest = definition.Manifest with
			{
				HouseRules = new List<HouseRuleDef> { new() { Id = "forbiddenCycles", Type = "number", NameKey = "rules.x" } },
			},
		};

		Assert.Throws<InvalidOperationException>(() => new BluffFamily().ValidateDefinition(foreign));
	}

	[Fact]
	public async Task While_writing_a_bluff_reaches_its_writer_alone_and_the_truth_and_the_deck_reach_nobody()
	{
		var game = await StartGame(3);
		var state = game.State;
		var rules = state.BluffRules!;
		BluffRulebook.StartWriting(state.Bluff!.Round, rules, DateTime.UtcNow);
		BluffRulebook.Write(state.Bluff.Round, "p1", "my tall tale");
		var family = new BluffFamily();

		var mine = family.ProjectFor(state, "p1");
		var rival = family.ProjectFor(state, "p2");
		var viewer = family.ProjectFor(state, null);

		Assert.Null(mine.BluffDeck);
		Assert.Equal("my tall tale", mine.Bluff!.Round.Entries[1].Text);
		Assert.Equal(string.Empty, rival.Bluff!.Round.Entries[1].Text);
		Assert.Equal(string.Empty, viewer.Bluff!.Round.Entries[1].Text);
		Assert.Equal(string.Empty, mine.Bluff.Round.Truth);
		Assert.Empty(mine.Bluff.Round.TruthVariants);
		Assert.Equal(3, mine.Bluff.Round.PendingCount);
		// The authoritative state is untouched by projecting it.
		Assert.NotEqual(string.Empty, state.Bluff.Round.Truth);
		Assert.NotNull(state.BluffDeck);
	}

	[Fact]
	public async Task While_voting_each_player_gets_their_own_blind_ballot_and_nothing_of_the_others()
	{
		var game = await StartGame(4);
		var state = game.State;
		var rules = state.BluffRules!;
		var round = state.Bluff!.Round;
		BluffRulebook.StartWriting(round, rules, DateTime.UtcNow);
		foreach (var (index, text) in new[] { "A", "B", "C", "D" }.Select((text, index) => (index, text)))
		{
			BluffRulebook.Write(round, $"p{index}", text);
		}
		BluffRulebook.CloseWriting(round, rules, null, DateTime.UtcNow);
		BluffRulebook.Vote(round, "p1", false, 0, null);
		var family = new BluffFamily();

		var mine = family.ProjectFor(state, "p1").Bluff!.Round;
		var rival = family.ProjectFor(state, "p2").Bluff!.Round;
		var viewer = family.ProjectFor(state, null).Bluff!.Round;

		var ballot = Assert.Single(mine.Ballots);
		Assert.Equal("p1", ballot.PlayerId);
		Assert.Equal(0, ballot.TruthPick);
		Assert.All(ballot.Options, option => Assert.Equal(string.Empty, option.Key));
		Assert.Equal(4, ballot.Options.Count);
		Assert.Empty(mine.Lies);
		Assert.Equal(string.Empty, mine.Truth);
		Assert.DoesNotContain(rival.Ballots, candidate => candidate.PlayerId == "p1");
		Assert.Empty(viewer.Ballots);
		Assert.Equal(4, mine.PendingCount);
		// The server's own ballots keep their keys: projection never rewrites the authority.
		Assert.Contains(round.Ballots[1].Options, option => option.Key == BluffBallotState.TruthKey);
	}

	[Fact]
	public async Task At_the_reveal_the_bluffs_their_authors_and_the_truth_are_public_but_a_ballot_stays_its_owners()
	{
		var game = await StartGame(3);
		var state = game.State;
		var rules = state.BluffRules!;
		var round = state.Bluff!.Round;
		BluffRulebook.StartWriting(round, rules, DateTime.UtcNow);
		BluffRulebook.Write(round, "p0", "A");
		BluffRulebook.Write(round, "p1", "B");
		BluffRulebook.CloseWriting(round, rules, null, DateTime.UtcNow);
		BluffRulebook.CloseVoting(round, rules, null, DateTime.UtcNow);
		BluffRulebook.Score(state.Bluff, round, rules);
		var family = new BluffFamily();

		var rival = family.ProjectFor(state, "p2").Bluff!.Round;
		var viewer = family.ProjectFor(state, null).Bluff!.Round;

		Assert.Equal(round.Truth, rival.Truth);
		Assert.Equal(2, rival.Lies.Count);
		Assert.Equal(new[] { "p0" }, rival.Lies[0].AuthorIds);
		Assert.NotNull(rival.Reveal);
		Assert.Equal(round.Truth, viewer.Truth);
		Assert.Empty(viewer.Ballots);
		Assert.Single(rival.Ballots);
	}

	[Fact]
	public async Task The_clock_is_armed_for_every_timed_phase_and_for_nothing_else()
	{
		var game = await StartGame();
		var state = game.State;
		var family = new BluffFamily();
		var round = state.Bluff!.Round;

		Assert.Null(family.RoundClock(state));
		Assert.Null(family.ExpireRoundCommand(state));

		BluffRulebook.StartWriting(round, state.BluffRules!, DateTime.UtcNow);
		Assert.Equal(state.BluffRules!.WriteSeconds, family.RoundClock(state)!.Value.DurationSeconds);
		var expire = Assert.IsType<BluffExpirePhaseCommand>(family.ExpireRoundCommand(state));
		Assert.Equal("p0", expire.PlayerId);

		BluffRulebook.CloseWriting(round, state.BluffRules, null, DateTime.UtcNow);
		Assert.Equal(state.BluffRules.VoteSeconds, family.RoundClock(state)!.Value.DurationSeconds);

		round.Phase = BluffPhase.Reveal;
		Assert.Null(family.RoundClock(state));
	}

	[Fact]
	public async Task A_departing_master_hands_the_table_on_and_a_departure_can_close_the_phase()
	{
		var game = await StartGame(4);
		var state = game.State;
		var context = TestFixtures.NewContext(state, bluffRules: state.BluffRules);
		var announcer = (TestFixtures.FakeAnnouncer)context.Announcer;
		var round = state.Bluff!.Round;
		BluffRulebook.StartWriting(round, state.BluffRules!, DateTime.UtcNow);
		BluffRulebook.Write(round, "p1", "B");
		BluffRulebook.FinishWriting(round, "p1");
		BluffRulebook.Write(round, "p2", "C");
		BluffRulebook.FinishWriting(round, "p2");
		BluffRulebook.Write(round, "p3", "D");
		BluffRulebook.FinishWriting(round, "p3");

		var leaver = state.Players.First(player => player.Id == "p0");
		leaver.IsBankrupt = true;
		await new BluffFamily().OnPlayerRetiredAsync(leaver, context);

		Assert.Equal("p1", state.Bluff.MasterId);
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "p1", "game.bluff_master_left"));
		Assert.True(announcer.Has(AnnouncementAudience.Player, "p1", "game.bluff_master_left_self"));
		Assert.DoesNotContain(state.Bluff.Players, player => player.PlayerId == "p0");
		Assert.DoesNotContain(round.Entries, entry => entry.PlayerId == "p0");
		// p0 was the only one still writing: the vote opens without them.
		Assert.Equal(BluffPhase.Voting, round.Phase);
		Assert.Equal(3, round.Ballots.Count);
	}

	[Fact]
	public async Task Below_three_players_the_match_ends_and_the_leader_takes_it()
	{
		var game = await StartGame(3);
		var state = game.State;
		var context = TestFixtures.NewContext(state, bluffRules: state.BluffRules);
		var announcer = (TestFixtures.FakeAnnouncer)context.Announcer;
		state.Bluff!.Players[2].Score = 500;

		var leaver = state.Players.First(player => player.Id == "p1");
		leaver.IsBankrupt = true;
		await new BluffFamily().OnPlayerRetiredAsync(leaver, context);

		Assert.True(state.IsGameOver);
		Assert.Equal("p2", state.WinnerId);
		Assert.True(announcer.Has(AnnouncementAudience.All, null, "game.bluff_abandoned"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "p2", "game.game_over"));
	}

	[Fact]
	public async Task The_table_remembers_the_questions_it_was_asked_and_deals_the_unseen_ones_first()
	{
		var game = await StartGame();
		var family = new BluffFamily();
		var deck = game.State.BluffDeck!;

		var dealt = family.CardsDealt(game.State);
		Assert.Equal(new[] { deck[0].Id }, dealt.CardIds);
		Assert.Equal(deck.Count, dealt.DeckSize);

		var seen = deck.Take(deck.Count - 1).Select(question => question.Id).ToList();
		var ordered = BluffFamily.OrderDeck(deck, seen, new ScriptedRandomSource());
		Assert.Equal(deck[^1].Id, ordered[0].Id);
		Assert.Equal(deck.Count, ordered.Count);
	}

	[Fact]
	public void The_lobby_accepts_a_hall_only_for_a_family_that_seats_one()
	{
		Assert.False(LobbyInput.IsPlayerCount(200));
		Assert.True(LobbyInput.IsPlayerCount(200, seatLimit: 500));
		Assert.False(LobbyInput.IsPlayerCount(501, seatLimit: 500));
		// A family cannot shrink the engine's ordinary ceiling by answering less.
		Assert.True(LobbyInput.IsPlayerCount(16, seatLimit: 4));
		Assert.False(LobbyInput.IsPlayerCount(1, seatLimit: 500));
	}
}
