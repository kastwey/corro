using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CorroServer.Models.Corro;

// Typed model of a .corro package (manifest + board + cards). This is the engine's
// content-agnostic game definition: everything the classic gamepecific lives in the package, not here.
// Loaded and validated by CorroServer.Services.Corro.CorroPackageLoader.

/// <summary>A localized string: locale code (e.g. "es"/"en") -> text.</summary>
public sealed class LocalizedText : Dictionary<string, string>
{
	/// <summary>Text for <paramref name="lang"/>, falling back to the given default, then any value.</summary>
	public string Get(string lang, string? fallback = null)
		=> TryGetValue(lang, out var v) ? v : (fallback ?? Values.FirstOrDefault() ?? string.Empty);
}

public sealed record Currency
{
	public string Symbol { get; init; } = string.Empty;
	public string Code { get; init; } = string.Empty;
	/// <summary>i18n key for the spoken currency name (e.g. "currency.name" -> "créditos"), resolved
	/// against the package's own translations. Symbol/code aren't translatable, so they stay inline.</summary>
	public string? NameKey { get; init; }
}

public sealed record GroupDef
{
	public string Id { get; init; } = string.Empty;
	public string? Color { get; init; }
	/// <summary>i18n key for the group's display name (e.g. "game.color_brown" or "groups.g1"),
	/// resolved against the merged app + package translations. Falls back to literal if no key.</summary>
	public string? ColorName { get; init; }
	public string? Icon { get; init; }
	/// <summary>Optional single-character board shortcut to jump to this group's squares (Shift+key
	/// goes backwards). Package-defined because colours are package-specific; validated to be unique
	/// across groups and not to clash with a key the engine reserves (e.g. "c" = cash).</summary>
	public string? Key { get; init; }
}

public sealed record DeckDef
{
	public string Id { get; init; } = string.Empty;
	/// <summary>i18n key for the deck's display name (e.g. "game.card_deck_chance", "decks.fortune"),
	/// resolved client-side against the merged app + package translations.</summary>
	public string? NameKey { get; init; }
	public string? Icon { get; init; }
}

public sealed record HoldingRules
{
	public int ReleaseCost { get; init; }
	public int MaxTurns { get; init; }
	/// <summary>
	/// How a player reaches holding (third double / "go to holding" square / card). Default false = teleport:
	/// the token is placed straight in holding and the line is announced at once. true = walk: the token
	/// animates across the board to holding and the line is paced to that hop. A board opts into the walk.
	/// </summary>
	public bool Walk { get; init; }
}

public sealed record UtilityMultiplier
{
	public int Single { get; init; }
	public int All { get; init; }
}

public sealed record RulesConfig
{
	public int StartingMoney { get; init; } = 1500;
	public int PassStartBonus { get; init; } = 200;
	/// <summary>Square type -> rent strategy id (e.g. "property" -> "buildingTable").</summary>
	public Dictionary<string, string> RentStrategies { get; init; } = new();
	public int[] TransitRent { get; init; } = Array.Empty<int>();
	public UtilityMultiplier UtilityMultiplier { get; init; } = new();
	public HoldingRules Holding { get; init; } = new();
	public int MortgageInterestRate { get; init; } = 10;
	public bool BuildingShortage { get; init; }
	public bool EvenBuildRule { get; init; }
	public bool AuctionOnDecline { get; init; }
	public bool FreeParkingJackpot { get; init; }

	/// <summary>
	/// The classic board's rent rules — the engine's built-in default, used until a
	/// loaded .corro package supplies its own (property = building table, railroad = scale with
	/// how many you own, utility = dice × {single 4, all 10}).
	/// </summary>
	public static RulesConfig ClassicRules => new()
	{
		RentStrategies = new() { ["property"] = "buildingTable", ["railroad"] = "ownedCountScale", ["utility"] = "diceMultiplier" },
		TransitRent = new[] { 25, 50, 100, 200 },
		UtilityMultiplier = new() { Single = 4, All = 10 },
	};
}

public sealed record Manifest
{
	public string Format { get; init; } = string.Empty;
	/// <summary>
	/// The GAME FAMILY this package targets. The .corro format is designed to carry more than
	/// one kind of board game; each family has its own rulebook, board topology and family-specific
	/// manifest sections. This engine version implements the "property" family (roll-and-move
	/// property trading); a package declaring an unknown family is rejected at upload with a clear
	/// message instead of misbehaving.
	/// </summary>
	public string GameType { get; init; } = string.Empty;
	public string EngineVersion { get; init; } = string.Empty;
	public string Id { get; init; } = string.Empty;
	public LocalizedText Name { get; init; } = new();
	public string? Author { get; init; }
	public string? Version { get; init; }
	public List<string> Locales { get; init; } = new();
	public Currency Currency { get; init; } = new();
	public string? CenterBrand { get; init; }
	/// <summary>i18n keys for the special corner spaces ("start"/"holding"/"freeparking"/"sendtoholding" ->
	/// e.g. "terminology.holding"), resolved against the package's own translations.</summary>
	public Dictionary<string, string> Terminology { get; init; } = new();
	public List<GroupDef> Groups { get; init; } = new();
	public List<DeckDef> Decks { get; init; } = new();
	public RulesConfig Rules { get; init; } = new();
	/// <summary>Optional groups for the host-customizable rules panel (id + i18n name key).</summary>
	public List<RuleGroupDef> RuleGroups { get; init; } = new();
	/// <summary>Rules of the "race" family (manifest "raceRules"). Null for other families.</summary>
	public RaceRulesConfig? RaceRules { get; init; }
	/// <summary>Rules of the "track" family (manifest "trackRules"). Null for other families.</summary>
	public TrackRulesConfig? TrackRules { get; init; }
	/// <summary>Rules of the "journey" family (manifest "journeyRules"). Null for other families.</summary>
	public JourneyRulesConfig? JourneyRules { get; init; }
	/// <summary>Rules of the "assembly" family (manifest "assemblyRules"). Null for other families.</summary>
	public AssemblyRulesConfig? AssemblyRules { get; init; }
	/// <summary>Rules of the "draft" family (manifest "draftRules"). Null for other families.</summary>
	public DraftRulesConfig? DraftRules { get; init; }
	/// <summary>Rules of the "shedding" family (manifest "sheddingRules"). Null for other families.</summary>
	public SheddingRulesConfig? SheddingRules { get; init; }
	/// <summary>Rules of the "exploding" family (manifest "explodingRules"). Null for other families.</summary>
	public ExplodingRulesConfig? ExplodingRules { get; init; }
	/// <summary>Rules of the "trivia" family (manifest "triviaRules"). Null for other families.</summary>
	public TriviaRulesConfig? TriviaRules { get; init; }
	/// <summary>The host-customizable rules this board exposes (each a generic catalog code with its
	/// default, type, bounds, group and i18n name key). The lobby renders the editable ones.</summary>
	public List<HouseRuleDef> HouseRules { get; init; } = new();
	/// <summary>The player tokens the package provides (id + inline SVG + i18n name key); empty means
	/// the built-in token set is used.</summary>
	public List<TokenDef> Tokens { get; init; } = new();
	/// <summary>How many players this board supports; absent means the engine default (2..8).</summary>
	public PlayersDef Players { get; init; } = new();
	/// <summary>How the board's buildings work (how many small make a big, and their names).</summary>
	public BuildingDef Building { get; init; } = new();
	/// <summary>
	/// Optional UNLOCK CODE for a hidden package — a self-hosting feature. When set, the server keeps
	/// this package out of the public board list: it can't be listed or staged for a NEW game until a
	/// player presents the matching code. One code reveals every hidden package that shares it. Joining
	/// (or resuming) a game that already uses the board needs no code — the restore path re-stages by id
	/// and is never gated. This is a soft gate, not access control. NEVER sent to the client (it lives
	/// only in the on-disk manifest, which is not web-reachable), so it must not enter any client DTO.
	/// </summary>
	public string? UnlockCode { get; init; }
	/// <summary>
	/// Optional i18n key (resolved against the PACKAGE's OWN translations) the lobby shows the host as a
	/// notice when they create a game with this board. The engine does not know or interpret the text —
	/// it only carries the key to the client and renders it. Unlike <see cref="UnlockCode"/>, this DOES
	/// travel to the client: showing it is its whole purpose.
	/// </summary>
	public string? Warning { get; init; }
}

/// <summary>
/// The board's building tiers. A property is improved by adding small constructions; once
/// <see cref="Levels"/> of them are present they combine into one big construction (the classic 4
/// smallBuildings -> 1 bigBuilding, but the count is configurable, e.g. 5). The names are generic and localized so
/// no board is forced to call them "smallBuilding"/"bigBuilding". A property's rent table must have Levels+2
/// entries (base, one per small level, then the big one).
/// </summary>
public sealed record BuildingDef
{
	public int Levels { get; init; } = 4;
	/// <summary>i18n key for one small construction's name (e.g. "building.small" -> "colony").</summary>
	public string? SmallKey { get; init; }
	/// <summary>i18n key for the plural small name (e.g. "building.smallPlural" -> "colonies").</summary>
	public string? SmallPluralKey { get; init; }
	/// <summary>i18n key for the big construction's name (e.g. "building.big" -> "metropolis").</summary>
	public string? BigKey { get; init; }
}

/// <summary>
/// The player-count range a board supports. Defaults to the engine's range (2..8) when the manifest
/// omits it; the lobby offers min..max and the start guard rejects fewer than <see cref="Min"/>.
/// </summary>
public sealed record PlayersDef
{
	public int Min { get; init; } = 2;
	public int Max { get; init; } = 8;
}

/// <summary>A group heading for the rules panel (id referenced by smallBuilding rules + an i18n name key).</summary>
public sealed record RuleGroupDef
{
	public string Id { get; init; } = string.Empty;
	public string? NameKey { get; init; }
}

/// <summary>
/// A player token the package provides: a string id (stored as the player's token), an inline SVG
/// image, and an i18n name key for the accessible/visible radio label. A package replaces the
/// built-in token set with its own.
/// </summary>
public sealed record TokenDef
{
	public string Id { get; init; } = string.Empty;
	public string? Svg { get; init; }
	public string? NameKey { get; init; }
}

/// <summary>
/// A host-customizable rule the board exposes: a generic catalog code (the engine implements the
/// mechanic), its default value, UI type/bounds, group, whether the host may change it, and an i18n
/// name key. A package can't invent mechanics — only choose, default, rename and expose known codes.
/// </summary>
public sealed record HouseRuleDef
{
	public string Id { get; init; } = string.Empty;
	public string? Group { get; init; }
	public string Type { get; init; } = "toggle"; // "toggle" | "number" | "choice"
	public JsonElement? Default { get; init; }     // bool (toggle), number, or a choice option id (string)
	public double? Min { get; init; }
	public double? Max { get; init; }
	public double? Step { get; init; }
	/// <summary>A "choice" rule's mutually-exclusive options (rendered as radios). Each is an
	/// option id (the value applied) + an i18n name key. Ignored by toggle/number rules.</summary>
	public List<HouseRuleOption>? Options { get; init; }
	public bool EditableByHost { get; init; } = true;
	public string? NameKey { get; init; }
}

/// <summary>One option of a "choice" house rule: the id stored/applied and its i18n label.</summary>
public sealed record HouseRuleOption
{
	public string Id { get; init; } = string.Empty;
	public string? NameKey { get; init; }
}

public sealed record SquareDef
{
	public int Id { get; init; }
	public string Type { get; init; } = string.Empty;
	public string? Group { get; init; }
	public string? Deck { get; init; }
	/// <summary>i18n key for the square's name (e.g. "squares.s1"), resolved from the package's
	/// own i18n files. Null for squares the board doesn't name (corners get a generic label).</summary>
	public string? NameKey { get; init; }
	public int? Price { get; init; }
	public int? BuildCost { get; init; }
	public int[]? Rent { get; init; }
	public int? Amount { get; init; }
}

public sealed record CardEffect
{
	public string Type { get; init; } = string.Empty;
	/// <summary>A square id ("0") or a relative target ("nearest:transit"). Numbers are coerced to string.</summary>
	[JsonConverter(typeof(NumberOrStringConverter))]
	public string? Target { get; init; }
	public bool? CollectPass { get; init; }
	public int? Steps { get; init; }
	public int? Amount { get; init; }
	public int? PerSmallBuilding { get; init; }
	public int? PerBigBuilding { get; init; }
	/// <summary>For a <c>moveTo</c> card: multiply the rent due on arrival (e.g. 2 for the classic
	/// "advance to the nearest railway, pay double" card). Null/1 means normal rent.</summary>
	public int? RentMultiplier { get; init; }
	/// <summary>For a <c>moveTo</c> card landing on a utility: charge 10× a fresh dice throw instead
	/// of the ownership-based amount (the classic "advance to nearest utility" rule).</summary>
	public bool? UtilityTimesDice { get; init; }
}

public sealed record CardDef
{
	public string Id { get; init; } = string.Empty;
	public string Deck { get; init; } = string.Empty;
	/// <summary>Sanitized path-data loaded from optional cards/&lt;id&gt;.svg. Package content
	/// overrides the client's neutral face; null lets the engine render its fallback.</summary>
	public string? Svg { get; init; }
	/// <summary>Optional package-owned #RRGGBB accent for this card's frame and silhouette.</summary>
	public string? ArtColor { get; init; }
	/// <summary>i18n key for the card's text (e.g. "cards.f1"), resolved client-side against the
	/// merged app + package translations.</summary>
	public string? TextKey { get; init; }
	public CardEffect Effect { get; init; } = new();
}

/// <summary>A fully-loaded, validated .corro package: the engine's content definition.</summary>
public sealed record GameDefinition
{
	public Manifest Manifest { get; init; } = new();
	/// <summary>The "property" family board (board.json as a square array). Empty for other families.</summary>
	public List<SquareDef> Board { get; init; } = new();
	/// <summary>The "race" family board (board.json as a circuit definition). Null for other families.</summary>
	public RaceBoardDef? RaceBoard { get; init; }
	/// <summary>The track board (track family); null for other families.</summary>
	public TrackBoardDef? TrackBoard { get; init; }
	/// <summary>The trivia wheel board (trivia family); null for other families.</summary>
	public TriviaBoardDef? TriviaBoard { get; init; }
	/// <summary>The trivia question decks, keyed by locale ("es"/"en") — real content per language,
	/// not a translation. The runtime resolves one language at game start. Null for other families.</summary>
	public Dictionary<string, List<TriviaQuestionDef>>? TriviaQuestions { get; init; }
	/// <summary>The journey deck catalog (cards.json as card definitions with copy counts).
	/// Null for other families — the journey family has no board at all.</summary>
	public List<JourneyCardDef>? JourneyDeck { get; init; }
	/// <summary>The assembly deck catalog (cards.json). Null for other families — the
	/// assembly family has no board either.</summary>
	public List<AssemblyCardDef>? AssemblyDeck { get; init; }
	/// <summary>The draft deck catalog (cards.json). Null for other families — the draft
	/// family has no board either.</summary>
	public List<DraftCardDef>? DraftDeck { get; init; }
	/// <summary>The shedding deck catalog (cards.json). Null for other families — the
	/// shedding family has no board either.</summary>
	public List<SheddingCardDef>? SheddingDeck { get; init; }
	/// <summary>The exploding deck catalog (cards.json). Null for other families — the
	/// exploding family has no board either.</summary>
	public List<ExplodingCardDef>? ExplodingDeck { get; init; }
	public List<CardDef> Cards { get; init; } = new();
	/// <summary>The package's own translations (lang -> flattened key -> text), loaded from
	/// i18n/{lang}.json. Used server-side to resolve square names into per-locale text; the client
	/// merges the same files for everything it resolves itself (cards, groups, announcements).</summary>
	public Dictionary<string, Dictionary<string, string>> I18n { get; init; } = new();
}

/// <summary>Reads a JSON value that may be a number or a string into a string (e.g. card targets).</summary>
public sealed class NumberOrStringConverter : JsonConverter<string?>
{
	public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
		=> reader.TokenType switch
		{
			JsonTokenType.String => reader.GetString(),
			JsonTokenType.Number => reader.GetInt32().ToString(CultureInfo.InvariantCulture),
			JsonTokenType.Null => null,
			_ => throw new JsonException($"Expected a number or string, got {reader.TokenType}.")
		};

	public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options)
	{
		if (value is null)
		{
			writer.WriteNullValue();
		}
		else
		{
			writer.WriteStringValue(value);
		}
	}
}
