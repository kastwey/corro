namespace CorroServer.Models.Corro;

// The assembly game family: no board — the package ships a deck
// (cards.json) and the family rules (manifest "assemblyRules"). You assemble a rack of
// coloured PIECES (one per colour); rivals throw ATTACKS at them (two hits destroy a
// piece), you fix with REMEDIES (two shields lock a piece forever), and five SPECIAL
// effects stir the table. First rack with enough distinct, functional colours wins.
// A card is pure data: attributes + an effect the ENGINE implements (a package cannot
// invent mechanics — the same doctrine as every other family).

/// <summary>One card DEFINITION in the deck catalog (the deck holds <see cref="Count"/> copies).</summary>
public sealed record AssemblyCardDef : IPackageCardDef
{
	public string Id { get; init; } = string.Empty;
	/// <summary>Sanitized path-data loaded from optional assets/cards/&lt;id&gt;.svg.</summary>
	public string? Svg { get; init; }
	public bool HasPngArt { get; init; }
	/// <summary>Optional package-owned #RRGGBB accent for the card face.</summary>
	public string? ArtColor { get; init; }

	/// <summary>"piece" | "attack" | "remedy" | "special" — drives legality and effects.</summary>
	public string Type { get; init; } = string.Empty;

	/// <summary>
	/// The colour this card belongs to (package-defined ids: "red", "green"…). The special
	/// colour "wild" matches ANY colour: a wild piece is a joker slot that completes any
	/// missing colour; a wild attack/remedy hits/fixes any slot. Null for specials.
	/// </summary>
	public string? Color { get; init; }

	/// <summary>
	/// Special cards only — the engine effect this card triggers:
	/// "swapPiece" (one of mine ↔ one of a rival's, states carried, locked excluded),
	/// "stealPiece" (take a rival's non-locked piece into my free colour),
	/// "plague" (move each of my afflictions onto rivals' CLEAN matching slots),
	/// "scrapHands" (every rival discards their whole hand),
	/// "fullSwap" (my whole rack ↔ a rival's, locked included),
	/// "exile" (lift one affliction off ANY rack and take it out of the game for good),
	/// "doubleAct" (play the rest of your hand this turn instead of ending it),
	/// "handSwap" (trade hands with a rival, then play one of the cards you received),
	/// "guard" (REACTIVE, off-turn: cancel a card aimed at you; the attacker re-aims).
	/// </summary>
	public string? SpecialKind { get; init; }

	/// <summary>
	/// Attacks only — a RESISTANT attack no ordinary remedy can lift: only a
	/// <see cref="Potent"/> remedy (or an effect that removes it outright) clears it. It
	/// afflicts, destroys and burns shields exactly like an ordinary attack.
	/// </summary>
	public bool Resistant { get; init; }

	/// <summary>
	/// Remedies only — a POTENT remedy: it cures resistant afflictions, and protecting with
	/// one locks the piece on its own (no second remedy needed), which also puts it beyond
	/// every attack. Ordinary remedies still need two to lock.
	/// </summary>
	public bool Potent { get; init; }

	/// <summary>
	/// Pieces only — an INERT piece: nothing sticks to it. No attack may hit it and no remedy
	/// may treat it, so it is always functional; it can still be stolen, swapped or traded
	/// away, which is the only way to lose it. Its colour is its own (no attack answers it).
	/// </summary>
	public bool Inert { get; init; }

	/// <summary>Copies of this card in the deck.</summary>
	public int Count { get; init; } = 1;

	/// <summary>i18n key for the card's spoken/visible name.</summary>
	public string NameKey { get; init; } = string.Empty;

	/// <summary>
	/// Optional i18n key for a THEMED play announcement replacing the engine's generic
	/// sentence + card-name pair. Vars offered: {{player}}, {{target}} on attacks/specials.
	/// The attack variants follow the family convention: _self / _victim / base.
	/// </summary>
	public string? PlayedKey { get; init; }
}

/// <summary>Family rules (manifest "assemblyRules"), with the classic game as defaults.</summary>
public sealed record AssemblyRulesConfig
{
	/// <summary>Cards in hand (refilled up to this at the end of your turn).</summary>
	public int HandSize { get; init; } = 3;

	/// <summary>Distinct FUNCTIONAL colours (afflicted slots don't count; a wild piece
	/// fills any missing colour) that complete the rack and win the game.</summary>
	public int SlotsToWin { get; init; } = 4;

	/// <summary>Max cards discardable in one turn (the turn's alternative to playing).</summary>
	public int MaxDiscard { get; init; } = 3;

	/// <summary>
	/// House rule — the short table: with exactly two seats the rack needs ONE more colour
	/// than <see cref="SlotsToWin"/>, so a duel does not end on a lucky opening hand. Off by
	/// default; the goal never changes at three seats or more.
	/// </summary>
	public bool DuelGoal { get; init; }

	/// <summary>
	/// House rule — the long table: an attack lifted by a POTENT remedy leaves the game
	/// instead of returning to the discards, so a crowded table slowly runs out of ways to
	/// hurt each other. Off by default (cured attacks recirculate as usual).
	/// </summary>
	public bool AttritionCures { get; init; }

	/// <summary>The rack size that wins at this table: <see cref="SlotsToWin"/>, plus one when
	/// <see cref="DuelGoal"/> is on and exactly two players sat down.</summary>
	public int GoalFor(int seatCount) => SlotsToWin + (DuelGoal && seatCount == 2 ? 1 : 0);
}
