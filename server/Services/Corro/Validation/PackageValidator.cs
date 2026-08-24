using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;

namespace CorroServer.Services.Corro.Validation;

/// <summary>
/// The default <see cref="IPackageValidator"/>. Today it runs one content rule — every referenced
/// i18n key must resolve — but it's the single place new rules land (add a private Check* method and
/// call it from <see cref="Validate"/>, or split into injected rules once there is more than one).
/// </summary>
public sealed class PackageValidator : IPackageValidator
{
	/// <summary>
	/// Square types that must name themselves: their name is shown on the board, in trades and the
	/// manage dialog, and read as a bus destination — and, unlike corners (generic fallback word) and
	/// card squares (their deck's name), they have NO fallback, so a missing name leaves them blank.
	/// </summary>
	private static readonly HashSet<string> MustBeNamedTypes =
		new(StringComparer.OrdinalIgnoreCase) { "property", "transit", "utility", "tax" };

	public IReadOnlyList<string> Validate(GameDefinition definition)
	{
		var problems = new List<string>();
		CheckGameType(definition, problems);
		CheckTokens(definition, problems);
		CheckSquareNames(definition, problems);
		CheckHouseRules(definition, problems);
		CheckI18nReferences(definition, problems);
		return problems;
	}

	/// <summary>A host-editable CHOICE rule must offer the values the engine actually accepts:
	/// the appliers keep the default whenever the stored value is not one of theirs, so an option
	/// the engine never heard of would be rendered in the lobby, chosen by the host, written to
	/// the game document — and then quietly dropped, leaving a game that plays by a rule nobody
	/// picked. Nothing else in the pipeline compares the two sets.</summary>
	private static void CheckHouseRules(GameDefinition d, List<string> problems)
	{
		problems.AddRange(d.Manifest.HouseRules
			.Select(HouseRuleCatalog.ChoiceProblem)
			.Where(problem => problem != null)
			.Select(problem => problem!));
		CheckRuleConditions(d, problems);
	}

	/// <summary>A rule shown only under one branch of a choice must name a choice that EXISTS and an
	/// option it actually offers. Get either wrong and the lobby hides the rule for good: the host
	/// never sees it, never sets it, and the package silently plays by a default nobody chose —
	/// exactly the failure the choice-value check above exists to prevent.</summary>
	private static void CheckRuleConditions(GameDefinition d, List<string> problems)
	{
		var rules = d.Manifest.HouseRules;
		foreach (var rule in rules)
		{
			if (rule.ShowWhen is not { } condition)
			{
				continue;
			}
			var driver = rules.FirstOrDefault(other => other.Id == condition.Rule);
			if (driver is null)
			{
				problems.Add($"house rule '{rule.Id}' is shown when '{condition.Rule}' is chosen, "
					+ "but this package declares no such rule");
				continue;
			}
			if (driver.Type != "choice")
			{
				problems.Add($"house rule '{rule.Id}' depends on '{condition.Rule}', which is a "
					+ $"'{driver.Type}' and has no options to depend on");
				continue;
			}
			var options = (driver.Options ?? new List<HouseRuleOption>()).Select(option => option.Id).ToList();
			if (!options.Contains(condition.Is))
			{
				problems.Add($"house rule '{rule.Id}' is shown when '{condition.Rule}' is "
					+ $"'{condition.Is}', which is not one of its options ({string.Join(", ", options)})");
			}
		}
	}

	/// <summary>Every package must declare which game family it targets, and it must be one this
	/// engine version implements (the .corro format anticipates more — each family brings its
	/// own rulebook and board topology — so an unknown family is rejected with a clear message
	/// instead of being loaded into the wrong rules). The family list lives in the registry
	/// (<see cref="GameFamilies"/>), so a new family is supported here automatically.</summary>
	private static void CheckGameType(GameDefinition d, List<string> problems)
	{
		var gameType = d.Manifest.GameType;
		if (string.IsNullOrWhiteSpace(gameType))
		{
			problems.Add($"manifest declares no gameType (this engine version supports: {string.Join(", ", GameFamilies.SupportedTypes)})");
		}
		else if (!GameFamilies.IsSupported(gameType))
		{
			problems.Add($"gameType '{gameType}' is not supported by this engine version (supported: {string.Join(", ", GameFamilies.SupportedTypes)})");
		}
	}

	/// <summary>
	/// Every ownable/tax square must carry a name key. <see cref="CheckI18nReferences"/> then proves
	/// that key resolves in at least one locale, so together they guarantee the square is never blank.
	/// Corners and card squares are exempt: they derive their name from the board terminology / deck.
	/// </summary>
	private static void CheckSquareNames(GameDefinition d, List<string> problems)
	{
		foreach (var s in d.Board)
		{
			if (MustBeNamedTypes.Contains(s.Type) && string.IsNullOrWhiteSpace(s.NameKey))
			{
				problems.Add($"square {s.Id} (type '{s.Type}') has no name (add a nameKey)");
			}
		}
	}

	/// <summary>
	/// Every board must ship its own player pieces (the engine has no built-in set), and each token
	/// needs an icon — its assets/tokens/&lt;id&gt;.svg (or an inline svg), which the loader resolves into Svg.
	/// </summary>
	private static void CheckTokens(GameDefinition d, List<string> problems)
	{
		if (d.Manifest.Tokens.Count == 0)
		{
			problems.Add("package defines no tokens (a board must ship its own player pieces)");
			return;
		}
		foreach (var t in d.Manifest.Tokens)
		{
			if (string.IsNullOrEmpty(t.Svg))
			{
				problems.Add($"token '{t.Id}' has no icon (add assets/tokens/{t.Id}.svg)");
			}
		}
	}

	/// <summary>
	/// Every i18n KEY the manifest/board/cards reference (square names, group names, terminology,
	/// currency, building tiers, deck/token names, card text) must resolve in at least one declared
	/// locale, so a board never shows or speaks a raw key. Partial translations are allowed — a key
	/// present in some locales but not others falls back at runtime (e.g. locale-specific street names) — so
	/// this flags only a TRULY dangling key (referenced but defined in no locale, e.g. a rename).
	/// </summary>
	private static void CheckI18nReferences(GameDefinition d, List<string> problems)
	{
		var refs = new List<(string Key, string Where)>();
		void Add(string? key, string where) { if (!string.IsNullOrEmpty(key)) { refs.Add((key!, where)); } }

		foreach (var s in d.Board)
		{
			Add(s.NameKey, $"square {s.Id}");
		}

		foreach (var seat in d.RaceBoard?.Seats ?? new List<Models.Corro.RaceSeatDef>())
		{
			Add(seat.NameKey, $"seat '{seat.Id}'");
		}

		foreach (var g in d.Manifest.Groups)
		{
			Add(g.ColorName, $"group '{g.Id}'");
		}

		foreach (var deck in d.Manifest.Decks)
		{
			Add(deck.NameKey, $"deck '{deck.Id}'");
		}

		foreach (var tk in d.Manifest.Tokens)
		{
			Add(tk.NameKey, $"token '{tk.Id}'");
		}

		// A bot name that resolves nowhere would reach the host as a raw key in the "roll me a
		// name" hat — the one place the text is offered for them to accept as-is.
		for (var i = 0; i < d.Manifest.BotNames.Count; i++)
		{
			Add(d.Manifest.BotNames[i], $"bot name #{i + 1}");
		}

		foreach (var c in d.Cards)
		{
			Add(c.TextKey, $"card '{c.Id}'");
		}

		// Every card of every family needs a translatable name; the family word in the report comes
		// from the game type, so a new card family is covered without touching this sweep.
		var family = d.Manifest.GameType;
		foreach (var card in d.AllFamilyCards)
		{
			Add(card.NameKey, $"{family} card '{card.Id}'");
		}

		// A "played" line is the journey/assembly families' own second key per card.
		foreach (var jc in d.JourneyDeck ?? new List<Models.Corro.JourneyCardDef>())
		{
			Add(jc.PlayedKey, $"journey card '{jc.Id}' playedKey");
		}
		foreach (var ac in d.AssemblyDeck ?? new List<Models.Corro.AssemblyCardDef>())
		{
			Add(ac.PlayedKey, $"assembly card '{ac.Id}' playedKey");
		}
		// Wilds NAME the colour in force out loud: every deck colour needs a spoken name.
		foreach (var color in (d.SheddingDeck ?? new List<Models.Corro.SheddingCardDef>())
					 .Where(c => c.Color != null).Select(c => c.Color!).Distinct())
		{
			Add($"colors.{color}", $"shedding colour '{color}'");
		}

		foreach (var (term, key) in d.Manifest.Terminology)
		{
			Add(key, $"terminology '{term}'");
		}

		// The lobby falls back to the raw rule/option ID when a label is missing, so a dangling
		// key here reads as "sheddingScoringPenalty" in the host's rules panel.
		foreach (var g in d.Manifest.RuleGroups)
		{
			Add(g.NameKey, $"rule group '{g.Id}'");
		}

		foreach (var rule in d.Manifest.HouseRules)
		{
			Add(rule.NameKey, $"house rule '{rule.Id}'");
			foreach (var option in rule.Options ?? new List<HouseRuleOption>())
			{
				Add(option.NameKey, $"house rule '{rule.Id}' option '{option.Id}'");
			}
		}

		Add(d.Manifest.Currency.NameKey, "currency.name");
		Add(d.Manifest.Building.SmallKey, "building.small");
		Add(d.Manifest.Building.SmallPluralKey, "building.smallPlural");
		Add(d.Manifest.Building.BigKey, "building.big");

		bool ResolvesSomewhere(string key) => d.Manifest.Locales.Any(lang =>
			d.I18n.TryGetValue(lang, out var table) && table.TryGetValue(key, out var val) && !string.IsNullOrEmpty(val));

		problems.AddRange(refs
			// "game.*" is the engine's own namespace, resolved against the app locales merged at
			// runtime (e.g. a board reusing game.color_brown), not the package — skip it here.
			.Where(r => !r.Key.StartsWith("game.", StringComparison.Ordinal) && !ResolvesSomewhere(r.Key))
			.Select(r => $"{r.Where} → key '{r.Key}' resolves in no locale"));
	}
}
