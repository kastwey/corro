namespace CorroServer.Models;

// Runtime state of an exploding-family game: press-your-luck
// against a SHARED, ORDERED draw pile with bombs planted in it, plus elimination — drawing a
// bomb you cannot defuse knocks you out, and the last player standing wins. Lives inside
// GameState.Exploding so transport / persistence / announcements are shared with every family.
//
// HIDDEN INFORMATION: the hands and the ORDER (and contents) of the draw pile. The transient
// private knowledge a player legitimately gains — the top cards they just peeked with See the
// Future, or where they just tucked a defused bomb — is NOT stored here: it is delivered once
// as a targeted announcement to that player (their memory / their UI keeps it), exactly as a
// physical peek works. So ExplodingFamily.ProjectFor only has to strip the draw pile to a
// count and the rival hands to their counts. Persistence stores the FULL state.

/// <summary>One physical card in play: a unique instance of a catalog definition.</summary>
public record ExplodingCardInstance
{
	/// <summary>Unique per physical card ("bomb#1"), stable across the hand so the client's
	/// hand list keeps focus through it.</summary>
	public required string InstanceId { get; init; }

	/// <summary>The catalog definition this instance copies (ExplodingCardDef.Id).</summary>
	public required string CardId { get; init; }
}

/// <summary>One player's side of the table: their PRIVATE hand.</summary>
public record ExplodingSeatState
{
	public required string PlayerId { get; init; }

	/// <summary>The player's hand. PRIVATE: projected away for everyone else.</summary>
	public List<ExplodingCardInstance> Hand { get; init; } = new();

	/// <summary>Cards in hand as a COUNT — what the projection leaves for the others.</summary>
	public int HandCount { get; set; }

	/// <summary>The seat is OUT of the game (public): exploded, or the player left. A dead seat
	/// holds no cards, never takes a turn and can no longer be targeted; the game ends when a
	/// single seat is still in. (Player.Status carries the reason — Eliminated — to the end
	/// screen; the rulebook only needs the in/out bit.)</summary>
	public bool Retired { get; set; }
}

/// <summary>
/// The action a player just played that has NOT yet resolved: it sits in a real-time suspense
/// window during which anyone holding a Nope may cancel it. Each Nope flips the parity; when
/// the window closes on an EVEN count the action resolves, on an ODD one it fizzles. PUBLIC —
/// it is on the table, and letting everyone react is the whole point. The window's wall-clock
/// deadline is owned by the flow layer (the handler), not the pure rules.
/// </summary>
public record PendingExplodingAction
{
	/// <summary>Who played the action being contested.</summary>
	public required string ActorId { get; init; }

	/// <summary>The action card driving it (its CardId → Type), so resolution knows what to do.</summary>
	public required string CardId { get; init; }

	/// <summary>The chosen target, for targeted actions (favor, cat-pair steal). Null otherwise.</summary>
	public string? TargetId { get; init; }

	/// <summary>How many Nopes have landed so far. Even (including 0) = the action stands; odd
	/// = it is cancelled. See <see cref="Rules.ExplodingRulebook.NopeCancels"/>.</summary>
	public int NopeCount { get; set; }

	/// <summary>The authoritative moment (UTC) the current suspense window started — set when the
	/// action is played and moved forward the instant each Nope lands, so the countdown restarts.
	/// The window service reads THIS (never a private copy), so a last-instant Nope reliably
	/// restarts the tone with no race against persistence. Owned by the flow layer.</summary>
	public DateTime WindowStartedAt { get; set; }
}

/// <summary>Everything exploding-specific inside GameState (null in other families).</summary>
public record ExplodingState
{
	public List<ExplodingSeatState> Seats { get; init; } = new();

	/// <summary>The face-down draw pile, top LAST (the next card drawn is the last element).
	/// ORDERED and SECRET: a bomb sits somewhere in here, and manipulating this order (See the
	/// Future, a Defuse tuck, a Shuffle) is the heart of the game. Projected to a count.</summary>
	public List<ExplodingCardInstance> DrawPile { get; init; } = new();

	/// <summary>Draw pile as a COUNT — what the projection leaves.</summary>
	public int DrawCount { get; set; }

	/// <summary>The face-up discard pile of resolved actions (and the hands of the fallen),
	/// top LAST. PUBLIC — every card here is spent and on the table.</summary>
	public List<ExplodingCardInstance> DiscardPile { get; init; } = new();

	/// <summary>Discard pile as a COUNT — kept in sync for the client.</summary>
	public int DiscardCount { get; set; }

	/// <summary>Draws the current player still owes before their turn ends. Normally 1; an
	/// Attack ends the attacker's turn at 0 and raises the NEXT player's owed draws (stacking).
	/// A turn ends when this reaches 0.</summary>
	public int DrawsOwed { get; set; } = 1;

	/// <summary>The action awaiting its Nope window, if any. Only ONE is ever open at a time —
	/// the turn never advances while it is — so the suspense tone is never ambiguous about which
	/// action it belongs to. PUBLIC.</summary>
	public PendingExplodingAction? PendingAction { get; set; }

	/// <summary>A bomb a player just drew and defused: the game waits for them to choose where to
	/// tuck it back into the draw pile (the secret depth). PUBLIC that it is happening (everyone
	/// hears "X defuses and hides it"), but the chosen depth is revealed only to that player.
	/// Null when no reinsertion is pending.</summary>
	public PendingExplodingBomb? PendingBomb { get; set; }

	/// <summary>A Favor that resolved: the game waits for the TARGET to hand a card of their choice
	/// to the requester. PUBLIC (both names are known); the given card's identity is private to the
	/// two of them. Null when no favor is pending.</summary>
	public PendingExplodingFavor? PendingFavor { get; set; }
}

/// <summary>A resolved Favor waiting on the target to give the requester a card of their choice.</summary>
public record PendingExplodingFavor
{
	/// <summary>Who played the Favor and receives the card.</summary>
	public required string RequesterId { get; init; }
	/// <summary>Who must give a card (their choice).</summary>
	public required string TargetId { get; init; }
}

/// <summary>A defused bomb waiting to be tucked back into the draw pile by its drawer. Kept
/// aside (out of the pile and the hand) until the depth is chosen.</summary>
public record PendingExplodingBomb
{
	public required string PlayerId { get; init; }
	public required string InstanceId { get; init; }
	public required string CardId { get; init; }
}
