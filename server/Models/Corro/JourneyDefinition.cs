namespace CorroServer.Models.Corro;

// The "journey" game family (Mil Millas genre): NO board at all — the package ships a DECK
// (cards.json as a list of card definitions with copy counts) and the family rules
// (manifest "journeyRules"). A card is pure data: attributes + an effect the ENGINE
// implements (a package cannot invent mechanics, same doctrine as property card effects).
//
// The state model has one elegant trick: everyone starts under the board's INITIAL HAZARD
// (classically "stop" — you may not move until you play the green-light remedy), so there is
// no special "start" mechanic: the green light is just a remedy for that hazard, and the
// right-of-way immunity shields it like any other.

/// <summary>One card DEFINITION in the deck catalog (the deck holds <see cref="Count"/> copies).</summary>
public sealed record JourneyCardDef
{
	public string Id { get; init; } = string.Empty;
	/// <summary>Sanitized path-data loaded from optional cards/&lt;id&gt;.svg.</summary>
	public string? Svg { get; init; }
	/// <summary>Optional package-owned #RRGGBB accent for the card face.</summary>
	public string? ArtColor { get; init; }

	/// <summary>"distance" | "attack" | "remedy" | "immunity" — drives legality and scoring.</summary>
	public string Type { get; init; } = string.Empty;

	/// <summary>Kilometres this card advances (distance cards only).</summary>
	public int Value { get; init; }

	/// <summary>
	/// The hazard KIND this card interacts with (attack: inflicts it; remedy: cures it;
	/// immunity: shields it — see <see cref="ShieldsKinds"/> for multi-shield immunities).
	/// Kinds are package-defined ids ("stop", "flat", "outOfGas"…).
	/// </summary>
	public string? Kind { get; init; }

	/// <summary>
	/// Attack cards only: "stopper" blocks all distance play on the victim;
	/// "limiter" caps the distance value they may play (see JourneyRulesConfig.LimitCap).
	/// </summary>
	public string? HazardClass { get; init; }

	/// <summary>Immunity cards only: every hazard kind this immunity shields (the classic
	/// right-of-way shields both the stopper "stop" and the limiter "speedLimit").</summary>
	public List<string> ShieldsKinds { get; init; } = new();

	/// <summary>Copies of this card in the deck.</summary>
	public int Count { get; init; } = 1;

	/// <summary>Max times one player may PLAY this card per hand (the classic two-200s rule);
	/// null = unlimited.</summary>
	public int? MaxPlaysPerHand { get; init; }

	/// <summary>Counts against the "safe trip" bonus (classically the 200 km cards).</summary>
	public bool Premium { get; init; }

	/// <summary>i18n key for the card's spoken/visible name.</summary>
	public string NameKey { get; init; } = string.Empty;

	/// <summary>
	/// Optional i18n key for a THEMED play announcement that replaces the engine's generic
	/// sentence + card-name pair ("{{player}} llena el tanque de su {{token}}"). Vars offered:
	/// {{player}}, {{token}} (the player's piece name, resolved per-language on the client
	/// from the tokenId the server sends), {{target}} on attacks, {{km}}/{{total}} on distances.
	/// </summary>
	public string? PlayedKey { get; init; }
}

/// <summary>Family rules (manifest "journeyRules"), with the classic game as defaults.</summary>
public sealed record JourneyRulesConfig
{
	/// <summary>Kilometres that complete a hand (exactly — overshooting plays are illegal).</summary>
	public int GoalKm { get; init; } = 1000;

	/// <summary>Match target: hands are played until someone crosses this score.
	/// 0 = a single hand (first to <see cref="GoalKm"/> wins outright).</summary>
	public int TargetScore { get; init; } = 5000;

	/// <summary>Cards in hand (draw back up to this at the start of your turn).</summary>
	public int HandSize { get; init; } = 6;

	/// <summary>House rule: allow stacking DIFFERENT stopper hazards on a victim who is
	/// already stopped (officially an attack needs a rolling victim).</summary>
	public bool StackHazards { get; init; }

	/// <summary>Max distance card value playable while under a "limiter" hazard.</summary>
	public int LimitCap { get; init; } = 50;

	/// <summary>The hazard every seat starts the hand under (the classic "stop": play the
	/// green light to start rolling). Empty = seats start free.</summary>
	public string InitialHazard { get; init; } = "stop";

	// ── Scoring (official table; a 0 disables a bonus) ────────────────────────
	public int PointsPerKm { get; init; } = 1;
	public int ImmunityPoints { get; init; } = 100;
	public int AllImmunitiesBonus { get; init; } = 300;
	public int CoupFourreBonus { get; init; } = 300;
	public int TripCompleteBonus { get; init; } = 400;
	public int SafeTripBonus { get; init; } = 300;
	public int DeckExhaustedBonus { get; init; } = 300;
	public int CapotBonus { get; init; } = 500;
}
