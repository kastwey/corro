namespace CorroServer.Services;

/// <summary>
/// Centralized game constants for Corro.
/// These are default values; individual games may override them via GameSettings.
/// </summary>
public static class GameConstants
{
	/// <summary>
	/// Starting money for each player.
	/// </summary>
	public const int InitialMoney = 1500;

	/// <summary>
	/// Total number of squares on the board (standard Corro).
	/// </summary>
	public const int TotalSquares = 40;

	/// <summary>
	/// Bonus received when passing GO.
	/// </summary>
	public const int GoBonus = 200;

	/// <summary>
	/// Grid size for board coordinate calculations (11x11).
	/// </summary>
	public const int GridSize = 11;

	/// <summary>
	/// Holding position on the board.
	/// </summary>
	public const int HoldingPosition = 10;

	/// <summary>
	/// "Go to Holding" position on the board.
	/// </summary>
	public const int SendToHoldingPosition = 30;

	/// <summary>
	/// Cost to pay the release cost and leave holding.
	/// </summary>
	public const int HoldingReleaseCost = 50;

	/// <summary>
	/// Maximum turns a player can stay in holding before forced release.
	/// </summary>
	public const int MaxHoldingTurns = 3;

	/// <summary>
	/// Initial bank money (total game money minus player starting money).
	/// Standard Corro has $20,580 total.
	/// </summary>
	public const int TotalBankMoney = 20580;

	/// <summary>
	/// Calculates initial bank money based on number of players.
	/// </summary>
	public static int CalculateBankMoney(int playerCount)
	{
		return TotalBankMoney - (playerCount * InitialMoney);
	}
}
