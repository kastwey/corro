namespace CorroServer.Models.Corro;

// The "draft" game family (simultaneous pick-and-pass drafting genre): NO board — the
// package ships a DECK (cards.json) and the family rules (manifest "draftRules"). Every
// trick, ALL players secretly pick one card from their hand at the same time; the picks
// are revealed together onto each player's public table and the shrunken hands rotate to
// the next seat. When the hands run out the round is scored; after the last round the
// accumulated desserts break the bank. A card is pure data: attributes + an effect the
// ENGINE implements (a package cannot invent mechanics — the same doctrine as every
// other family).

/// <summary>One card DEFINITION in the deck catalog (the deck holds <see cref="Count"/> copies).</summary>
public sealed record DraftCardDef
{
	public string Id { get; init; } = string.Empty;
	/// <summary>Sanitized path-data loaded from optional cards/&lt;id&gt;.svg.</summary>
	public string? Svg { get; init; }
	/// <summary>Optional package-owned #RRGGBB accent for the card face.</summary>
	public string? ArtColor { get; init; }

	/// <summary>
	/// The engine effect this card scores with:
	/// "points" (worth <see cref="Value"/> at round end, multiplied when it landed on one
	/// of the seat's unused multipliers),
	/// "multiplier" (waits on the table and boosts the NEXT points card ×<see cref="Factor"/>;
	/// worth nothing alone),
	/// "set" (every complete group of <see cref="SetSize"/> copies scores <see cref="SetPoints"/>),
	/// "scale" (k copies score the k-th step of <see cref="Scale"/>, capped at its last step),
	/// "majority" (its <see cref="Icons"/> count toward the round's single majority race:
	/// most icons wins the rules' first prize, second-most the second),
	/// "dessert" (kept across rounds, scored once at game end: most/fewest desserts),
	/// "extra" (waits on the table; spend it to pick TWO cards in one trick — it then
	/// returns to the hand being passed. Worth nothing at round end).
	/// </summary>
	public string Type { get; init; } = string.Empty;

	/// <summary>Copies of this card in the deck.</summary>
	public int Count { get; init; } = 1;

	/// <summary>i18n key for the card's spoken/visible name.</summary>
	public string NameKey { get; init; } = string.Empty;

	/// <summary>"points" cards: what one scores at round end.</summary>
	public int Value { get; init; }

	/// <summary>"multiplier" cards: the boost applied to the points card that lands on it.</summary>
	public int Factor { get; init; }

	/// <summary>"set" cards: copies needed for one scoring group.</summary>
	public int SetSize { get; init; }

	/// <summary>"set" cards: what each complete group scores.</summary>
	public int SetPoints { get; init; }

	/// <summary>"scale" cards: the cumulative ladder — k copies score the k-th entry
	/// (1-based), capped at the last one.</summary>
	public List<int> Scale { get; init; } = new();

	/// <summary>"majority" cards: icons this card contributes to the round's majority race.</summary>
	public int Icons { get; init; }
}

/// <summary>Family rules (manifest "draftRules"), with the classic drafting game as defaults.</summary>
public sealed record DraftRulesConfig
{
	/// <summary>Rounds in a game (each dealt fresh from the shrinking draw pile).</summary>
	public int Rounds { get; init; } = 3;

	/// <summary>Opening hand size = this minus the player count (more players, thinner
	/// hands — the classic 2:10 … 5:7 curve).</summary>
	public int HandSizeBase { get; init; } = 12;

	/// <summary>Round majority race: what the seat(s) with most icons split.</summary>
	public int MajorityFirst { get; init; } = 6;

	/// <summary>Round majority race: what the runner(s)-up split (only when first place
	/// wasn't tied — a tie up top eats the second prize, as in the classic game).</summary>
	public int MajoritySecond { get; init; } = 3;

	/// <summary>Game end: what the seat(s) with most desserts split.</summary>
	public int DessertBonus { get; init; } = 6;

	/// <summary>Game end: what the seat(s) with fewest desserts split as a LOSS.
	/// Skipped in two-player games (the classic two-player kindness).</summary>
	public int DessertPenalty { get; init; } = 6;
}
