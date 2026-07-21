namespace CorroServer.Models;

// Runtime state of a "journey" family game (Mil Millas genre). Lives inside GameState.Journey
// so transport/persistence/announcements are shared with every family. THE ONE FAMILY WITH
// HIDDEN INFORMATION: other players' hands and the draw pile order must never reach a client
// — JourneyFamily.ProjectFor strips them (each player sees their own hand; everyone else's is
// a count) before anything is sent. Persistence stores the FULL state.

/// <summary>One physical card in play: a unique instance of a catalog definition.</summary>
public record JourneyCardInstance
{
	/// <summary>Unique per physical card ("distance-100#3"), stable across the hand — the client's
	/// hand list keeps focus through it.</summary>
	public required string InstanceId { get; init; }
	/// <summary>The catalog definition this instance copies (JourneyCardDef.Id).</summary>
	public required string CardId { get; init; }
}

/// <summary>One member of a seat: a player and their PRIVATE hand. Individual play has one
/// member per seat; team play shares the seat between partners, but hands stay per member —
/// official partnership rules: your cards are secret even from your partner.</summary>
public record JourneyMemberState
{
	public required string PlayerId { get; init; }

	/// <summary>The member's hand. PRIVATE: projected away for everyone else — partner included.</summary>
	public List<JourneyCardInstance> Hand { get; init; } = new();

	/// <summary>Cards in hand as a COUNT — what the projection leaves for the other players.</summary>
	public int HandCount { get; set; }
}

/// <summary>
/// One SEAT of a journey hand: the shared side of the table (car, kilometres, hazards,
/// immunities, score). Individual play: one seat per player. Team play: one seat per TEAM —
/// the members take their turns interleaved (the players list ordering at game start), each
/// playing from their own hand onto this shared seat.
/// </summary>
public record JourneySeatState
{
	/// <summary>The seat's stable wire id: its FIRST member's playerId (individual play:
	/// simply the player). Cars, dashboards, scores and turn targeting key on it.</summary>
	public required string PlayerId { get; init; }

	/// <summary>Everyone playing this seat, in their interleaved turn order.</summary>
	public List<JourneyMemberState> Members { get; init; } = new();

	/// <summary>Kilometres accumulated this hand.</summary>
	public int Km { get; set; }

	/// <summary>Active hazard KINDS on this seat (stoppers and limiters together; their class
	/// comes from the card catalog). Starts with the board's initial hazard.</summary>
	public List<string> Hazards { get; init; } = new();

	/// <summary>Immunity CARD ids played this hand (shielded kinds derive from the catalog).</summary>
	public List<string> Immunities { get; init; } = new();

	/// <summary>Per-card plays this hand, for MaxPlaysPerHand limits (the two-200s rule).</summary>
	public Dictionary<string, int> PlaysByCard { get; init; } = new();

	/// <summary>Premium (200 km) cards played this hand — a safe trip requires zero.</summary>
	public int PremiumPlays { get; set; }

	/// <summary>Coups fourrés achieved this hand.</summary>
	public int CoupFourres { get; set; }

	/// <summary>MATCH score accumulated across finished hands (hands are scored into here).</summary>
	public int Score { get; set; }

	/// <summary>Every member of this seat left the game (public). A retired seat can no
	/// longer be attacked; its car stays parked where it was as history.</summary>
	public bool Retired { get; set; }
}

/// <summary>
/// An attack just landed on a victim who HOLDS the matching immunity: the game pauses for
/// their coup fourré decision (play it out of turn for the bonus — and the turn passes to
/// them — or keep it and suffer the hazard). Persisted so a reconnecting client can
/// re-open the choice.
/// </summary>
public record PendingJourneyCoup
{
	public required string VictimId { get; init; }
	public required string AttackerId { get; init; }
	/// <summary>The hazard kind that just landed.</summary>
	public required string HazardKind { get; init; }
	/// <summary>The immunity card instance in the victim's hand that can answer it.</summary>
	public required string ImmunityInstanceId { get; init; }
}

/// <summary>One seat's scoring breakdown for a finished hand (spoken + shown between hands).</summary>
public record JourneyHandScore
{
	public required string PlayerId { get; init; }
	public int Km { get; init; }
	public int ImmunityPoints { get; init; }
	public int AllImmunitiesBonus { get; init; }
	public int CoupFourrePoints { get; init; }
	public int TripCompleteBonus { get; init; }
	public int SafeTripBonus { get; init; }
	public int DeckExhaustedBonus { get; init; }
	public int CapotBonus { get; init; }
	public int Total { get; init; }
	/// <summary>The seat's match score AFTER adding this hand.</summary>
	public int MatchScore { get; init; }
}

/// <summary>Everything journey-specific inside GameState (null in other families).</summary>
public record JourneyState
{
	public List<JourneySeatState> Seats { get; init; } = new();

	/// <summary>The face-down draw pile, top last. PRIVATE: projected to a count.</summary>
	public List<JourneyCardInstance> DrawPile { get; init; } = new();

	/// <summary>Draw pile as a COUNT — what the projection leaves.</summary>
	public int DrawCount { get; set; }

	/// <summary>Face-up discards, top last (public — everyone watched them fall).</summary>
	public List<JourneyCardInstance> DiscardPile { get; init; } = new();

	/// <summary>The current player has drawn this turn (draw → play/discard).</summary>
	public bool HasDrawn { get; set; }

	/// <summary>Hand number within the match (1-based).</summary>
	public int Round { get; set; } = 1;

	/// <summary>A coup fourré decision the game is paused on, when any.</summary>
	public PendingJourneyCoup? PendingCoup { get; set; }

	/// <summary>The last finished hand's scoring (kept for reconnects while the summary shows).</summary>
	public List<JourneyHandScore> LastHandScores { get; init; } = new();
}
