using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Corro;

public enum CardOutcomeKind
{
	None,
	MoveTo,
	MoneyDelta,
	CollectFromEach,
	PayEach,
	PayPerBuilding,
	SendToHolding,
	GrantReleasePass,
}

/// <summary>
/// What a drawn card resolves to: a description of the consequence, not a mutation. The game loop
/// applies it. Keeping it declarative lets the interpreter stay pure and exhaustively testable.
/// </summary>
public sealed record CardOutcome
{
	public CardOutcomeKind Kind { get; init; }
	/// <summary>Destination board position (MoveTo).</summary>
	public int Position { get; init; }
	/// <summary>Whether this move actually passes the start space and earns the pass bonus (MoveTo).</summary>
	public bool CollectPass { get; init; }
	/// <summary>Money to/from the bank (MoneyDelta, +collect/-pay), or per-player amount (Collect/PayEach).</summary>
	public int Amount { get; init; }
	/// <summary>Repair costs (PayPerBuilding).</summary>
	public int PerSmallBuilding { get; init; }
	public int PerBigBuilding { get; init; }
	/// <summary>Multiplies the rent due on arrival (MoveTo); 1 = normal (e.g. 2 for the railway card).</summary>
	public int RentMultiplier { get; init; } = 1;
	/// <summary>Charge utility rent as 10× a fresh dice throw on arrival (MoveTo; the utility card rule).</summary>
	public bool UtilityTimesDice { get; init; }
}

/// <summary>
/// Interprets a generic <see cref="CardEffect"/> into a <see cref="CardOutcome"/>. The card text is
/// content; the effect schema is the engine's vocabulary (move, money, holding…), so any board's deck
/// works without engine changes. Pure: the only "state" is the board layout and the drawer's position.
/// </summary>
public static class CardEffectInterpreter
{
	/// <summary>Resolve over a package board (<see cref="SquareDef"/>).</summary>
	public static CardOutcome Resolve(CardEffect effect, IReadOnlyList<SquareDef> board, int fromPosition)
	{
		var byPos = board.OrderBy(s => s.Id).ToArray();
		return Resolve(effect, byPos.Length, pos => byPos[pos].Group ?? string.Empty, fromPosition);
	}

	/// <summary>Resolve over a live game board (<see cref="Square"/>), so a package deck plays in a real game.</summary>
	public static CardOutcome Resolve(CardEffect effect, IReadOnlyList<Square> board, int fromPosition)
	{
		var byPos = board.OrderBy(s => s.Id).ToArray();
		return Resolve(effect, byPos.Length, pos => byPos[pos].Key ?? string.Empty, fromPosition);
	}

	/// <summary>Core resolution against a board abstracted as size + a position→group lookup.</summary>
	private static CardOutcome Resolve(CardEffect effect, int boardSize, Func<int, string> groupAt, int fromPosition)
	{
		switch (effect.Type)
		{
			case "moveTo":
				{
					var dest = ResolveTarget(effect.Target, boardSize, groupAt, fromPosition);
					// A forward advance earns the pass bonus only if it actually wraps past the start.
					var collect = (effect.CollectPass ?? false) && dest < fromPosition;
					return new CardOutcome
					{
						Kind = CardOutcomeKind.MoveTo,
						Position = dest,
						CollectPass = collect,
						RentMultiplier = effect.RentMultiplier ?? 1,
						UtilityTimesDice = effect.UtilityTimesDice ?? false,
					};
				}
			case "moveBy":
				{
					var dest = Wrap(fromPosition + (effect.Steps ?? 0), boardSize);
					// Relative moves (e.g. "go back 3") do not collect the pass bonus.
					return new CardOutcome { Kind = CardOutcomeKind.MoveTo, Position = dest, CollectPass = false };
				}
			case "money": return new CardOutcome { Kind = CardOutcomeKind.MoneyDelta, Amount = effect.Amount ?? 0 };
			case "collectFromEach": return new CardOutcome { Kind = CardOutcomeKind.CollectFromEach, Amount = effect.Amount ?? 0 };
			case "payEach": return new CardOutcome { Kind = CardOutcomeKind.PayEach, Amount = effect.Amount ?? 0 };
			case "payPerBuilding": return new CardOutcome { Kind = CardOutcomeKind.PayPerBuilding, PerSmallBuilding = effect.PerSmallBuilding ?? 0, PerBigBuilding = effect.PerBigBuilding ?? 0 };
			case "sendToHolding": return new CardOutcome { Kind = CardOutcomeKind.SendToHolding };
			case "grantReleasePass": return new CardOutcome { Kind = CardOutcomeKind.GrantReleasePass };
			default: return new CardOutcome { Kind = CardOutcomeKind.None };
		}
	}

	/// <summary>Resolve a target: a square id ("0"), or "nearest:&lt;groupId&gt;" forward from the position
	/// (the group is the board's own id — e.g. "transit"/"utility" here — so the engine privileges no type).</summary>
	private static int ResolveTarget(string? target, int boardSize, Func<int, string> groupAt, int fromPosition)
	{
		if (string.IsNullOrEmpty(target))
		{
			return fromPosition;
		}

		if (target.StartsWith("nearest:", StringComparison.Ordinal))
		{
			return NearestForward(boardSize, groupAt, fromPosition, target["nearest:".Length..]);
		}

		return int.TryParse(target, out var id) ? id : fromPosition;
	}

	private static int NearestForward(int boardSize, Func<int, string> groupAt, int fromPosition, string group)
	{
		for (var step = 1; step <= boardSize; step++)
		{
			var pos = (fromPosition + step) % boardSize;
			if (groupAt(pos) == group)
			{
				return pos;
			}
		}
		return fromPosition;
	}

	private static int Wrap(int x, int n) => n <= 0 ? 0 : ((x % n) + n) % n;
}
