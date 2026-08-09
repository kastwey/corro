namespace CorroServer.Models;

// Runtime state of an assembly-family game. Lives inside GameState.Assembly
// so transport/persistence/announcements are shared with every family. HIDDEN INFORMATION:
// hands, the draw pile AND the discard pile (face-down in this genre, reshuffled into the
// draw pile when it dries) — AssemblyFamily.ProjectFor strips them all to counts before
// anything leaves the server. Persistence stores the FULL state.

/// <summary>One physical card in play: a unique instance of a catalog definition.</summary>
public record AssemblyCardInstance
{
	/// <summary>Unique per physical card ("reactor#2"), stable across the hand — the client's
	/// hand list keeps focus through it.</summary>
	public required string InstanceId { get; init; }
	/// <summary>The catalog definition this instance copies (AssemblyCardDef.Id).</summary>
	public required string CardId { get; init; }
}

/// <summary>
/// One slot of a player's rack: a placed PIECE plus whatever is stuck to it. The slot's
/// life: healthy → afflicted (one attack) → destroyed (a second attack removes the slot);
/// or healthy → shielded (one remedy) → locked (a second remedy: untouchable forever).
/// An attack on a shielded slot burns the shield instead of afflicting.
/// </summary>
public record AssemblySlot
{
	/// <summary>The slot's effective colour: its piece's colour ("wild" for the joker piece,
	/// which completes any missing colour and is hit by attacks of any colour).</summary>
	public required string Color { get; init; }

	/// <summary>The piece occupying the slot.</summary>
	public required AssemblyCardInstance Piece { get; init; }

	/// <summary>
	/// The piece is INERT: no attack may hit it and no remedy may treat it, so the slot is
	/// functional for as long as it is held. Copied off the piece's definition when the slot is
	/// built (and carried along when a slot changes hands) so every reader — including the
	/// client, which sees slots without the catalog — can tell at a glance.
	/// </summary>
	public bool Inert { get; init; }

	/// <summary>Attack instances currently stuck to the piece (a second one destroys it,
	/// so this never holds more than one between plays).</summary>
	public List<AssemblyCardInstance> Afflictions { get; init; } = new();

	/// <summary>Remedy instances shielding the piece (two = locked, untouchable).</summary>
	public List<AssemblyCardInstance> Shields { get; init; } = new();

	/// <summary>
	/// A POTENT remedy locked this piece on its own, so the lock does not show up as two
	/// shields. Stored rather than derived because the slot travels to the client without the
	/// catalog needed to tell a potent remedy from an ordinary one.
	/// </summary>
	public bool Sealed { get; set; }
}

/// <summary>One player's side of the table: their PRIVATE hand and their public rack.</summary>
public record AssemblySeatState
{
	public required string PlayerId { get; init; }

	/// <summary>The player's hand. PRIVATE: projected away for everyone else.</summary>
	public List<AssemblyCardInstance> Hand { get; init; } = new();

	/// <summary>Cards in hand as a COUNT — what the projection leaves for the others.</summary>
	public int HandCount { get; set; }

	/// <summary>The rack under assembly (public — everyone watched every piece land).</summary>
	public List<AssemblySlot> Slots { get; init; } = new();

	/// <summary>The player left the game (public). A retired seat holds no cards and no
	/// rack (everything went to the face-down discards, so the card economy keeps
	/// breathing) and can no longer be targeted.</summary>
	public bool Retired { get; set; }
}

/// <summary>Everything assembly-specific inside GameState (null in other families).</summary>
public record AssemblyState
{
	public List<AssemblySeatState> Seats { get; init; } = new();

	/// <summary>The face-down draw pile, top last. PRIVATE: projected to a count.</summary>
	public List<AssemblyCardInstance> DrawPile { get; init; } = new();

	/// <summary>Draw pile as a COUNT — what the projection leaves.</summary>
	public int DrawCount { get; set; }

	/// <summary>The discard pile. FACE-DOWN in this genre (identities secret, reshuffled
	/// into the draw pile when it dries): projected to a count like the hands.</summary>
	public List<AssemblyCardInstance> DiscardPile { get; init; } = new();

	/// <summary>Discard pile as a COUNT — what the projection leaves.</summary>
	public int DiscardCount { get; set; }

	/// <summary>
	/// Cards taken OUT of the game for good: what an exile special lifts off a rack, and (with
	/// the attrition house rule) attacks cured by a potent remedy. Unlike the discards these
	/// never come back in the refill reshuffle, so the deck's supply of attacks really does
	/// shrink. PUBLIC as a count only — the pile itself is projected away like the discards.
	/// </summary>
	public List<AssemblyCardInstance> ExiledPile { get; init; } = new();

	/// <summary>Cards out of the game as a COUNT — what the projection leaves.</summary>
	public int ExiledCount { get; set; }

	/// <summary>
	/// Plays the current player still owes before their turn ends, granted by a doubleAct or
	/// handSwap special. Zero (the normal case) means one card ends the turn. The turn also
	/// ends early when the hand runs out of legal plays, so an unplayable grant cannot wedge
	/// the table. PUBLIC — the table hears the turn being extended.
	/// </summary>
	public int ExtraPlays { get; set; }

	/// <summary>
	/// The current player traded hands this turn and may no longer discard: the cards are not
	/// theirs to throw away, only to play. Cleared when the turn ends. PUBLIC.
	/// </summary>
	public bool DiscardBlocked { get; set; }
}
