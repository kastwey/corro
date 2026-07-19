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
		CheckI18nReferences(definition, problems);
		return problems;
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
	/// needs an icon — its tokens/&lt;id&gt;.svg (or an inline svg), which the loader resolves into Svg.
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
				problems.Add($"token '{t.Id}' has no icon (add tokens/{t.Id}.svg)");
			}
		}
	}

	/// <summary>
	/// Every i18n KEY the manifest/board/cards reference (square names, group names, terminology,
	/// currency, building tiers, deck/token names, card text) must resolve in at least one declared
	/// locale, so a board never shows or speaks a raw key. Partial translations are allowed — a key
	/// present in some locales but not others falls back at runtime (e.g. es-only street names) — so
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

		foreach (var c in d.Cards)
		{
			Add(c.TextKey, $"card '{c.Id}'");
		}

		foreach (var jc in d.JourneyDeck ?? new List<Models.Corro.JourneyCardDef>())
		{
			Add(jc.NameKey, $"journey card '{jc.Id}'");
			Add(jc.PlayedKey, $"journey card '{jc.Id}' playedKey");
		}
		foreach (var dc in d.DraftDeck ?? new List<Models.Corro.DraftCardDef>())
		{
			Add(dc.NameKey, $"draft card '{dc.Id}'");
		}

		foreach (var sc in d.SheddingDeck ?? new List<Models.Corro.SheddingCardDef>())
		{
			Add(sc.NameKey, $"shedding card '{sc.Id}'");
		}

		foreach (var ec in d.ExplodingDeck ?? new List<Models.Corro.ExplodingCardDef>())
		{
			Add(ec.NameKey, $"exploding card '{ec.Id}'");
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
