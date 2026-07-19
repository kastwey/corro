using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

/// <summary>
/// Result of processing a dice roll through the rulebook.
/// Contains all information needed to build the response.
/// </summary>
public record DiceRollOutcome
{
	// Dice information
	public int Die1 { get; init; }
	public int Die2 { get; init; }
	public int Total { get; init; }
	public bool IsDoubles { get; init; }

	// Movement
	public int FromPosition { get; init; }
	public int ToPosition { get; init; }

	// Turn information
	public string? NextPlayerId { get; init; }
	public string? NextPlayerName { get; init; }

	// Landing information
	public string? SquareName { get; init; }
	public int? SquarePrice { get; init; }
	public bool CanBuySquare { get; init; }
	public bool CanAfford { get; init; }

	// Holding
	public bool ReleasedFromHolding { get; init; }
	public bool StillHeld { get; init; }
	public int HoldingTurnsRemaining { get; init; }
	public bool PaidReleaseCost { get; init; }
	public int ReleaseCostAmount { get; init; }

	/// <summary>
	/// Convert to the response DTO.
	/// </summary>
	public DiceRolledResponse ToResponse(string playerId, string playerName)
	{
		return new DiceRolledResponse
		{
			PlayerId = playerId,
			PlayerName = playerName,
			Die1 = Die1,
			Die2 = Die2,
			Total = Total,
			IsDoubles = IsDoubles,
			FromPosition = FromPosition,
			ToPosition = ToPosition,
			NextPlayerId = NextPlayerId,
			NextPlayerName = NextPlayerName,
			SquareName = SquareName,
			SquarePrice = SquarePrice,
			CanBuySquare = CanBuySquare,
			CanAfford = CanAfford,
			ReleasedFromHolding = ReleasedFromHolding,
			StillHeld = StillHeld,
			HoldingTurnsRemaining = HoldingTurnsRemaining,
			PaidReleaseCost = PaidReleaseCost,
			ReleaseCostAmount = ReleaseCostAmount
		};
	}
}

/// <summary>
/// The Corro Rulebook - central authority for all game rules.
/// This is the single source of truth for how the game works.
/// </summary>
public interface ICorroRulebook
{
	// ============================================================
	// DICE & MOVEMENT
	// ============================================================

	/// <summary>
	/// Process a dice roll for a player, applying all relevant rules.
	/// </summary>
	Task<DiceRollOutcome> ProcessDiceRollAsync(Player player, GameContext context);

	/// <summary>One 1..6 die from the game's randomness source (the race family rolls a single
	/// die; sharing the source keeps E2E dice scripting working across families).</summary>
	int RollSingleDie();

	/// <summary>The game's randomness source itself, for families that shuffle piles (journey
	/// decks). Sharing it keeps the E2E environment deterministic: its scripted source
	/// shuffles as the identity, so decks keep their cards.json order there too.</summary>
	IRandomSource RandomSource { get; }

	/// <summary>
	/// Process landing effects when a player lands on a square.
	/// </summary>
	Task ProcessLandingEffectsAsync(Player player, int squareIndex, GameContext context);

	// ============================================================
	// PROPERTY PURCHASE
	// ============================================================

	/// <summary>
	/// Buy a property for the current player.
	/// </summary>
	Task<PropertyPurchaseOutcome> BuyPropertyAsync(Player player, int squareIndex, GameContext context);

	/// <summary>
	/// Decline to buy a property (triggers auction).
	/// </summary>
	Task<PropertyDeclineOutcome> DeclinePropertyAsync(Player player, int squareIndex, GameContext context);

	// ============================================================
	// HOLDING
	// ============================================================

	/// <summary>
	/// Pay the release cost to get out of holding.
	/// </summary>
	Task<HoldingOutcome> PayReleaseCostAsync(Player player, GameContext context);

	/// <summary>
	/// Use a release pass.
	/// </summary>
	Task<HoldingOutcome> UseReleasePassAsync(Player player, GameContext context);

	// ============================================================
	// PROPERTY MANAGEMENT
	// ============================================================

	/// <summary>
	/// Mortgage a property.
	/// </summary>
	Task<PropertyManagementOutcome> MortgagePropertyAsync(Player player, int squareIndex, GameContext context);

	/// <summary>
	/// Unmortgage a property.
	/// </summary>
	Task<PropertyManagementOutcome> UnmortgagePropertyAsync(Player player, int squareIndex, GameContext context);

	/// <summary>
	/// Build a smallBuilding on a property.
	/// </summary>
	Task<PropertyManagementOutcome> BuildAsync(Player player, int squareIndex, GameContext context);

	/// <summary>
	/// Sell a smallBuilding from a property.
	/// </summary>
	Task<PropertyManagementOutcome> SellBuildingAsync(Player player, int squareIndex, GameContext context);

	// ============================================================
	// TRADING
	// ============================================================

	/// <summary>
	/// Propose a player-to-player trade. Validates the offer and, if valid, records it as the
	/// pending trade that freezes the game until it is resolved.
	/// </summary>
	Task<TradeOutcome> ProposeTradeAsync(TradeState trade, GameContext context);

	/// <summary>
	/// The target accepts the pending trade: validates again and atomically swaps the assets.
	/// </summary>
	Task<TradeOutcome> AcceptTradeAsync(string responderId, string tradeId, GameContext context);

	/// <summary>
	/// The target declines the pending trade: discards it without changing assets.
	/// </summary>
	Task<TradeOutcome> DeclineTradeAsync(string responderId, string tradeId, GameContext context);

	/// <summary>
	/// The initiator cancels their own pending trade.
	/// </summary>
	Task<TradeOutcome> CancelTradeAsync(string initiatorId, string? tradeId, GameContext context);

	// ============================================================
	// DEBT & BANKRUPTCY
	// ============================================================

	/// <summary>
	/// Attempt to resolve a debt.
	/// </summary>
	Task<DebtOutcome> ResolveDebtAsync(Player player, string? debtId, GameContext context);

	/// <summary>
	/// After a command settles, auto-resolve any debts that became payable from cash the
	/// debtor GAINED during it (rent received, card collection, GO salary, mortgage/sale
	/// proceeds). Only liquid cash is used — assets are never auto-sold. Resolving one
	/// debt credits its creditor, who is re-checked in the same sweep.
	/// </summary>
	Task SweepResolvableDebtsAsync(GameContext context);

	/// <summary>
	/// Declare bankruptcy.
	/// </summary>
	Task<BankruptcyOutcome> DeclareBankruptcyAsync(Player player, GameContext context);

	/// <summary>
	/// The most a player could raise by liquidating everything: cash + mortgage value of
	/// unmortgaged building-free properties + resale value of every smallBuilding/bigBuilding. Used to
	/// detect insolvency (assets &lt; debt) and shared with the debt-status query so the
	/// figure shown to the player matches the one that triggers forced bankruptcy.
	/// </summary>
	int GetLiquidatableAssets(Player player, GameContext context);

	/// <summary>Half the build cost of every smallBuilding/bigBuilding on a square (a bigBuilding = 5 smallBuildings).</summary>
	int GetBuildingSaleValue(Square square, GameSettings? settings = null);

	// ============================================================
	// TURN MANAGEMENT
	// ============================================================

	/// <summary>
	/// End the current player's turn.
	/// </summary>
	Task<TurnOutcome> EndTurnAsync(Player player, GameContext context);

	// ============================================================
}

// ============================================================
// OUTCOME RECORDS
// ============================================================

/// <summary>
/// The shared success/error shape every fallible rulebook outcome carries, so command handlers can map
/// a failure to an <c>ErrorResponse</c> uniformly (see <c>CommandOutcomeExtensions.AsError</c>) instead
/// of repeating the same check per handler.
/// </summary>
public interface IOutcome
{
	bool Success { get; }
	string? Error { get; }
	string? ErrorCode { get; }
}

public record PropertyPurchaseOutcome : IOutcome
{
	public bool Success { get; init; }
	public string? Error { get; init; }
	public string? ErrorCode { get; init; }
	public int SquareIndex { get; init; }
	public string? SquareName { get; init; }
	public int Price { get; init; }
	public int RemainingMoney { get; init; }
}

public record PropertyDeclineOutcome : IOutcome
{
	public bool Success { get; init; }
	public string? Error { get; init; }
	public string? ErrorCode { get; init; }
	public int SquareIndex { get; init; }
	public string? SquareName { get; init; }
	public bool AuctionStarted { get; init; }
}

public record HoldingOutcome : IOutcome
{
	public bool Success { get; init; }
	public string? Error { get; init; }
	public string? ErrorCode { get; init; }
	public bool Released { get; init; }
	public int? AmountPaid { get; init; }
	public int? CardsRemaining { get; init; }
}

public record PropertyManagementOutcome : IOutcome
{
	public bool Success { get; init; }
	public string? Error { get; init; }
	public string? ErrorCode { get; init; }
	public int SquareIndex { get; init; }
	public string? SquareName { get; init; }
	public int AmountChanged { get; init; }
	public int PlayerMoney { get; init; }
	public int RemainingDebt { get; init; }
}

public record TradeOutcome : IOutcome
{
	public bool Success { get; init; }
	public string? Error { get; init; }
	public string? ErrorCode { get; init; }

	/// <summary>The trade involved (still set on failure when it could be located).</summary>
	public TradeState? Trade { get; init; }

	/// <summary>"proposed", "accepted", "declined" or "cancelled".</summary>
	public string Outcome { get; init; } = string.Empty;
}

public record DebtOutcome : IOutcome
{
	public bool Success { get; init; }
	public string? Error { get; init; }
	public string? ErrorCode { get; init; }
	public string? DebtId { get; init; }
	public int AmountPaid { get; init; }
	public string? CreditorName { get; init; }
	public int RemainingDebts { get; init; }
}

public record BankruptcyOutcome
{
	public bool Success { get; init; }
	/// <summary>The creditor who received the bankrupt's assets ("Bank" or a player id/name).</summary>
	public string? BeneficiaryId { get; init; }
	public string? BeneficiaryName { get; init; }
	/// <summary>Properties handed to a player creditor (empty when the beneficiary is the bank).</summary>
	public List<int> PropertiesTransferred { get; init; } = new();
	/// <summary>Properties returned to the bank (empty when a player creditor took them).</summary>
	public List<int> PropertiesToAuction { get; init; } = new();
	/// <summary>Cash handed to the beneficiary (player creditor or bank).</summary>
	public int CashTransferred { get; init; }
	public int RemainingPlayers { get; init; }
	public bool GameOver { get; init; }
	public string? WinnerId { get; init; }
	public string? WinnerName { get; init; }
}

public record TurnOutcome
{
	public bool Success { get; init; }
	public string? NextPlayerId { get; init; }
	public string? NextPlayerName { get; init; }
}
