using System.Text.Json;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;

namespace CorroServer.Tests;

/// <summary>
/// Guards every shipped board against a regression where it references an i18n key that resolves in
/// NO locale — the bug class that leaks a raw key to the screen / the announcer (e.g. renaming
/// groups.utility but missing a usage, or a card pointing at a non-existent textKey). Partial
/// translations are fine (names fall back), so this only fails on a truly dangling key.
/// </summary>
public class KeyIntegrityTests
{
	public static IEnumerable<object[]> ShippedBoards()
	{
		   // Every board under server/Packages that ships with the engine (only galactic-empire is
		// committed; the private espana boards are gitignored, so they're included when present).
		var root = CorroTestPaths.PackagesRoot();
		foreach (var dir in Directory.GetDirectories(root))
		{
			if (File.Exists(Path.Combine(dir, "manifest.json")))
			{
				yield return new object[] { Path.GetFileName(dir) };
			}
		}
	}

	private static readonly IPackageValidator Validator = new PackageValidator();

	[Theory]
	[MemberData(nameof(ShippedBoards))]
	public async Task Shipped_board_references_no_dangling_i18n_key(string boardId)
	{
		var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir(boardId));

		Assert.Empty(Validator.Validate(def)); // no key that resolves in no locale
	}

	[Fact]
	public void A_package_declaring_no_game_family_is_rejected()
	{
		// The .corro format anticipates several game families (property, race…); every
		// package must say which one it targets so the engine never loads it into the
		// wrong rules — and the error tells the author what this version supports.
		var def = new GameDefinition
		{
			Manifest = new Manifest { Locales = new() { "es" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			I18n = new() { ["es"] = new() },
		};

		var problem = Assert.Single(Validator.Validate(def), p => p.Contains("gameType"));
		Assert.Contains("property", problem); // the message lists the supported families
	}

	[Fact]
	public void A_package_from_an_unknown_game_family_is_rejected()
	{
		// e.g. a future family uploaded to an engine version that doesn't implement it yet.
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "deckbuilder", Locales = new() { "es" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			I18n = new() { ["es"] = new() },
		};

		var problem = Assert.Single(Validator.Validate(def), p => p.Contains("gameType"));
		Assert.Contains("deckbuilder", problem);
		Assert.Contains("property", problem);
	}

	[Fact]
	public void The_property_family_is_accepted_case_insensitively()
	{
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "Property", Locales = new() { "es" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			I18n = new() { ["es"] = new() },
		};

		Assert.DoesNotContain(Validator.Validate(def), p => p.Contains("gameType"));
	}

	/// <summary>A definition carrying one host-editable rule, with everything else valid.</summary>
	private static GameDefinition WithHouseRule(HouseRuleDef rule, Dictionary<string, string>? labels = null)
		=> WithHouseRules(new() { rule }, labels);

	/// <summary>The same, for the checks that need a rule AND the choice it depends on.</summary>
	private static GameDefinition WithHouseRules(List<HouseRuleDef> rules, Dictionary<string, string>? labels = null)
		=> new()
		{
			Manifest = new Manifest
			{
				GameType = "shedding",
				Locales = new() { "es" },
				Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } },
				HouseRules = rules,
			},
			I18n = new() { ["es"] = labels ?? new() },
		};

	private static HouseRuleDef ScoringRule(string type, string[] options, string? @default = null)
		=> new()
		{
			Id = "sheddingScoring",
			Type = type,
			NameKey = "rules.scoring",
			Default = @default == null ? null : JsonSerializer.SerializeToElement(@default),
			Options = options.Select(o => new HouseRuleOption { Id = o, NameKey = $"rules.{o}" }).ToList(),
		};

	private static readonly Dictionary<string, string> ScoringLabels = new()
	{
		["rules.scoring"] = "Puntuación",
		["rules.collect"] = "Sumar",
		["rules.penalty"] = "Castigo",
		["rules.wobble"] = "Bamboleo",
	};

	[Fact]
	public void A_choice_rule_offering_a_value_the_engine_would_ignore_is_rejected()
	{
		// The applier keeps its default whenever the stored value is not one of its own, so an
		// invented option would be offered, chosen, saved — and then silently dropped.
		var def = WithHouseRule(ScoringRule("choice", new[] { "collect", "wobble" }), ScoringLabels);

		var problem = Assert.Single(Validator.Validate(def), p => p.Contains("sheddingScoring"));
		Assert.Contains("wobble", problem);
		Assert.Contains("collect, penalty", problem); // the message names what IS accepted
	}

	[Fact]
	public void A_choice_rule_that_defaults_outside_its_own_options_is_rejected()
	{
		var def = WithHouseRule(ScoringRule("choice", new[] { "collect" }, "penalty"), ScoringLabels);

		Assert.Contains(Validator.Validate(def), p => p.Contains("defaults to 'penalty'"));
	}

	[Fact]
	public void A_value_gated_rule_declared_as_a_toggle_is_rejected()
	{
		var def = WithHouseRule(ScoringRule("toggle", Array.Empty<string>()), ScoringLabels);

		Assert.Contains(Validator.Validate(def), p => p.Contains("must be declared as a choice"));
	}

	[Fact]
	public void A_coherent_choice_rule_passes_and_its_labels_must_resolve()
	{
		var ok = WithHouseRule(ScoringRule("choice", new[] { "collect", "penalty" }, "collect"), ScoringLabels);
		Assert.DoesNotContain(Validator.Validate(ok), p => p.Contains("sheddingScoring"));

		// Without labels the lobby would render the raw ids, so a dangling one is a problem.
		var unnamed = WithHouseRule(ScoringRule("choice", new[] { "collect", "penalty" }, "collect"));
		var problems = Validator.Validate(unnamed);
		Assert.Contains(problems, p => p.Contains("house rule 'sheddingScoring'") && p.Contains("rules.scoring"));
		Assert.Contains(problems, p => p.Contains("option 'penalty'"));
	}

	private static readonly Dictionary<string, string> EndingLabels = new()
	{
		["rules.endMode"] = "Final",
		["rules.score"] = "A una puntuación",
		["rules.rounds"] = "Por rondas",
		["rules.rounds_count"] = "Rondas",
	};

	/// <summary>The ending choice a conditional rule hangs off, exactly as a package declares it.</summary>
	private static HouseRuleDef EndModeRule()
		=> new()
		{
			Id = "sheddingEndMode",
			Type = "choice",
			NameKey = "rules.endMode",
			Default = JsonSerializer.SerializeToElement("score"),
			Options = new()
			{
				new HouseRuleOption { Id = "score", NameKey = "rules.score" },
				new HouseRuleOption { Id = "rounds", NameKey = "rules.rounds" },
			},
		};

	/// <summary>A number shown only under one branch: "rule" is the choice, "is" the option.</summary>
	private static HouseRuleDef RoundsShownWhen(string rule, string @is)
		=> new()
		{
			Id = "sheddingRounds",
			Type = "number",
			NameKey = "rules.rounds_count",
			Default = JsonSerializer.SerializeToElement(15),
			ShowWhen = new HouseRuleCondition { Rule = rule, Is = @is },
		};

	// A wrong showWhen fails SILENTLY: the lobby hides the rule for good, the host never sees it
	// and the package plays by a default nobody chose. Nothing at run time can tell that apart
	// from a rule the author meant to hide, so the three ways to get it wrong are caught here.

	[Fact]
	public void A_rule_shown_when_a_rule_the_package_never_declares_is_rejected()
	{
		var def = WithHouseRules(new() { EndModeRule(), RoundsShownWhen("sheddingScoring", "penalty") },
			EndingLabels);

		var problem = Assert.Single(Validator.Validate(def), p => p.Contains("shown when"));
		Assert.Contains("sheddingRounds", problem);
		Assert.Contains("declares no such rule", problem);
	}

	[Fact]
	public void A_rule_shown_when_a_toggle_is_rejected()
	{
		// A toggle has no options to name, so the condition could never be met.
		var toggle = new HouseRuleDef
		{
			Id = "sheddingLastCardCall",
			Type = "toggle",
			NameKey = "rules.endMode",
			Default = JsonSerializer.SerializeToElement(false),
		};
		var def = WithHouseRules(new() { toggle, RoundsShownWhen("sheddingLastCardCall", "rounds") },
			EndingLabels);

		var problem = Assert.Single(Validator.Validate(def), p => p.Contains("depends on"));
		Assert.Contains("sheddingRounds", problem);
		Assert.Contains("'toggle'", problem); // the message names what it actually is
	}

	[Fact]
	public void A_rule_shown_when_an_option_the_choice_does_not_offer_is_rejected()
	{
		var def = WithHouseRules(new() { EndModeRule(), RoundsShownWhen("sheddingEndMode", "roundz") },
			EndingLabels);

		var problem = Assert.Single(Validator.Validate(def), p => p.Contains("not one of its options"));
		Assert.Contains("'roundz'", problem);
		Assert.Contains("score, rounds", problem); // …and what it could have said
	}

	[Fact]
	public void A_coherent_condition_passes()
	{
		var def = WithHouseRules(new() { EndModeRule(), RoundsShownWhen("sheddingEndMode", "rounds") },
			EndingLabels);

		Assert.DoesNotContain(Validator.Validate(def), p => p.Contains("sheddingRounds"));
	}

	[Fact]
	public void A_dangling_key_is_caught()
	{
		// A board referencing a square name key that exists in no locale must be flagged.
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "property", Locales = new() { "es", "en" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			Board = new() { new SquareDef { Id = 1, Type = "property", Group = "g1", NameKey = "squares.does_not_exist" } },
			I18n = new() { ["es"] = new() { ["squares.1"] = "Algo" }, ["en"] = new() { ["squares.1"] = "Something" } },
		};

		var problems = Validator.Validate(def);
		Assert.Contains(problems, p => p.Contains("squares.does_not_exist"));
	}

	[Fact]
	public void A_bot_name_that_resolves_nowhere_is_caught()
	{
		// A board names its own bots (manifest botNames -> its own i18n), so the host is offered
		// opponents from THIS world rather than the engine's generic ones. A key that resolves in no
		// locale would put a raw key in the "roll me a name" hat — the one place the text is handed
		// to a person to accept as-is.
		var def = new GameDefinition
		{
			Manifest = new Manifest
			{
				GameType = "property",
				Locales = new() { "es", "en" },
				Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } },
				BotNames = new() { "bots.foreman", "bots.never_written" },
			},
			I18n = new()
			{
				["es"] = new() { ["bots.foreman"] = "Capataz Escombro" },
				["en"] = new() { ["bots.foreman"] = "Foreman Grit" },
			},
		};

		var problems = Validator.Validate(def);
		Assert.Contains(problems, p => p.Contains("bots.never_written") && p.Contains("bot name"));
		Assert.DoesNotContain(problems, p => p.Contains("bots.foreman"));
	}

	[Fact]
	public void An_ownable_square_with_no_name_is_rejected()
	{
		// A property/transit/utility (or tax) square must name itself — it has no generic fallback,
		// so a missing nameKey would leave it blank on the board, in trades and as a bus destination.
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "property", Locales = new() { "es", "en" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			Board = new() { new SquareDef { Id = 7, Type = "property", Group = "g1" } }, // no NameKey
			I18n = new() { ["es"] = new(), ["en"] = new() },
		};

		Assert.Contains(Validator.Validate(def), p => p.Contains("square 7") && p.Contains("no name"));
	}

	[Fact]
	public void A_corner_or_card_square_without_a_name_is_allowed()
	{
		// Corners derive their name from the board terminology and card squares from their deck, so
		// an unnamed start/deck square must NOT be flagged (they have fallbacks; ownable squares don't).
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "property", Locales = new() { "es" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			Board = new()
			{
				new SquareDef { Id = 0, Type = "start" },
				new SquareDef { Id = 2, Type = "deck", Deck = "fortune" },
			},
			I18n = new() { ["es"] = new() },
		};

		Assert.DoesNotContain(Validator.Validate(def), p => p.Contains("no name"));
	}

	[Fact]
	public void A_board_with_no_tokens_is_rejected()
	{
		// Every board must ship its own player pieces — the engine has no built-in token set.
		var def = new GameDefinition { Manifest = new Manifest { GameType = "property", Locales = new() { "es" } } };

		Assert.Contains(Validator.Validate(def), p => p.Contains("no tokens"));
	}

	[Fact]
	public void A_partially_translated_key_is_allowed_to_fall_back()
	{
		// Present in es only (en falls back at runtime) — must NOT be flagged.
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "property", Locales = new() { "es", "en" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			Board = new() { new SquareDef { Id = 1, Type = "property", Group = "g1", NameKey = "squares.1" } },
			I18n = new() { ["es"] = new() { ["squares.1"] = "Calle Mayor" }, ["en"] = new() },
		};

		Assert.Empty(Validator.Validate(def));
	}
}
