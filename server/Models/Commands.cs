using System.Text.Json.Serialization;

namespace CorroServer.Models;

// Base type for every game command.
public abstract record GameCommand
{
	public abstract string Type { get; }
	public required string PlayerId { get; init; }
	public DateTime Timestamp { get; init; } = DateTime.UtcNow;

	/// <summary>
	/// True for commands that may ONLY be executed by the player whose turn it currently is
	/// (dice roll, buy/decline on your own landing, end turn, or holding decisions).
	/// The server enforces this in <see cref="Services.Commands.CommandDispatcher"/> regardless
	/// of any client-side checks. Off-turn actions (auctions, property management, debt, queries)
	/// leave this false and rely on their own ownership/participation validation.
	/// </summary>
	public virtual bool RequiresTurn => false;

	/// <summary>
	/// True for commands that change game state. While a player-to-player trade is pending the
	/// game is frozen: state-mutating commands are rejected (except the trade response and
	/// cancellation, handled explicitly in <see cref="Services.Commands.CommandDispatcher"/>).
	/// Read-only queries (GET_*) set this to false so they keep working during the freeze.
	/// </summary>
	public virtual bool MutatesState => true;
}

// Specific commands
public record BuyPropertyCommand : GameCommand
{
	public override string Type => "BUY_PROPERTY";
	public override bool RequiresTurn => true;
	public int SquareIndex { get; init; }
}

public record EndTurnCommand : GameCommand
{
	public override string Type => "END_TURN";
	public override bool RequiresTurn => true;
}

public record RollDiceCommand : GameCommand
{
	public override string Type => "ROLL_DICE";
	public override bool RequiresTurn => true;
}

/// <summary>Race family: resolve the pending piece choice by picking which piece moves.</summary>
public record MoveRacePieceCommand : GameCommand
{
	public override string Type => "MOVE_RACE_PIECE";
	public override bool RequiresTurn => true;
	public required int PieceIndex { get; init; }
}

/// <summary>Trivia family: the host picks the judge before play begins (judgeMode "fixed").
/// NOT turn-bound — CurrentTurn is null until this resolves; the handler validates the caller
/// is the host who owes the choice.</summary>
public record TriviaChooseJudgeCommand : GameCommand
{
	public override string Type => "TRIVIA_CHOOSE_JUDGE";
	public required string JudgeId { get; init; }
}

/// <summary>Trivia family: after a roll, choose which legal square to land on (only the landing
/// matters, so the route is irrelevant).</summary>
public record TriviaMoveCommand : GameCommand
{
	public override string Type => "TRIVIA_MOVE";
	public override bool RequiresTurn => true;
	public required string Node { get; init; }
}

/// <summary>Trivia family: the active player's answer to the pending question. In "choice" mode
/// <see cref="Choice"/> is the picked option index; in the written modes <see cref="Text"/> is
/// the typed answer. The handler validates the caller owns the pending question.</summary>
public record TriviaAnswerCommand : GameCommand
{
	public override string Type => "TRIVIA_ANSWER";
	public string? Text { get; init; }
	public int Choice { get; init; } = -1;
}

/// <summary>Trivia family: the designated judge rules on the submitted answer ("judge" mode).
/// NOT turn-bound — the judge answers out of turn; the handler validates they are the pending
/// question's judge.</summary>
public record TriviaJudgeCommand : GameCommand
{
	public override string Type => "TRIVIA_JUDGE";
	public required bool Correct { get; init; }
}

/// <summary>Journey family: draw the top card (the start of your turn).</summary>
public record JourneyDrawCommand : GameCommand
{
	public override string Type => "JOURNEY_DRAW";
	public override bool RequiresTurn => true;
}

/// <summary>Journey family: play a card from your hand (attacks carry the victim).</summary>
public record JourneyPlayCommand : GameCommand
{
	public override string Type => "JOURNEY_PLAY";
	public override bool RequiresTurn => true;
	public required string InstanceId { get; init; }
	public string? TargetId { get; init; }
}

/// <summary>Journey family: discard instead of playing (the turn's other half).</summary>
public record JourneyDiscardCommand : GameCommand
{
	public override string Type => "JOURNEY_DISCARD";
	public override bool RequiresTurn => true;
	public required string InstanceId { get; init; }
}

/// <summary>Journey family: answer the coup fourré window. NOT turn-bound — the VICTIM
/// answers out of turn; the handler validates they are the pending coup's victim.</summary>
public record JourneyCoupCommand : GameCommand
{
	public override string Type => "JOURNEY_COUP";
	public required bool Accept { get; init; }
}

/// <summary>Assembly family: play a card. Targeting depends on the card: attacks and the
/// targeted specials carry the victim (+ their slot's colour); remedies carry the OWN
/// slot's colour; a piece swap adds the own slot offered (giveColor).</summary>
public record AssemblyPlayCommand : GameCommand
{
	public override string Type => "ASSEMBLY_PLAY";
	public override bool RequiresTurn => true;
	public required string InstanceId { get; init; }
	public string? TargetPlayerId { get; init; }
	public string? TargetColor { get; init; }
	public string? GiveColor { get; init; }
}

/// <summary>Assembly family: discard 1..MaxDiscard cards face-down — or ZERO with an empty
/// hand (the pass). The turn's alternative to playing.</summary>
public record AssemblyDiscardCommand : GameCommand
{
	public override string Type => "ASSEMBLY_DISCARD";
	public override bool RequiresTurn => true;
	public List<string> InstanceIds { get; init; } = new();
}

/// <summary>Draft family: commit (or replace) THIS trick's secret pick. NOT turn-bound —
/// the family is simultaneous: every seat picks at once and the server reveals when the
/// last one lands. The handler validates the card sits in the caller's current hand.</summary>
public record DraftPickCommand : GameCommand
{
	public override string Type => "DRAFT_PICK";
	public required string InstanceId { get; init; }

	/// <summary>Optional SECOND card of the trick — legal only with an "extra" card
	/// waiting on the picker's table (it pays for the double and rejoins the passing
	/// hand at the reveal). The FIRST card resolves first: multiplier-then-points in
	/// one double pick does boost, points-then-multiplier does not.</summary>
	public string? SecondInstanceId { get; init; }
}

/// <summary>Shedding family: play a matching card. Wilds carry the chosen colour.</summary>
public record SheddingPlayCommand : GameCommand
{
	public override string Type => "SHEDDING_PLAY";
	public override bool RequiresTurn => true;
	public required string InstanceId { get; init; }
	/// <summary>The colour a wild leaves in force (must be one of the deck's colours).</summary>
	public string? ChosenColor { get; init; }
	/// <summary>Further identical copies played alongside <see cref="InstanceId"/> in one go
	/// (the "doubles" house rule, number cards only). Empty/absent for a normal single play.</summary>
	public List<string>? ExtraInstanceIds { get; init; }
}

/// <summary>Shedding family: draw one card (the turn's alternative to playing). A
/// playable draw pauses the game on the drawer's play-it-or-keep-it choice.</summary>
public record SheddingDrawCommand : GameCommand
{
	public override string Type => "SHEDDING_DRAW";
	public override bool RequiresTurn => true;
}

/// <summary>Shedding family: keep the just-drawn card and pass the turn.</summary>
public record SheddingKeepCommand : GameCommand
{
	public override string Type => "SHEDDING_KEEP";
	public override bool RequiresTurn => true;
}

/// <summary>Shedding family: declare the last card. OFF-TURN — you declare
/// during the window after playing down to one card, which isn't your turn any more.</summary>
public record SheddingDeclareLastCardCommand : GameCommand
{
	public override string Type => "SHEDDING_DECLARE_LAST_CARD";
	public override bool RequiresTurn => false;
}

/// <summary>Shedding family: catch a rival who forgot the last-card declaration. OFF-TURN —
/// anyone but the exposed player may call it, until the next player acts.</summary>
public record SheddingCatchLastCardCommand : GameCommand
{
	public override string Type => "SHEDDING_CATCH_LAST_CARD";
	public override bool RequiresTurn => false;
}

/// <summary>Exploding family: play an action card on your turn (skip / attack / shuffle /
/// seeFuture / favor / a cat pair). It does not resolve at once — it opens the real-time Nope
/// window.</summary>
public record ExplodingPlayCommand : GameCommand
{
	public override string Type => "EXPLODING_PLAY";
	public override bool RequiresTurn => true;
	public required string InstanceId { get; init; }
	/// <summary>The chosen target, for Favor and cat-pair steals. Null for the un-targeted actions.</summary>
	public string? TargetId { get; init; }
	/// <summary>The second, matching cat of a pair (steal). Null for every other play.</summary>
	public string? SecondInstanceId { get; init; }
}

/// <summary>Exploding family: as the target of a Favor, give the requester a card of your choice.
/// OFF-TURN — it is the requester's turn, not the giver's.</summary>
public record ExplodingGiveCommand : GameCommand
{
	public override string Type => "EXPLODING_GIVE";
	public override bool RequiresTurn => false;
	public required string InstanceId { get; init; }
}

/// <summary>Exploding family: play a Nope. OFF-TURN — the only out-of-turn card — it cancels
/// the pending action and restarts its suspense window (a Nope can itself be Noped).</summary>
public record ExplodingNopeCommand : GameCommand
{
	public override string Type => "EXPLODING_NOPE";
	public override bool RequiresTurn => false;
	public required string InstanceId { get; init; }
}

/// <summary>Exploding family: draw the top card to end your turn — the moment of danger.</summary>
public record ExplodingDrawCommand : GameCommand
{
	public override string Type => "EXPLODING_DRAW";
	public override bool RequiresTurn => true;
}

/// <summary>Exploding family: after drawing a bomb you hold a Defuse for, tuck the bomb back
/// into the draw pile at a secret depth (<see cref="Depth"/> = cards left above it: 0 = top).</summary>
public record ExplodingDefuseCommand : GameCommand
{
	public override string Type => "EXPLODING_DEFUSE";
	public override bool RequiresTurn => true;
	public required int Depth { get; init; }
}

/// <summary>Exploding family: resolve the pending action now its Nope window has elapsed. Fired
/// by the server's window timer (not a player), so it is never turn-bound.</summary>
public record ExplodingResolveWindowCommand : GameCommand
{
	public override string Type => "EXPLODING_RESOLVE_WINDOW";
	public override bool RequiresTurn => false;
}

public record PlaceBidCommand : GameCommand
{
	public override string Type => "PLACE_BID";
	public int SquareIndex { get; init; }
	public int Amount { get; init; }
}

public record PassAuctionCommand : GameCommand
{
	public override string Type => "PASS_AUCTION";
	public int SquareIndex { get; init; }
}

/// <summary>
/// Command to end an auction due to timeout.
/// This is typically called by the timer service, not by players directly.
/// </summary>
public record EndAuctionCommand : GameCommand
{
	public override string Type => "END_AUCTION";
	/// <summary>Reason for ending: "timeout" or "all_passed"</summary>
	public string Reason { get; init; } = "timeout";
}

public record GetMoneyCommand : GameCommand
{
	public override string Type => "GET_MONEY";
	public override bool MutatesState => false;
}

public record GetReleasePassesCommand : GameCommand
{
	public override string Type => "GET_RELEASE_PASSES";
	public override bool MutatesState => false;
}

public record PayReleaseCostCommand : GameCommand
{
	public override string Type => "PAY_HOLDING_RELEASE_COST";
	public override bool RequiresTurn => true;
}

public record UseReleasePassCommand : GameCommand
{
	public override string Type => "USE_RELEASE_PASS";
	public override bool RequiresTurn => true;
}

public record AnnounceTurnCommand : GameCommand
{
	public override string Type => "ANNOUNCE_TURN";
	public override bool MutatesState => false;
}

// ============================================
// PROPERTY MANAGEMENT COMMANDS
// ============================================

public record MortgagePropertyCommand : GameCommand
{
	public override string Type => "MORTGAGE_PROPERTY";
	public int SquareIndex { get; init; }
}

public record UnmortgagePropertyCommand : GameCommand
{
	public override string Type => "UNMORTGAGE_PROPERTY";
	public int SquareIndex { get; init; }
}

public record SellBuildingsCommand : GameCommand
{
	public override string Type => "SELL_BUILDINGS";
	public int SquareIndex { get; init; }
	public int Count { get; init; } = 1;
}

public record BuildCommand : GameCommand
{
	public override string Type => "BUILD";
	public int SquareIndex { get; init; }
	public int Count { get; init; } = 1;
}

// ============================================
// DEBT & BANKRUPTCY COMMANDS
// ============================================

public record ResolveDebtCommand : GameCommand
{
	public override string Type => "RESOLVE_DEBT";
	/// <summary>Specific debt ID to resolve, or null to resolve all</summary>
	public string? DebtId { get; init; }
}

public record DeclareBankruptcyCommand : GameCommand
{
	public override string Type => "DECLARE_BANKRUPTCY";
}

public record GetDebtStatusCommand : GameCommand
{
	public override string Type => "GET_DEBT_STATUS";
	public override bool MutatesState => false;
}

// ============================================
// TRADE COMMANDS
// ============================================

/// <summary>
/// Propose a player-to-player trade. Only the current turn holder may propose, and only
/// when no trade is already pending. Each side may include properties, cash and release passes.
/// </summary>
public record ProposeTradeCommand : GameCommand
{
	public override string Type => "PROPOSE_TRADE";

	// Proposing is a turn action: you may only start a trade on your own turn.
	public override bool RequiresTurn => true;

	/// <summary>The player being asked to trade.</summary>
	public required string TargetPlayerId { get; init; }

	/// <summary>Properties the proposer gives away.</summary>
	public List<int> OfferedProperties { get; init; } = new();

	/// <summary>Cash the proposer gives away.</summary>
	public int OfferedMoney { get; init; } = 0;

	/// <summary>Holding cards the proposer gives away.</summary>
	public int OfferedReleasePasses { get; init; } = 0;

	/// <summary>Properties the proposer requests from the target.</summary>
	public List<int> RequestedProperties { get; init; } = new();

	/// <summary>Cash the proposer requests from the target.</summary>
	public int RequestedMoney { get; init; } = 0;

	/// <summary>Holding cards the proposer requests from the target.</summary>
	public int RequestedReleasePasses { get; init; } = 0;
}

/// <summary>
/// The target's response to a pending trade. Accept executes the swap, decline discards it.
/// Allowed during the trade freeze (handled explicitly by the dispatcher).
/// </summary>
public record RespondTradeCommand : GameCommand
{
	public override string Type => "RESPOND_TRADE";
	public required string TradeId { get; init; }
	public required bool Accept { get; init; }
}

/// <summary>
/// The initiator cancels their own pending trade. Allowed during the trade freeze.
/// </summary>
public record CancelTradeCommand : GameCommand
{
	public override string Type => "CANCEL_TRADE";
	public string? TradeId { get; init; }
}

// Server responses.
public abstract record ServerResponse
{
	public abstract string Type { get; }
	public DateTime Timestamp { get; init; } = DateTime.UtcNow;
}

/// <summary>Race family: outcome of a die roll (the move itself may need a piece choice).</summary>
public record RaceRollResponse : ServerResponse
{
	public override string Type => "RACE_ROLL";
	public required int Value { get; init; }
	/// <summary>True when the player must choose a piece (state carries the pending options).</summary>
	public bool RequiresChoice { get; init; }
	/// <summary>True when the roll grants another roll (the extra-roll value).</summary>
	public bool RollAgain { get; init; }
	public bool TurnEnded { get; init; }
}

/// <summary>Track family: outcome of a die roll (walk + landing effects, no choices).</summary>
public record TrackRollResponse : ServerResponse
{
	public override string Type => "TRACK_ROLL";
	public required int Value { get; init; }
	/// <summary>True when the roll grants another roll (the roll-again variant).</summary>
	public bool RollAgain { get; init; }
	public bool TurnEnded { get; init; }
}

/// <summary>Trivia family: outcome of a roll/move/answer/judge/choose-judge action.</summary>
public record TriviaActionResponse : ServerResponse
{
	public override string Type => "TRIVIA_ACTION";
	/// <summary>"choose_judge" | "roll" | "move" | "answer" | "judge".</summary>
	public required string Action { get; init; }
	/// <summary>True when the roll grants another roll (a correct answer or a roll-again square).</summary>
	public bool RollAgain { get; init; }
	public bool TurnEnded { get; init; }
	public bool GameEnded { get; init; }
}

/// <summary>Journey family: outcome of a draw/play/discard/coup action.</summary>
public record JourneyActionResponse : ServerResponse
{
	public override string Type => "JOURNEY_ACTION";
	/// <summary>"draw" | "play" | "discard" | "coup".</summary>
	public required string Action { get; init; }
	/// <summary>True when the action ended the hand (scores were announced; maybe the match too).</summary>
	public bool HandEnded { get; init; }
	public bool TurnEnded { get; init; }
}

/// <summary>Assembly family: outcome of a play/discard/pass action.</summary>
public record AssemblyActionResponse : ServerResponse
{
	public override string Type => "ASSEMBLY_ACTION";
	/// <summary>"play" | "discard" | "pass".</summary>
	public required string Action { get; init; }
	/// <summary>True when the play completed the rack and ended the game.</summary>
	public bool GameEnded { get; init; }
	public bool TurnEnded { get; init; }
}

/// <summary>Draft family: outcome of a pick commit.</summary>
public record DraftActionResponse : ServerResponse
{
	public override string Type => "DRAFT_ACTION";
	/// <summary>"pick" (committed, waiting) | "repick" (replaced the earlier pick).</summary>
	public required string Action { get; init; }
	/// <summary>True when this pick was the last one and the trick was revealed.</summary>
	public bool Revealed { get; init; }
	/// <summary>True when the reveal emptied the hands and the round was scored.</summary>
	public bool RoundEnded { get; init; }
	/// <summary>True when that was the final round: desserts scored, game over.</summary>
	public bool GameEnded { get; init; }
}

/// <summary>Shedding family: outcome of a play/draw/keep action.</summary>
public record SheddingActionResponse : ServerResponse
{
	public override string Type => "SHEDDING_ACTION";
	/// <summary>"play" | "draw" | "keep".</summary>
	public required string Action { get; init; }
	/// <summary>False while the game pauses on the drawer's play-it-or-keep-it choice.</summary>
	public bool TurnEnded { get; init; }
	/// <summary>True when the play emptied the hand and the round was scored.</summary>
	public bool RoundEnded { get; init; }
	/// <summary>True when that crossed the target score: match over.</summary>
	public bool GameEnded { get; init; }
}

/// <summary>Exploding family: the outcome of an action / draw / nope / defuse.</summary>
public record ExplodingActionResponse : ServerResponse
{
	public override string Type => "EXPLODING_ACTION";
	/// <summary>"play" | "nope" | "resolve" | "draw" | "defuse".</summary>
	public required string Action { get; init; }
	/// <summary>True while an action sits in its Nope window (awaiting resolution).</summary>
	public bool WindowOpen { get; init; }
	/// <summary>True when the turn passed to the next player.</summary>
	public bool TurnEnded { get; init; }
	/// <summary>True while the game waits for the drawer to tuck a defused bomb back.</summary>
	public bool AwaitingReinsert { get; init; }
	/// <summary>True when the drawer had no Defuse and was knocked out.</summary>
	public bool Exploded { get; init; }
	/// <summary>True when only one player remained: the game is over.</summary>
	public bool GameEnded { get; init; }
}

/// <summary>Race family: a pending piece choice was resolved.</summary>
public record RaceMoveResponse : ServerResponse
{
	public override string Type => "RACE_MOVE";
	public required int PieceIndex { get; init; }
}

public record ErrorResponse : ServerResponse
{
	public override string Type => "ERROR";
	public required string Message { get; init; }
	public required string Code { get; init; }
}

public record PlayerMoneyResponse : ServerResponse
{
	public override string Type => "PLAYER_MONEY";
	public required string PlayerId { get; init; }
	public int Amount { get; init; }
}

public record PlayerReleasePassesResponse : ServerResponse
{
	public override string Type => "PLAYER_RELEASE_PASSES";
	public required string PlayerId { get; init; }
	public int Count { get; init; }
}

public record ReleaseCostPaidResponse : ServerResponse
{
	public override string Type => "HOLDING_RELEASE_COST_PAID";
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public int Amount { get; init; }
}

public record ReleasePassUsedResponse : ServerResponse
{
	public override string Type => "RELEASE_PASS_USED";
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public int CardsRemaining { get; init; }
}

public record TurnAnnouncementResponse : ServerResponse
{
	public override string Type => "TURN_ANNOUNCEMENT";
	public string? CurrentPlayer { get; init; }
}

/// <summary>
/// Response when the player declines to buy and auction starts
/// </summary>
public record PropertyDeclinedResponse : ServerResponse
{
	public override string Type => "PROPERTY_DECLINED";
	public required string PlayerId { get; init; }
	public required int SquareIndex { get; init; }
	public required string SquareName { get; init; }
	public bool AuctionStarted { get; init; }
	public string? NextPlayerId { get; init; }
	public string? NextPlayerName { get; init; }
}

/// <summary>
/// Response when a property is successfully purchased
/// </summary>
public record PropertyPurchasedResponse : ServerResponse
{
	public override string Type => "PROPERTY_PURCHASED";
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public required int SquareIndex { get; init; }
	public required string SquareName { get; init; }
	public required int Price { get; init; }
	public required int RemainingMoney { get; init; }
	public string? NextPlayerId { get; init; }
	public string? NextPlayerName { get; init; }
}

public record DiceRolledResponse : ServerResponse
{
	public override string Type => "DICE_ROLLED";
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public int Die1 { get; init; }
	public int Die2 { get; init; }
	public int Total { get; init; }
	public bool IsDoubles { get; init; }
	public int FromPosition { get; init; }
	public int ToPosition { get; init; }
	public string? NextPlayerId { get; init; }
	public string? NextPlayerName { get; init; }

	// Destination square information
	public string? SquareName { get; init; }
	public int? SquarePrice { get; init; }
	public bool CanBuySquare { get; init; }

	// Can player afford to buy?
	public bool CanAfford { get; init; }

	// Holding-related fields
	public bool ReleasedFromHolding { get; init; } = false;
	public bool StillHeld { get; init; } = false;
	public int HoldingTurnsRemaining { get; init; } = 0;
	public bool PaidReleaseCost { get; init; } = false;
	public int ReleaseCostAmount { get; init; } = 0;
}

// ============================================
// AUCTION RESPONSES
// ============================================

/// <summary>
/// Sent when an auction starts for a property
/// </summary>
public record AuctionStartedResponse : ServerResponse
{
	public override string Type => "AUCTION_STARTED";
	public required int SquareIndex { get; init; }
	public required string SquareName { get; init; }
	public int StartingPrice { get; init; } = 1;
	public required string InitiatorPlayerId { get; init; }
	public required string InitiatorPlayerName { get; init; }
	public int BidTimeoutSeconds { get; init; } = 20;
}

/// <summary>
/// Sent when a bid is placed in an auction
/// </summary>
public record BidPlacedResponse : ServerResponse
{
	public override string Type => "BID_PLACED";
	public required int SquareIndex { get; init; }
	public required string SquareName { get; init; }
	public required string BidderId { get; init; }
	public required string BidderName { get; init; }
	public required int Amount { get; init; }
	public int BidTimeoutSeconds { get; init; } = 20;
}

/// <summary>
/// Sent when a player passes on an auction
/// </summary>
public record AuctionPassedResponse : ServerResponse
{
	public override string Type => "AUCTION_PASSED";
	public required int SquareIndex { get; init; }
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public int RemainingBidders { get; init; }
}

/// <summary>
/// Sent when an auction ends (someone won or no bids)
/// </summary>
public record AuctionEndedResponse : ServerResponse
{
	public override string Type => "AUCTION_ENDED";
	public required int SquareIndex { get; init; }
	public required string SquareName { get; init; }
	public string? WinnerId { get; init; }
	public string? WinnerName { get; init; }
	public int? WinningBid { get; init; }
	public bool PropertySold { get; init; }
	public string? NextPlayerId { get; init; }
	public string? NextPlayerName { get; init; }
}

// ============================================
// DEBT & BANKRUPTCY RESPONSES
// ============================================

/// <summary>
/// Sent when a debt is resolved
/// </summary>
public record DebtResolvedResponse : ServerResponse
{
	public override string Type => "DEBT_RESOLVED";
	public required string DebtId { get; init; }
	public required string DebtorId { get; init; }
	public required string DebtorName { get; init; }
	public string? CreditorId { get; init; }
	public string? CreditorName { get; init; }
	public required int Amount { get; init; }
	public int RemainingDebts { get; init; }
}

/// <summary>
/// Sent when a property is mortgaged
/// </summary>
public record PropertyMortgagedResponse : ServerResponse
{
	public override string Type => "PROPERTY_MORTGAGED";
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public required int SquareIndex { get; init; }
	public required string SquareName { get; init; }
	public required int AmountReceived { get; init; }
	public int PlayerMoney { get; init; }
	public int RemainingDebt { get; init; }
}

/// <summary>
/// Sent when a property is unmortgaged
/// </summary>
public record PropertyUnmortgagedResponse : ServerResponse
{
	public override string Type => "PROPERTY_UNMORTGAGED";
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public required int SquareIndex { get; init; }
	public required string SquareName { get; init; }
	public required int AmountPaid { get; init; }
	public int PlayerMoney { get; init; }
}

/// <summary>
/// Sent when smallBuildings are sold
/// </summary>
public record BuildingsSoldResponse : ServerResponse
{
	public override string Type => "BUILDINGS_SOLD";
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public required int SquareIndex { get; init; }
	public required string SquareName { get; init; }
	public required int Count { get; init; }
	public required int AmountReceived { get; init; }
	public int RemainingBuildings { get; init; }
	public int PlayerMoney { get; init; }
	public int RemainingDebt { get; init; }
}

/// <summary>
/// Sent when one or more smallBuildings (or a bigBuilding) are built
/// </summary>
public record BuildingBuiltResponse : ServerResponse
{
	public override string Type => "BUILDING_BUILT";
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public required int SquareIndex { get; init; }
	public required string SquareName { get; init; }
	public required int Count { get; init; }
	public required int AmountSpent { get; init; }
	public int SmallBuildings { get; init; }
	public int BigBuildings { get; init; }
	public int PlayerMoney { get; init; }
}

/// <summary>
/// Sent when a player goes bankrupt
/// </summary>
public record BankruptcyResponse : ServerResponse
{
	public override string Type => "BANKRUPTCY";
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public string? BeneficiaryId { get; init; }
	public string? BeneficiaryName { get; init; }
	public List<int> PropertiesTransferred { get; init; } = new();
	public List<int> PropertiesToAuction { get; init; } = new();
	public int CashTransferred { get; init; }
	public int RemainingPlayers { get; init; }
	public bool GameOver { get; init; }
	public string? WinnerId { get; init; }
	public string? WinnerName { get; init; }
}

/// <summary>
/// Response with current debt status for a player
/// </summary>
public record DebtStatusResponse : ServerResponse
{
	public override string Type => "DEBT_STATUS";
	public required string PlayerId { get; init; }
	public required string PlayerName { get; init; }
	public int TotalDebt { get; init; }
	public int Cash { get; init; }
	public int MortgageableValue { get; init; }
	public int BuildingSaleValue { get; init; }
	public int TotalAssets { get; init; }
	public bool CanPayDebt { get; init; }
	public bool IsBankrupt { get; init; }
	public List<DebtState> Debts { get; init; } = new();
	public List<MortgageablePropertyDto> MortgageableProperties { get; init; } = new();
}

public record MortgageablePropertyDto
{
	public required int SquareIndex { get; init; }
	public required string Name { get; init; }
	public required int MortgageValue { get; init; }
	public string? Color { get; init; }
}

// ============================================
// TRADE RESPONSES / DTOs
// ============================================

/// <summary>A property reference carried in a trade response (index + display name).</summary>
public record TradePropertyDto
{
	public required int Index { get; init; }
	public required string Name { get; init; }
	public string? Color { get; init; }
	/// <summary>i18n key for the square's group name, so the UI shows the group name (not the raw hex).</summary>
	public string? GroupNameKey { get; init; }
	/// <summary>Purchase price, so the review shows each property's worth in the board's currency.</summary>
	public int? Price { get; init; }
}

/// <summary>One side of a trade, expanded with display data for the UI.</summary>
public record TradeSideDto
{
	public List<TradePropertyDto> Properties { get; init; } = new();
	public int Money { get; init; }
	public int ReleasePasses { get; init; }
}

/// <summary>
/// Broadcast to the whole group when a trade is proposed, so the target can review it.
/// Carries enough display data to render both sides without extra lookups.
/// </summary>
public record TradeProposedResponse : ServerResponse
{
	public override string Type => "TRADE_PROPOSED";
	public required string TradeId { get; init; }
	public required string InitiatorId { get; init; }
	public required string InitiatorName { get; init; }
	public required string TargetId { get; init; }
	public required string TargetName { get; init; }

	/// <summary>What the initiator gives away.</summary>
	public required TradeSideDto Offered { get; init; }

	/// <summary>What the target gives away (what the initiator requests).</summary>
	public required TradeSideDto Requested { get; init; }
}

/// <summary>
/// Broadcast to the whole group when a pending trade is resolved (accepted, declined or
/// cancelled), so every client can dismiss the trade UI and unfreeze.
/// </summary>
public record TradeResolvedResponse : ServerResponse
{
	public override string Type => "TRADE_RESOLVED";
	public required string TradeId { get; init; }

	/// <summary>"accepted", "declined" or "cancelled".</summary>
	public required string Outcome { get; init; }
	public required string InitiatorId { get; init; }
	public required string TargetId { get; init; }
}
