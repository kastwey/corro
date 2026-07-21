namespace CorroServer.Models;

// Runtime state of a "draft" family game (simultaneous pick-and-pass drafting genre).
// Lives inside GameState.Draft so transport/persistence/announcements are shared with
// every family. HIDDEN INFORMATION: hands, each seat's committed pick (until the reveal)
// and the draw pile — DraftFamily.ProjectFor strips them before anything leaves the
// server. The TABLES (played cards), desserts and scores are public: everyone watched
// every reveal. Persistence stores the FULL state.

/// <summary>One physical card in play: a unique instance of a catalog definition.</summary>
public record DraftCardInstance
{
	/// <summary>Unique per physical card ("caramel-custard#2"), stable across the hand — the client's
	/// hand list keeps focus through it.</summary>
	public required string InstanceId { get; init; }
	/// <summary>The catalog definition this instance copies (DraftCardDef.Id).</summary>
	public required string CardId { get; init; }
}

/// <summary>
/// One card on a seat's PUBLIC table. A points card that landed on one of the seat's
/// unused multipliers carries it here (the multiplier's own slot is removed): the pair
/// scores Value × Factor at round end.
/// </summary>
public record DraftTableSlot
{
	public required DraftCardInstance Card { get; init; }

	/// <summary>The multiplier boosting this points card, or null. Set at reveal time —
	/// only a multiplier already on the table from an EARLIER trick can catch a card.</summary>
	public DraftCardInstance? OnMultiplier { get; set; }
}

/// <summary>One player's side of the table: private hand + pending pick, public rest.</summary>
public record DraftSeatState
{
	public required string PlayerId { get; init; }

	/// <summary>The player's current hand. PRIVATE — and it ROTATES: after every reveal
	/// this whole list travels to the next seat (settable for that swap).</summary>
	public List<DraftCardInstance> Hand { get; set; } = new();

	/// <summary>Cards in hand as a COUNT — what the projection leaves for the others.</summary>
	public int HandCount { get; set; }

	/// <summary>The card committed this trick, face-down. PRIVATE: rivals only see
	/// <see cref="HasPicked"/>. Replaceable until everyone has picked (the re-pick).</summary>
	public string? CommittedInstanceId { get; set; }

	/// <summary>The SECOND card of a double pick (an "extra" card on the table pays for
	/// it and returns to the passing hand at the reveal). PRIVATE like the first.</summary>
	public string? CommittedSecondId { get; set; }

	/// <summary>Whether this seat has committed a pick this trick (the public echo).</summary>
	public bool HasPicked { get; set; }

	/// <summary>Cards revealed this round (public). Cleared by the round scoring —
	/// except desserts, which move to <see cref="Desserts"/>.</summary>
	public List<DraftTableSlot> Table { get; init; } = new();

	/// <summary>Dessert cards accumulated across rounds (public), scored at game end.</summary>
	public List<DraftCardInstance> Desserts { get; init; } = new();

	/// <summary>Total score so far (public).</summary>
	public int Score { get; set; }

	/// <summary>Each finished round's points, in order (public — the client's scoreboard).</summary>
	public List<int> RoundScores { get; init; } = new();

	/// <summary>The player left the game (public). A retired seat holds no cards, never
	/// picks, is skipped by the hand rotation and sits out every remaining race — but its
	/// banked score stays on the board.</summary>
	public bool Retired { get; set; }
}

/// <summary>Everything draft-specific inside GameState (null in other families).</summary>
public record DraftState
{
	/// <summary>The round being played, 1-based (game ends after DraftRulesConfig.Rounds).</summary>
	public int Round { get; set; } = 1;

	/// <summary>The trick within the round, 1-based (one card is drafted per trick).</summary>
	public int Trick { get; set; } = 1;

	public List<DraftSeatState> Seats { get; init; } = new();

	/// <summary>The face-down draw pile, top last. PRIVATE: projected to a count.
	/// Each round deals fresh hands from here; revealed cards never return.</summary>
	public List<DraftCardInstance> DrawPile { get; init; } = new();

	/// <summary>Draw pile as a COUNT — what the projection leaves.</summary>
	public int DrawCount { get; set; }
}
