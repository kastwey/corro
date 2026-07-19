namespace CorroServer.Models;

// Runtime state of a shedding-family game. Lives inside
// GameState.Shedding so transport/persistence/announcements are shared with every family.
// HIDDEN INFORMATION: hands, the draw pile, the discard pile BELOW its top card, and the
// drawer's pending played-or-kept decision — SheddingFamily.ProjectFor strips them before
// anything leaves the server. Persistence stores the FULL state.

/// <summary>One physical card in play: a unique instance of a catalog definition.</summary>
public record SheddingCardInstance
{
	/// <summary>Unique per physical card ("red-5#1"), stable across the hand — the
	/// client's hand list keeps focus through it.</summary>
	public required string InstanceId { get; init; }
	/// <summary>The catalog definition this instance copies (SheddingCardDef.Id).</summary>
	public required string CardId { get; init; }
}

/// <summary>One player's side of the table: their PRIVATE hand and their match score.</summary>
public record SheddingSeatState
{
	public required string PlayerId { get; init; }

	/// <summary>The player's hand. PRIVATE: projected away for everyone else.</summary>
	public List<SheddingCardInstance> Hand { get; init; } = new();

	/// <summary>Cards in hand as a COUNT — what the projection leaves for the others.</summary>
	public int HandCount { get; set; }

	/// <summary>MATCH score across finished rounds (the round winner collects the points
	/// left in every rival hand).</summary>
	public int Score { get; set; }

	/// <summary>Points collected per finished round, in order (the client's scoreboard).</summary>
	public List<int> RoundScores { get; init; } = new();

	/// <summary>The player left the game (public). A retired seat holds no cards, is
	/// skipped by the turn order and sits out the remaining rounds; its banked score
	/// stays on the board.</summary>
	public bool Retired { get; set; }
}

/// <summary>
/// The card a player just DREW and may now play (the classic "draw one, play it if it
/// fits"): the game waits for their play-it-or-keep-it answer. PRIVATE — the card's
/// identity is the drawer's alone, so the projection strips this whole record for
/// everyone else (rivals just see the turn holder thinking).
/// </summary>
public record PendingDrawnPlay
{
	public required string PlayerId { get; init; }
	public required string InstanceId { get; init; }
}

/// <summary>
/// A growing draw penalty waiting to land (the "stacking" house rule): the current player
/// must either pile another draw card on it (raising <see cref="Amount"/>) or draw the whole
/// total and lose the turn. PUBLIC — the pile is on the table, so the projection keeps it.
/// </summary>
public record SheddingPenalty
{
	/// <summary>Cards the player on the hook will draw if they don't stack (2, 4, 6…).</summary>
	public required int Amount { get; init; }
	/// <summary>The last draw card stacked ("drawTwo" | "wildDrawFour"): in "sameType" mode
	/// only a card of this kind may pile on; in "cross" mode either kind may.</summary>
	public required string LastType { get; init; }
}

/// <summary>Everything shedding-specific inside GameState (null in other families).</summary>
public record SheddingState
{
	/// <summary>The round being played, 1-based (rounds repeat until the target score).</summary>
	public int Round { get; set; } = 1;

	public List<SheddingSeatState> Seats { get; init; } = new();

	/// <summary>The face-down draw pile, top last. PRIVATE: projected to a count.</summary>
	public List<SheddingCardInstance> DrawPile { get; init; } = new();

	/// <summary>Draw pile as a COUNT — what the projection leaves.</summary>
	public int DrawCount { get; set; }

	/// <summary>The discard pile, top LAST. Only the top card is public knowledge (the
	/// projection keeps the top instance and the count); the buried order is a secret
	/// because it reshuffles into the draw pile when it dries.</summary>
	public List<SheddingCardInstance> DiscardPile { get; init; } = new();

	/// <summary>Discard pile as a COUNT — what the projection leaves (plus the top).</summary>
	public int DiscardCount { get; set; }

	/// <summary>The colour in force: the top card's, or the one a wild's player chose.</summary>
	public string CurrentColor { get; set; } = string.Empty;

	/// <summary>Turn direction over the seat order: +1 (dealing order) or -1 (reversed).</summary>
	public int Direction { get; set; } = 1;

	/// <summary>The drawer's pending play-it-or-keep-it decision, when any. PRIVATE.</summary>
	public PendingDrawnPlay? PendingDrawnPlay { get; set; }

	/// <summary>A draw penalty piling up under the "stacking" house rule, on the current
	/// player to answer. Null when no penalty is in flight (or the rule is off). PUBLIC.</summary>
	public SheddingPenalty? PendingPenalty { get; set; }

	/// <summary>The last-card rule: the player who just played down to one card and has not
	/// declared it — anyone may catch them until the next player acts, when this clears. Null
	/// when nobody is on the hook (or the rule is off). PUBLIC (that is the whole point). The
	/// COUNT of each hand is already public, so this leaks nothing new.</summary>
	public string? PendingLastCardCall { get; set; }
}
