using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Corro;

/// <summary>
/// Adapts a loaded .corro <see cref="GameDefinition"/> into the engine's runtime types: the
/// board squares, the game settings and the rent rules. Each package square's GENERIC
/// type/group/deck is mapped onto the game's <see cref="Square"/> (with a landing behaviour) so
/// the existing rulebook drives it unchanged — rent dispatches by type via the rules' strategies,
/// landing by behaviour. The package's rules config (<c>def.Manifest.Rules</c>) is used directly
/// as the game's <c>RentRules</c>.
/// </summary>
public static class GameDefinitionAdapter
{
	/// <summary>
	/// Maps a package square to the engine's generic landing behaviour. The special corners are engine
	/// concepts (keyed by type); everything else is "ownable" iff it carries a purchase price — so the
	/// engine privileges no property/transit/utility type: a board can name its ownable groups anything.
	/// </summary>
	private static string BehaviorFor(SquareDef sd) => sd.Type.ToLowerInvariant() switch
	{
		"tax" => "tax",
		"deck" => "drawCard",
		"holding" => "justVisiting",
		"freeparking" => "freeParking",
		"sendtoholding" => "sendToHolding",
		"start" => "start",
		_ => sd.Price.HasValue ? "ownable" : "start", // ownable by data (has a price), not by a fixed type
	};

	/// <summary>Projects the package board into game squares, resolving names for <paramref name="lang"/>.</summary>
	public static List<Square> ToSquares(GameDefinition def, string lang)
	{
		// Group id -> colour, for the visual colour band and the property classic check.
		var groupColor = def.Manifest.Groups
			.Where(g => g.Color != null)
			.ToDictionary(g => g.Id, g => g.Color!);

		// Group id -> i18n key for its name, so the client can announce the group ("Grupo: Marrón")
		// resolving it against the merged app + package translations. Only groups that name one.
		var groupNameKey = def.Manifest.Groups
			.Where(g => !string.IsNullOrEmpty(g.ColorName))
			.ToDictionary(g => g.Id, g => g.ColorName!);

		return def.Board.Select(sd =>
		{
			var (x, y) = BoardCoordinates.Calculate(sd.Id);
			return new Square
			{
				Id = sd.Id,
				X = x,
				Y = y,
				Type = sd.Type,
				Behavior = BehaviorFor(sd),
				Name = ResolveName(def, sd, lang),
				Names = BuildNames(def, sd),
				Color = sd.Group != null ? groupColor.GetValueOrDefault(sd.Group) : null,
				GroupNameKey = sd.Group != null ? groupNameKey.GetValueOrDefault(sd.Group) : null,
				Key = sd.Group, // the group id doubles as the grouping/shortcut key
				Deck = sd.Deck,
				Price = sd.Price,   // purchase price (ownable squares only)
				Amount = sd.Amount, // pay-on-landing sum (tax squares); kept distinct from Price
				Rent = sd.Rent?.ToList(),
				BuildingCost = sd.BuildCost,
			};
		}).ToList();
	}

	/// <summary>The square's name for <paramref name="lang"/>, resolved from the package i18n by its
	/// key (falling back to any locale that has it); for an unnamed corner, the board's terminology
	/// for its type (e.g. "holding" -> "Agujero Negro"). Empty when neither names it (generic fallback).</summary>
	private static string ResolveName(GameDefinition def, SquareDef sd, string lang)
	{
		var key = NameKeyFor(def, sd);
		if (string.IsNullOrEmpty(key))
		{
			return string.Empty;
		}

		if (def.I18n.TryGetValue(lang, out var langMap) && langMap.TryGetValue(key, out var text))
		{
			return text;
		}

		foreach (var map in def.I18n.Values)
		{
			if (map.TryGetValue(key, out var any))
			{
				return any; // partial translation: any locale beats nothing
			}
		}

		return string.Empty;
	}

	/// <summary>Per-locale names for a square (locale -> text), resolved from its i18n key. Null when
	/// the square has no key/translations.</summary>
	private static Dictionary<string, string>? BuildNames(GameDefinition def, SquareDef sd)
	{
		var key = NameKeyFor(def, sd);
		if (string.IsNullOrEmpty(key))
		{
			return null;
		}

		var names = new Dictionary<string, string>();
		foreach (var (lang, map) in def.I18n)
		{
			if (map.TryGetValue(key, out var text))
			{
				names[lang] = text;
			}
		}

		return names.Count > 0 ? names : null;
	}

	/// <summary>The i18n key naming a square: its own <c>nameKey</c>, or — for an unnamed corner — the
	/// board's terminology key for its type (e.g. a "holding" square -> "terminology.holding"), or — for an
	/// unnamed card square — its deck's name key (so a "deck" square reads "Anomalía Cuántica" instead of
	/// being blank, e.g. as a bus destination — bug #8). Null if none of these name it.</summary>
	private static string? NameKeyFor(GameDefinition def, SquareDef sd)
		=> !string.IsNullOrEmpty(sd.NameKey) ? sd.NameKey
		 : def.Manifest.Terminology.TryGetValue(sd.Type, out var termKey) ? termKey
		 : !string.IsNullOrEmpty(sd.Deck) ? def.Manifest.Decks.FirstOrDefault(dk => dk.Id == sd.Deck)?.NameKey
		 : null;

	/// <summary>Maps the package's rules config onto the game's smallBuilding-rule settings, then applies the
	/// declared smallBuilding-rule defaults (a package's customizable rules) on top via the catalog.</summary>
	public static GameSettings ToSettings(GameDefinition def)
	{
		var r = def.Manifest.Rules;
		var settings = new GameSettings
		{
			StartingMoney = r.StartingMoney,
			GoBonus = r.PassStartBonus,
			MortgageInterestRate = r.MortgageInterestRate,
			BuildingShortage = r.BuildingShortage,
			EvenBuildRule = r.EvenBuildRule,
			AuctionOnDecline = r.AuctionOnDecline,
			FreeParkingJackpot = r.FreeParkingJackpot,
			HoldingReleaseCost = r.Holding.ReleaseCost,
			MaxHoldingTurns = r.Holding.MaxTurns,
			BuildingLevels = def.Manifest.Building.Levels, // small constructions per big one
		};

		foreach (var rule in def.Manifest.HouseRules)
		{
			if (rule.Default is { } value)
			{
				settings = HouseRuleCatalog.Apply(settings, rule.Id, value);
			}
		}

		return settings;
	}

	/// <summary>
	/// The settings a game actually runs with: for a package game whose host picked house-rule values,
	/// those (RuleValues) applied over the package defaults; otherwise the settings on the document.
	/// Used at BOTH start and restore so a restart can't silently drop the host's choices — e.g. the
	/// auction bid timeout would otherwise revert to the package/form default on the next server start.
	/// </summary>
	public static GameSettings EffectiveSettings(GameDocument game, GameDefinition? definition)
	{
		if (definition is not null && game.RuleValues is { Count: > 0 } ruleValues)
		{
			var settings = ToSettings(definition);
			foreach (var (id, value) in ruleValues)
			{
				settings = HouseRuleCatalog.Apply(settings, id, value);
			}

			return settings;
		}
		return game.Settings;
	}
}
