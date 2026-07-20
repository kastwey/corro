namespace CorroServer.Models.Corro;

// The exploding game family: no board — the package ships a deck
// (cards.json) and the family rules (manifest "explodingRules"). On your turn you may play any
// number of action cards and then you MUST draw one to end the turn; drawing a bomb you cannot
// Defuse knocks you out. The last player standing wins. A card is pure data: a type whose
// effect the ENGINE implements (a package cannot invent mechanics — the same doctrine as every
// other family; it only picks counts and names).

/// <summary>One card DEFINITION in the deck catalog (the deck holds <see cref="Count"/> copies).</summary>
public sealed record ExplodingCardDef
{
	public string Id { get; init; } = string.Empty;
	/// <summary>Sanitized path-data loaded from optional cards/&lt;id&gt;.svg.</summary>
	public string? Svg { get; init; }
	/// <summary>Optional package-owned #RRGGBB accent for the card face.</summary>
	public string? ArtColor { get; init; }

	/// <summary>
	/// The engine effect this card carries:
	/// "bomb" (the exploding kitten — drawing it knocks you out unless you Defuse; never dealt
	/// into an opening hand, planted into the draw pile players−1 times),
	/// "defuse" (cancels a bomb you just drew and lets you tuck it back into the draw pile at a
	/// secret depth; one is dealt to every hand at the start),
	/// "skip" (end your turn immediately without drawing),
	/// "attack" (end your turn without drawing and make the next player owe extra draws; stacks),
	/// "seeFuture" (privately look at the top cards of the draw pile),
	/// "shuffle" (shuffle the draw pile — erasing what anyone knew of its order),
	/// "favor" (a chosen player hands you one card of their choice),
	/// "nope" (the ONLY out-of-turn card: cancels a pending action; a Nope can itself be Noped,
	/// forming a stack whose parity decides the outcome),
	/// "cat" (no power alone; two of the SAME cat card are a pair you discard to steal a random
	/// card from a chosen player).
	/// </summary>
	public string Type { get; init; } = string.Empty;

	/// <summary>Copies of this card in the deck.</summary>
	public int Count { get; init; } = 1;

	/// <summary>i18n key for the card's spoken / visible name.</summary>
	public string NameKey { get; init; } = string.Empty;
}

/// <summary>Family rules (manifest "explodingRules"), with the classic game as defaults.</summary>
public sealed record ExplodingRulesConfig
{
	/// <summary>Non-bomb, non-defuse cards dealt to each player at the start (on top of the
	/// guaranteed Defuse in <see cref="DefusesPerPlayer"/>).</summary>
	public int HandSize { get; init; } = 7;

	/// <summary>Defuse cards dealt to every hand at the start (the classic guarantee of one).</summary>
	public int DefusesPerPlayer { get; init; } = 1;

	/// <summary>How many top cards See the Future reveals to its player.</summary>
	public int SeeFutureCount { get; init; } = 3;

	/// <summary>Draws an Attack forces on its victim (the classic "take two turns"): it stacks,
	/// so a re-Attack piles more on. Modelled as the victim's owed-draws count.</summary>
	public int AttackDraws { get; init; } = 2;

	/// <summary>The real-time suspense window, in milliseconds, before a played action resolves
	/// — long enough to hear the rising earcon-countdown and slam the reaction key. Each Nope
	/// restarts it. Owned by the flow layer; the pure rules never look at the clock.</summary>
	public int NopeWindowMillis { get; init; } = 1000;
}
