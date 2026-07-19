using System.Text.Json.Serialization;

namespace CorroServer.Models;

public record Player : IJsonOnDeserialized
{
	public required string Id { get; init; }
	public required string Name { get; init; }
	/// <summary>Token id: a built-in token ("disc"…) or a package-defined token id.</summary>
	public required string Token { get; init; }
	public int Position { get; set; }
	public bool IsMe { get; init; } = false;
	/// <summary>A machine-driven seat (see Services/Bots): flagged so the BotDriver knows whom
	/// to drive; the engine itself treats bots exactly like any player.</summary>
	public bool IsBot { get; init; }
	public string? Color { get; init; }
	public int Money { get; set; } = 1500; // Starting money
	public List<int> Properties { get; set; } = new();
	public int ReleasePasses { get; set; } = 0;
	public int LapsCompleted { get; set; } = 0; // Used by first-lap rules and progress reporting
	public bool IsHeld { get; set; } = false; // Is player currently in holding
	public int HoldingTurnsRemaining { get; set; } = 0; // Turns remaining before forced payment (max 3)

	/// <summary>
	/// True once the player has gone bankrupt and is out of the game. A bankrupt player is
	/// skipped in the turn order and excluded from the "last player standing" win check.
	/// </summary>
	public bool IsBankrupt { get; set; } = false;

	/// <summary>
	/// Finishing position, set when the player goes bankrupt: it equals the number of players
	/// still in the game at that moment (themselves included), so the first of N to fall finishes
	/// Nth and the last finishes 2nd (runner-up). 0 while still playing. Drives the end-screen
	/// ranking so eliminated players are ordered by how long they survived, not alphabetically.
	/// </summary>
	public int FinishPlace { get; set; } = 0;

	/// <summary>
	/// Generic in/out standing, and the single signal the turn rotation reads:
	/// GameStateHelper.NextTurn gives a turn only to <see cref="PlayerStatus.Active"/> players.
	/// The reason a player left is family-specific — property and elimination families
	/// set <see cref="PlayerStatus.Eliminated"/> (bankrupt / exploded), while race, track and the
	/// card families set <see cref="PlayerStatus.Finished"/> (reached the goal or took a placing).
	/// Kept distinct from <see cref="FinishPlace"/>, which only orders the final standings.
	/// </summary>
	public PlayerStatus Status { get; set; } = PlayerStatus.Active;

	/// <summary>
	/// Whether the player currently holds a live connection to the game. Flipped by the hub on
	/// SignalR disconnect / authenticated rejoin so the other players can see and hear who is
	/// away. Transient by nature: a restored game keeps the last persisted value until each
	/// player rejoins (JoinGameWithAuth sets it back to true).
	/// </summary>
	public bool IsConnected { get; set; } = true;

	/// <summary>
	/// The race-board seat this player picked in the lobby (null = no preference / property
	/// family). Consumed once by the race initialization, which seats choosers first and hands
	/// the rest the free seats in turn order; RaceState.Seats is the in-game authority.
	/// </summary>
	public string? SeatId { get; set; }

	/// <summary>
	/// Backward compatibility: a game persisted before <see cref="Status"/> existed has no such
	/// field, so it deserializes to <see cref="PlayerStatus.Active"/> even for a player who had
	/// already left. Reconcile from the signals that predate it so the restored turn rotation
	/// still skips them (bankrupt → Eliminated; any other finishing place → Finished).
	/// </summary>
	void IJsonOnDeserialized.OnDeserialized()
	{
		if (Status == PlayerStatus.Active && (IsBankrupt || FinishPlace > 0))
		{
			Status = IsBankrupt ? PlayerStatus.Eliminated : PlayerStatus.Finished;
		}
	}
}

/// <summary>
/// A player's standing in the game. Only <see cref="Active"/> players take turns; the rest have
/// left the rotation, either by <see cref="Finished"/> (completed their run — reached the goal or
/// took a final placing) or <see cref="Eliminated"/> (knocked out — bankruptcy, and later an
/// a bomb detonation). This is the family-agnostic signal the engine's turn rotation
/// reads; the specific families decide which one to stamp.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum PlayerStatus
{
	Active,
	Finished,
	Eliminated,
}

public record Square
{
	public int Id { get; init; }
	public int X { get; init; }
	public int Y { get; init; }
	public string Name { get; init; } = string.Empty;
	// Optional per-locale names (locale code -> text), e.g. from a localized .corro package. The
	// client renders names[lang] falling back to Name, so a board can be translated per player —
	// partial translations are fine. Name stays the canonical fallback used server-side.
	public Dictionary<string, string>? Names { get; init; }
	// Purchase price of an ownable square (property/transit/utility). Null for squares that aren't
	// for sale — a tax square's "pay on landing" sum lives in Amount, not here, to avoid confusion.
	public int? Price { get; init; }
	// The sum a non-ownable square charges on landing (currently tax squares). Kept separate from
	// Price so the UI never presents a tax as a purchase price.
	public int? Amount { get; init; }
	public string? OwnerId { get; set; }
	public string? Color { get; init; }
	// i18n key for the square's group name, so the client announces a meaningful group
	// ("Grupo: Marrón") instead of a raw colour value. Resolved against the merged app + package
	// translations (with a literal fallback). Null when the group has no name.
	public string? GroupNameKey { get; init; }
	public string? Key { get; init; }
	public string? Type { get; init; } // "property", "chance", etc.
									   // Optional GENERIC landing behaviour ("ownable", "drawCard", "tax", "sendToHolding", "freeParking",
									   // "justVisiting", "start"). When null the engine derives it from Type/Key, so existing boards
									   // need no data changes; a package can give two same-typed squares different behaviours.
	public string? Behavior { get; init; }
	// Deck id a "drawCard" square pulls from. When null it defaults to Type (classic chance/community).
	public string? Deck { get; init; }
	public int SmallBuildings { get; set; } = 0;
	public int BigBuildings { get; set; } = 0;
	public List<string> Players { get; set; } = new();
	public bool Mortgaged { get; set; } = false;
	// Canonical rent table for "property" squares: [base, 1 smallBuilding, 2, 3, 4, bigBuilding].
	public List<int>? Rent { get; init; }
	// Cost to build a single smallBuilding (a bigBuilding costs the same as a 5th smallBuilding).
	public int? BuildingCost { get; init; }
}

public record SquareOwnership
{
	public int Index { get; init; }
	public required string OwnerId { get; init; }
}

/// <summary>
/// Pending purchase/auction state for a property
/// </summary>
public record PendingPurchase
{
	public required string PlayerId { get; init; }
	public required int SquareIndex { get; init; }
	public required string SquareName { get; init; }
	public required int Price { get; init; }
}

/// <summary>
/// Represents a bid in an auction
/// </summary>
public record AuctionBid
{
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public required int Amount { get; init; }
	public DateTime Timestamp { get; init; } = DateTime.UtcNow;
}

/// <summary>
/// Active auction state for a property
/// </summary>
public record AuctionState
{
	/// <summary>The square being auctioned</summary>
	public required int SquareIndex { get; init; }
	public required string SquareName { get; init; }

	/// <summary>Starting price (can be 1 in the standard rules)</summary>
	public int StartingPrice { get; init; } = 1;

	/// <summary>Current highest bid amount (0 if no bids)</summary>
	public int CurrentBid { get; set; } = 0;

	/// <summary>Current highest bidder (null if no bids)</summary>
	public string? HighestBidderId { get; set; }
	public string? HighestBidderName { get; set; }

	/// <summary>All bids placed in this auction</summary>
	public List<AuctionBid> Bids { get; set; } = new();

	/// <summary>Players who have passed (opted out of bidding)</summary>
	public HashSet<string> PassedPlayers { get; set; } = new();

	/// <summary>When the auction started</summary>
	public DateTime StartedAt { get; init; } = DateTime.UtcNow;

	/// <summary>Time per bid before auto-pass (10 seconds)</summary>
	public TimeSpan BidTimeout { get; init; } = TimeSpan.FromSeconds(10);

	/// <summary>When the current bid phase started (for timeout)</summary>
	public DateTime CurrentPhaseStartedAt { get; set; } = DateTime.UtcNow;

	/// <summary>The player who declined the purchase and triggered the auction</summary>
	public required string InitiatorPlayerId { get; init; }

	/// <summary>Whether auction is still active</summary>
	public bool IsActive { get; set; } = true;
}

/// <summary>
/// One side of a trade: the assets a single player puts on the table.
/// </summary>
public record TradeOffer
{
	/// <summary>Square indices of the properties being offered.</summary>
	public List<int> Properties { get; init; } = new();

	/// <summary>Cash being offered.</summary>
	public int Money { get; init; } = 0;

	/// <summary>Number of "Get out of holding free" cards being offered.</summary>
	public int ReleasePasses { get; init; } = 0;

	/// <summary>True when this side offers nothing at all.</summary>
	public bool IsEmpty => Properties.Count == 0 && Money == 0 && ReleasePasses == 0;
}

/// <summary>
/// A pending player-to-player trade. While one of these is active the game is frozen:
/// every state-mutating command is rejected except the response (accept / decline) by
/// the target and the cancellation by the initiator.
/// </summary>
public record TradeState
{
	public required string Id { get; init; }

	/// <summary>The player who proposed the trade (always the current turn holder).</summary>
	public required string InitiatorId { get; init; }
	public required string InitiatorName { get; init; }

	/// <summary>The player who must accept or decline.</summary>
	public required string TargetId { get; init; }
	public required string TargetName { get; init; }

	/// <summary>What the initiator gives away.</summary>
	public required TradeOffer Initiator { get; init; }

	/// <summary>What the target gives away (i.e. what the initiator requests).</summary>
	public required TradeOffer Target { get; init; }

	/// <summary>Whether the trade is still pending a response.</summary>
	public bool IsActive { get; set; } = true;
}

public record GameState
{
	/// <summary>The game family this state belongs to ("property" | "race"), so client and
	/// server pick the right rulebook/renderer. Defaults to the original family.</summary>
	public string GameType { get; set; } = "property";
	/// <summary>Race-family sub-state (pieces, pending piece choice, bonuses). Null otherwise.</summary>
	public RaceState? Race { get; set; }
	/// <summary>The race board definition (circuit/seats/safe squares), shipped to the client the
	/// way <see cref="Squares"/> is for the property family. Null otherwise.</summary>
	public Corro.RaceBoardDef? RaceBoard { get; set; }
	/// <summary>Track-family sub-state (each player's square). Null otherwise.</summary>
	public TrackState? Track { get; set; }
	/// <summary>The track board definition (length/grid/effects), shipped to the client. Null otherwise.</summary>
	public Corro.TrackBoardDef? TrackBoard { get; set; }
	/// <summary>Journey-family sub-state (hands, piles, kilometres). Null otherwise. HIDDEN
	/// INFORMATION lives here: it must only reach a client through JourneyFamily.ProjectFor.</summary>
	public JourneyState? Journey { get; set; }
	/// <summary>The journey deck catalog (card definitions), shipped to the client the way
	/// <see cref="Squares"/> is for the property family. Public — only hand/pile CONTENTS are secret.</summary>
	public List<Corro.JourneyCardDef>? JourneyDeck { get; set; }
	/// <summary>The journey rules in effect (goal, caps, scoring) — public config the client
	/// needs to compute playability and scale the progress strip. Persisted with the game.</summary>
	public Corro.JourneyRulesConfig? JourneyRules { get; set; }
	/// <summary>Assembly-family sub-state (hands, piles, racks). Null otherwise. HIDDEN
	/// INFORMATION lives here: it must only reach a client through AssemblyFamily.ProjectFor.</summary>
	public AssemblyState? Assembly { get; set; }
	/// <summary>The assembly deck catalog (card definitions), shipped to the client. Public —
	/// only hand/pile CONTENTS are secret.</summary>
	public List<Corro.AssemblyCardDef>? AssemblyDeck { get; set; }
	/// <summary>The assembly rules in effect (hand size, rack goal) — public config the client
	/// needs to compute playability. Persisted with the game.</summary>
	public Corro.AssemblyRulesConfig? AssemblyRules { get; set; }
	/// <summary>Draft-family sub-state (hands, picks, tables, scores). Null otherwise. HIDDEN
	/// INFORMATION lives here: it must only reach a client through DraftFamily.ProjectFor.</summary>
	public DraftState? Draft { get; set; }
	/// <summary>The draft deck catalog (card definitions), shipped to the client. Public —
	/// only hand/pick/pile CONTENTS are secret.</summary>
	public List<Corro.DraftCardDef>? DraftDeck { get; set; }
	/// <summary>The draft rules in effect (rounds, hand curve, race prizes) — public config
	/// the client needs for its scoreboard. Persisted with the game.</summary>
	public Corro.DraftRulesConfig? DraftRules { get; set; }
	/// <summary>Shedding-family sub-state (hands, piles, colour in force). Null otherwise.
	/// HIDDEN INFORMATION lives here: it must only reach a client through SheddingFamily.ProjectFor.</summary>
	public SheddingState? Shedding { get; set; }
	/// <summary>The shedding deck catalog (card definitions), shipped to the client. Public —
	/// only hand/pile CONTENTS are secret.</summary>
	public List<Corro.SheddingCardDef>? SheddingDeck { get; set; }
	/// <summary>The shedding rules in effect (hand size, target score) — public config the
	/// client needs to compute playability. Persisted with the game.</summary>
	public Corro.SheddingRulesConfig? SheddingRules { get; set; }
	/// <summary>Exploding-family sub-state (hands, the ordered draw pile, the pending Nope
	/// window). Null otherwise. HIDDEN INFORMATION lives here: the hands and the draw-pile
	/// order must only reach a client through ExplodingFamily.ProjectFor.</summary>
	public ExplodingState? Exploding { get; set; }
	/// <summary>The exploding deck catalog (card definitions), shipped to the client. Public —
	/// only hand and draw-pile CONTENTS are secret.</summary>
	public List<Corro.ExplodingCardDef>? ExplodingDeck { get; set; }
	/// <summary>The exploding rules in effect (hand size, defuses, see-future count, attack
	/// draws, nope window) — public config the client needs. Persisted with the game.</summary>
	public Corro.ExplodingRulesConfig? ExplodingRules { get; set; }
	/// <summary>The race rules in effect (exit/extra-roll die values, barriers, bonuses) —
	/// public config the client shows in the active-rules dialog. Null outside race.</summary>
	public Corro.RaceRulesConfig? RaceRules { get; set; }
	/// <summary>The track rules in effect (exact-finish behaviour, roll-again) — public config
	/// the client shows in the active-rules dialog. Null outside track.</summary>
	public Corro.TrackRulesConfig? TrackRules { get; set; }
	/// <summary>Trivia-family sub-state (wheel positions, wedges, pending question/judge/move).
	/// Null otherwise. HIDDEN INFORMATION lives here: a pending question's correct answer must only
	/// reach the judge through TriviaFamily.ProjectFor.</summary>
	public TriviaState? Trivia { get; set; }
	/// <summary>The trivia wheel board definition (spokes/ring/wedges), shipped to the client. Null otherwise.</summary>
	public Corro.TriviaBoardDef? TriviaBoard { get; set; }
	/// <summary>The resolved single-language question deck in shuffled deal order. Server-only —
	/// it carries the answers, so TriviaFamily.ProjectFor blanks it for clients.</summary>
	public List<Corro.TriviaQuestionDef>? TriviaDeck { get; set; }
	/// <summary>The trivia rules in effect (answer mode, judge mode, exact finish…) — public config
	/// the client needs for playability and the active-rules dialog. Null outside trivia.</summary>
	public Corro.TriviaRulesConfig? TriviaRules { get; set; }
	/// <summary>The property rules in effect (economy, holding, buildings) — public config the
	/// client shows in the active-rules dialog. Null outside the property family.</summary>
	public GameSettings? Settings { get; set; }

	public List<Player> Players { get; set; } = new();
	public List<SquareOwnership> Ownership { get; set; } = new();
	public string? CurrentTurn { get; set; }
	public BankInfo Bank { get; set; } = new();
	public List<Square> Squares { get; set; } = new();

	/// <summary>
	/// True once the current player has rolled the dice this turn. The turn never
	/// auto-advances: the player keeps control (buy, manage, trade) until they end the
	/// turn explicitly. Reset to false when the turn passes to the next player.
	/// </summary>
	public bool HasRolledThisTurn { get; set; } = false;

	/// <summary>
	/// True when the current player rolled doubles and therefore owes another roll
	/// before they may end their turn. Reset when they roll again (or the turn passes).
	/// </summary>
	public bool MustRollAgain { get; set; } = false;

	/// <summary>
	/// Consecutive doubles the current player has rolled this turn. A third consecutive
	/// double is "speeding" and sends them straight to holding. Reset on a non-double roll
	/// and whenever the turn passes (see <see cref="GameStateHelper.NextTurn"/>).
	/// </summary>
	public int ConsecutiveDoubles { get; set; } = 0;


	/// <summary>
	/// If not null, there is a pending purchase waiting for player decision
	/// </summary>
	public PendingPurchase? PendingPurchase { get; set; }

	/// <summary>
	/// If not null, there is an active auction in progress
	/// </summary>
	public AuctionState? ActiveAuction { get; set; }

	/// <summary>
	/// If not null, there is a pending player-to-player trade freezing the game
	/// until the target responds or the initiator cancels.
	/// </summary>
	public TradeState? ActiveTrade { get; set; }

	/// <summary>
	/// Active debts that must be resolved before game can continue
	/// </summary>
	public List<DebtState> PendingDebts { get; set; } = new();

	/// <summary>
	/// The game's card decks (deck id -> shuffled draw pile), seeded from the package's cards. Each
	/// board ships its own decks; there are no built-in Fortune / Treasury piles.
	/// </summary>
	public Dictionary<string, CardDeck> PackageDecks { get; set; } = new();

	/// <summary>
	/// The package's cards (generic effect + localized text), looked up by id when a package deck
	/// is drawn. Null/empty for classic games. Persisted so a restored game keeps its deck.
	/// </summary>
	public List<Corro.CardDef>? PackageCards { get; set; }

	/// <summary>
	/// The package's card decks (id + localized name), so the client labels the center piles with
	/// the package's deck names instead of the classic Fortune / Treasury. Empty for classic
	/// games (the client then falls back to the two built-in piles).
	/// </summary>
	public List<Corro.DeckDef> Decks { get; set; } = new();

	/// <summary>
	/// The board's localized name (from the package manifest), for the page title and any board
	/// label. Null for a built-in board (the client localizes the board id instead).
	/// </summary>
	public Dictionary<string, string>? BoardName { get; set; }

	/// <summary>
	/// The package's central brand text shown in the board centre (e.g. "CORRO"). Null for a
	/// built-in board (the client falls back to its own centre label).
	/// </summary>
	public string? CenterBrand { get; set; }

	/// <summary>
	/// The package's player tokens (id + inline SVG + i18n name key), so the board/panels render
	/// the package's tokens. Empty for a built-in board (the client uses its built-in token set).
	/// </summary>
	public List<Corro.TokenDef> Tokens { get; set; } = new();

	/// <summary>
	/// The package's groups (colour + i18n name key + optional board shortcut key), so the client
	/// builds the group-navigation shortcuts from the package instead of hardcoded colour keys.
	/// Empty for a built-in board.
	/// </summary>
	public List<Corro.GroupDef> Groups { get; set; } = new();

	/// <summary>
	/// The board's currency (symbol + code + localized name), so the client renders amounts in the
	/// board's money ("1500 ₡") instead of a hardcoded "€". Null for a built-in board.
	/// </summary>
	public Corro.Currency? Currency { get; set; }

	/// <summary>
	/// The board's names for the special corner spaces ("holding"/"freeparking"/"sendtoholding"/"start" ->
	/// localized text), so announcements and the help use the board's own words ("Agujero Negro")
	/// rather than a generic term. Empty for a built-in board (the client uses generic fallbacks).
	/// </summary>
	public Dictionary<string, string> Terminology { get; set; } = new();

	/// <summary>
	/// The board's building tiers (how many small make a big + their localized names), so the client
	/// labels build/sell actions and counts with the board's own words instead of "smallBuilding"/"bigBuilding".
	/// Null for a built-in board (the client uses generic fallbacks).
	/// </summary>
	public Corro.BuildingDef? Building { get; set; }

	/// <summary>
	/// True when the board wants the token to WALK to holding (animated hop) instead of teleporting there.
	/// Drives both the client's token movement and the phase of the holding announcement. Default false
	/// (teleport): the classic "go directly to holding" — the piece is placed in holding, no slide.
	/// </summary>
	public bool WalkToHolding { get; set; }

	/// <summary>
	/// Token of the uploaded .corro package backing this game (also the sound pack id the client
	/// requests). Null for a built-in board. Released when the game ends.
	/// </summary>
	public string? PackageToken { get; set; }

	/// <summary>
	/// Set once a single solvent player remains (everyone else is bankrupt). The board reads
	/// this to show the end screen, and the Hub uses it to mark the game finished, stop its
	/// timers and delete it from the server.
	/// </summary>
	public bool IsGameOver { get; set; } = false;

	/// <summary>The winning player's id / name, populated alongside <see cref="IsGameOver"/>.</summary>
	public string? WinnerId { get; set; }
	public string? WinnerName { get; set; }
}

// ============================================
// CARD DECK MODEL
// ============================================

/// <summary>
/// Represents a shuffled deck of cards (Fortune or Treasury).
/// Cards are drawn from the top and returned to the bottom.
/// "Get out of holding free" cards are held by players until used.
/// </summary>
public record CardDeck
{
	/// <summary>
	/// Card IDs in draw order (index 0 = top of deck)
	/// </summary>
	public List<string> Cards { get; set; } = new();

	/// <summary>
	/// Card IDs currently held by players (not in the deck)
	/// </summary>
	public List<string> HeldCards { get; set; } = new();

	/// <summary>
	/// Whether the deck has been initialized
	/// </summary>
	public bool IsInitialized { get; set; } = false;
}

/// <summary>
/// Reason for a debt
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum DebtReason
{
	Rent,
	Tax,
	Card,
	Holding,
	Other
}

/// <summary>
/// Represents a debt that a player owes to another player or the bank.
/// The game is blocked until all debts are resolved.
/// </summary>
public record DebtState
{
	/// <summary>Unique ID for this debt</summary>
	public required string Id { get; init; }

	/// <summary>Player who owes the debt</summary>
	public required string DebtorId { get; init; }
	public required string DebtorName { get; init; }

	/// <summary>Who receives the payment. "Bank" for bank debts</summary>
	public required string CreditorId { get; init; }
	public required string CreditorName { get; init; }

	/// <summary>Amount owed</summary>
	public required int Amount { get; init; }

	/// <summary>Why the debt was created</summary>
	public DebtReason Reason { get; init; }

	/// <summary>Description of the debt (e.g., property name, card text)</summary>
	public string? Description { get; init; }

	/// <summary>When the debt was created</summary>
	public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}

public record BankInfo
{
	public int Money { get; set; } = 15140; // Initial bank money
	public int FreeParkingPot { get; set; } = 0; // Money accumulated from taxes and fines
												 // Whether the Free Parking jackpot smallBuilding rule is active for this game. Sent to the client
												 // so the board only shows the centre pot when the rule actually feeds it (an empty pot
												 // under the active rule still shows "0"; with the rule off the pot is hidden entirely).
	public bool FreeParkingJackpot { get; set; } = false;
}

// DTOs for communication
public record BoardData
{
	public required string Name { get; init; }
	public int? Price { get; init; }
	public string? Color { get; init; }
	public string? Key { get; init; }
	public string? Owner { get; init; }
	public string? OwnerId { get; init; }
}

public record CardInfo
{
	public required string Id { get; init; }
	public required string Type { get; init; } // "chance" | "community"
	public required string TitleKey { get; init; } // translation key
	public required string DescriptionKey { get; init; } // translation key
}

/// <summary>
/// Pushed to clients when a Chance / Community card is drawn, so the UI can
/// reveal the card visually. Carries fully-resolved i18n keys + vars (including
/// the "game." prefix) so the client can translate without re-deriving anything.
/// </summary>
public record CardDrawnNotification
{
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public required string CardId { get; init; }
	public required string DeckType { get; init; } // "chance" | "community" | a package deck id
												   // Both classic and package cards reveal via translation keys (a package card's key resolves
												   // against the merged package i18n). Package cards have no title key.
	public string TitleKey { get; init; } = "";
	public string DescriptionKey { get; init; } = "";
	public Dictionary<string, object> DescriptionVars { get; init; } = new();
}

/// <summary>
/// When an announcement should be revealed on the client relative to a token's
/// movement animation. The client paces consequence reveal to the visible token hop:
/// <see cref="Move"/> lines fire immediately (they describe the cause — the dice roll),
/// while <see cref="Resolve"/> lines (the default — landing rent, taxes, cards…) are held
/// until the token finishes hopping to its destination. Actions without movement carry the
/// default <see cref="Resolve"/> phase and are revealed immediately (no hop to wait for).
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum AnnouncementPhase
{
	/// <summary>Cause of a movement (the dice roll); revealed immediately.</summary>
	Move,
	/// <summary>Consequence of landing; held until the token's hop animation settles.</summary>
	Resolve
}

/// <summary>
/// Announcement event with i18n key for frontend translation.
/// The backend sends keys, the frontend translates based on the user's language.
/// </summary>
public record AnnouncementEvent
{
	/// <summary>Translation key (e.g., "game.dice_rolled")</summary>
	public required string Key { get; init; }

	/// <summary>Variables for interpolation (e.g., { player: "John", total: 7 })</summary>
	public Dictionary<string, object> Vars { get; init; } = new();

	/// <summary>
	/// When the client should reveal this line relative to the token-hop animation.
	/// Defaults to <see cref="AnnouncementPhase.Resolve"/> (held until the hop settles).
	/// </summary>
	public AnnouncementPhase Phase { get; init; } = AnnouncementPhase.Resolve;
}

/// <summary>Who should receive an announcement within a game.</summary>
public enum AnnouncementAudience
{
	/// <summary>Every player in the game (default broadcast).</summary>
	All,
	/// <summary>Only the connections of <see cref="AnnouncementDispatch.PlayerId"/>.</summary>
	Player,
	/// <summary>Everyone except the connections of <see cref="AnnouncementDispatch.PlayerId"/>.</summary>
	AllExcept
}

/// <summary>
/// Internal routing envelope: the clean <see cref="AnnouncementEvent"/> plus the
/// audience it should reach. Only the <see cref="Event"/> is sent over the wire;
/// the audience is resolved on the server (the Hub maps it to SignalR clients).
/// </summary>
public record AnnouncementDispatch
{
	public required AnnouncementEvent Event { get; init; }

	public AnnouncementAudience Audience { get; init; } = AnnouncementAudience.All;

	/// <summary>Target player (Player) or excluded player (AllExcept); null for All.</summary>
	public string? PlayerId { get; init; }
}
