namespace CorroServer.Models.Corro;

// The shedding game family: no board — the package ships a
// DECK (cards.json) and the family rules (manifest "sheddingRules"). Play one card that
// matches the top of the discards by COLOUR, by NUMBER value or by ACTION type — or draw
// one and maybe play it. First empty hand wins the round and collects the points left in
// every rival hand; rounds repeat until the target score. A card is pure data: attributes
// + an effect the ENGINE implements (a package cannot invent mechanics — the same
// doctrine as every other family).

/// <summary>One card DEFINITION in the deck catalog (the deck holds <see cref="Count"/> copies).</summary>
public sealed record SheddingCardDef
{
	public string Id { get; init; } = string.Empty;

	/// <summary>
	/// The engine effect this card carries:
	/// "number" (matches by colour or equal <see cref="Value"/>; no effect),
	/// "skip" (the next player loses their turn),
	/// "reverse" (the direction flips; with two players it acts as a skip),
	/// "drawTwo" (the next player draws two and loses their turn),
	/// "wild" (always playable; the player names the colour in force),
	/// "wildDrawFour" (wild + the next player draws four and loses their turn; legal only
	/// while the player holds NO card of the colour in force, and the server enforces it —
	/// no bluffing, no challenge window).
	/// Action cards also match each other by TYPE (skip on skip, drawTwo on drawTwo).
	/// </summary>
	public string Type { get; init; } = string.Empty;

	/// <summary>The card's colour (package-defined ids: "red", "blue"…). Null for wilds.
	/// Every colour needs a spoken name under the package's <c>colors.&lt;id&gt;</c> key.</summary>
	public string? Color { get; init; }

	/// <summary>"number" cards: the printed value (matching and round scoring).</summary>
	public int Value { get; init; }

	/// <summary>Copies of this card in the deck.</summary>
	public int Count { get; init; } = 1;

	/// <summary>i18n key for the card's spoken/visible name.</summary>
	public string NameKey { get; init; } = string.Empty;

	/// <summary>Round-scoring points left in a loser's hand. Null = the classic table:
	/// numbers score their value, coloured actions 20, wilds 50.</summary>
	public int? Points { get; init; }
}

/// <summary>Family rules (manifest "sheddingRules"), with the classic game as defaults.</summary>
public sealed record SheddingRulesConfig
{
	/// <summary>Cards dealt to each player at the start of every round.</summary>
	public int HandSize { get; init; } = 7;

	/// <summary>Match target: rounds repeat until someone crosses this score.
	/// 0 = a single round (first empty hand wins outright).</summary>
	public int TargetScore { get; init; } = 500;

	/// <summary>The classic "draw one, play it if it fits": after drawing, a playable
	/// card may be played immediately (the game pauses on the drawer's choice).
	/// False = drawing always ends the turn.</summary>
	public bool DrawnCardPlayable { get; init; } = true;

	/// <summary>The wild-draw card is legal only while the player holds no card of the
	/// colour in force (server-enforced; there is no challenge). False = always legal.</summary>
	public bool WildDrawRequiresNoMatch { get; init; } = true;

	/// <summary>House rule: a player may play SEVERAL identical number cards (same colour
	/// AND value) in one turn, shedding the duplicates at once. Off = the classic one card.
	/// Deliberately limited to number cards — doubling actions would multiply their effects
	/// and tangle with stacking; numbers just leave the hand.</summary>
	public bool AllowDoubles { get; init; } = false;

	/// <summary>House rule: how draw-penalty cards (drawTwo / wildDrawFour) may be answered
	/// instead of drawing at once. "none" = classic (the victim draws and is skipped);
	/// "sameType" = the victim may pile another card of the SAME kind (a +2 on a +2, a +4
	/// on a +4), passing the growing total on; "cross" = any draw card stacks on any (a +4
	/// answers a +2 and vice versa). Whoever cannot or will not stack draws the whole total.</summary>
	public string Stacking { get; init; } = "none";

	/// <summary>House rule: a player who plays down to one card must declare it,
	/// or anyone may catch them (a real-time window that closes when the next player acts) and
	/// they draw <see cref="LastCardPenalty"/> cards. Off = the classic silence ("aquí nadie grita",
	/// counts on demand via S / Shift+S).</summary>
	public bool LastCardCall { get; init; } = false;

	/// <summary>Cards drawn when caught without declaring the last card.</summary>
	public int LastCardPenalty { get; init; } = 2;
}
