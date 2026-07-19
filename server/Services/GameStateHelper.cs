using CorroServer.Models;

namespace CorroServer.Services;

public class GameStateHelper : IGameStateHelper
{
	private readonly GameState _gameState;

	// Players whose Money INCREASED since the last drain. The command pipeline drains
	// this after each command to auto-resolve recoverable debts from cash that arrived
	// during it (rent received, card collection, GO salary, mortgage/sale proceeds),
	// even when the debtor is not the active player. This is the "bank raised a
	// money-changed signal that the debt sweep listens to" mechanism, recorded
	// synchronously here and acted upon (resolve + announce) at the safe async point.
	private readonly HashSet<string> _moneyGainers = new();

	public GameStateHelper(GameState gameState)
	{
		_gameState = gameState;
	}

	/// <summary>
	/// Returns and clears the set of players whose money increased since the last call.
	/// </summary>
	public IReadOnlyCollection<string> DrainMoneyGainers()
	{
		if (_moneyGainers.Count == 0)
		{
			return Array.Empty<string>();
		}

		var snapshot = _moneyGainers.ToList();
		_moneyGainers.Clear();
		return snapshot;
	}

	// Flag a player as a candidate for the debt sweep ONLY when they currently owe
	// something. A cash gain can only ever resolve an existing debt, so players with no
	// pending debt are never recorded and the sweep set stays minimal.
	private void MarkMoneyGainerIfIndebted(string playerId)
	{
		if (_gameState.PendingDebts.Any(d => d.DebtorId == playerId))
		{
			_moneyGainers.Add(playerId);
		}
	}

	public Player? GetPlayer(string playerId)
		=> _gameState.Players.FirstOrDefault(p => p.Id == playerId);

	public int GetPlayerMoney(string playerId)
		=> GetPlayer(playerId)?.Money ?? 0;

	public void SetPlayerMoney(string playerId, int amount)
	{
		var player = GetPlayer(playerId);
		if (player != null)
		{
			var clamped = Math.Max(0, amount);
			if (clamped > player.Money)
			{
				MarkMoneyGainerIfIndebted(playerId);
			}

			player.Money = clamped;
		}
	}

	public void AddPlayerMoney(string playerId, int amount)
	{
		var player = GetPlayer(playerId);
		if (player != null)
		{
			player.Money = Math.Max(0, player.Money + amount);
			if (amount > 0)
			{
				MarkMoneyGainerIfIndebted(playerId);
			}
		}
	}

	public void SetPlayerPosition(string playerId, int position)
	{
		var player = GetPlayer(playerId);
		if (player != null)
		{
			player.Position = position;
		}
	}

	public int GetBankMoney() => _gameState.Bank.Money;

	public void SetBankMoney(int amount)
		=> _gameState.Bank.Money = Math.Max(0, amount);

	public int GetFreeParkingPot() => _gameState.Bank.FreeParkingPot;

	public void AddToFreeParkingPot(int amount)
		=> _gameState.Bank.FreeParkingPot += amount;

	public int CollectFreeParkingPot()
	{
		var pot = _gameState.Bank.FreeParkingPot;
		_gameState.Bank.FreeParkingPot = 0;
		return pot;
	}

	public void AddPlayerReleasePass(string playerId)
	{
		var player = GetPlayer(playerId);
		if (player != null)
		{
			player.ReleasePasses++;
		}
	}

	public void RemovePlayerReleasePass(string playerId)
	{
		var player = GetPlayer(playerId);
		if (player != null && player.ReleasePasses > 0)
		{
			player.ReleasePasses--;
		}
	}

	// Holding helper methods
	public void SendToHolding(string playerId, int holdingSquareIndex, int maxTurns = 3)
	{
		var player = GetPlayer(playerId);
		if (player != null)
		{
			player.Position = holdingSquareIndex;
			player.IsHeld = true;
			player.HoldingTurnsRemaining = maxTurns;
		}
	}

	public void ReleaseFromHolding(string playerId)
	{
		var player = GetPlayer(playerId);
		if (player != null)
		{
			player.IsHeld = false;
			player.HoldingTurnsRemaining = 0;
		}
	}

	public bool IsPlayerHeld(string playerId)
	{
		var player = GetPlayer(playerId);
		return player?.IsHeld ?? false;
	}

	public int GetPlayerHoldingTurnsRemaining(string playerId)
	{
		var player = GetPlayer(playerId);
		return player?.HoldingTurnsRemaining ?? 0;
	}

	public void DecrementHoldingTurns(string playerId)
	{
		var player = GetPlayer(playerId);
		if (player != null && player.HoldingTurnsRemaining > 0)
		{
			player.HoldingTurnsRemaining--;
		}
	}

	public void AddPlayerProperty(string playerId, int squareIndex)
	{
		var player = GetPlayer(playerId);
		if (player != null)
		{
			if (!player.Properties.Contains(squareIndex))
			{
				player.Properties.Add(squareIndex);
			}

			// Update ownership.
			var existing = _gameState.Ownership.FirstOrDefault(o => o.Index == squareIndex);
			if (existing != null)
			{
				_gameState.Ownership.Remove(existing);
			}

			_gameState.Ownership.Add(new SquareOwnership
			{
				Index = squareIndex,
				OwnerId = playerId
			});
		}
	}

	public void RemovePlayerProperty(string playerId, int squareIndex)
	{
		var player = GetPlayer(playerId);
		if (player != null)
		{
			player.Properties.Remove(squareIndex);
			_gameState.Ownership.RemoveAll(o => o.Index == squareIndex);
		}
	}

	public List<Player> GetAllPlayers() => _gameState.Players;

	public List<Square> GetSquares() => _gameState.Squares;

	public Square? GetSquare(int index)
		=> index >= 0 && index < _gameState.Squares.Count ? _gameState.Squares[index] : null;

	public void SetCurrentTurn(string? playerId)
		=> _gameState.CurrentTurn = playerId;

	public Player? GetCurrentPlayer()
	{
		if (string.IsNullOrEmpty(_gameState.CurrentTurn))
		{
			return null;
		}

		return GetPlayer(_gameState.CurrentTurn);
	}

	public void NextTurn()
	{
		var currentIndex = _gameState.Players.FindIndex(p => p.Id == _gameState.CurrentTurn);
		var count = _gameState.Players.Count;
		var nextIndex = (currentIndex + 1) % count;

		// Skip players who are out of the game. This reads only the family-agnostic
		// Player.Status: each family stamps Finished (race keeps playing for the remaining
		// places) or Eliminated (bankruptcy) at the point a player leaves — the rotation
		// itself knows nothing about bankruptcy, finishing or any one family's rules.
		// The guard stops a full lap so a (degenerate) everyone-out state can't loop forever.
		static bool IsOut(Player p) => p.Status != PlayerStatus.Active;
		for (var i = 0; i < count && IsOut(_gameState.Players[nextIndex]); i++)
		{
			nextIndex = (nextIndex + 1) % count;
		}

		_gameState.CurrentTurn = _gameState.Players[nextIndex].Id;

		// A fresh turn starts: the new player has not rolled yet and owes no re-roll, and
		// the doubles-speeding counter belongs to the previous player's turn.
		_gameState.HasRolledThisTurn = false;
		_gameState.MustRollAgain = false;
		_gameState.ConsecutiveDoubles = 0;
	}

	public int GetPlayerReleasePasses(string playerId)
	{
		var player = GetPlayer(playerId);
		return player?.ReleasePasses ?? 0;
	}

	public string? GetCurrentTurn() => _gameState.CurrentTurn;

	public (string? Id, string? Name) GetNextTurnInfo(string actingPlayerId)
	{
		var current = GetCurrentPlayer();
		return current != null && current.Id != actingPlayerId
			? (current.Id, current.Name)
			: (null, null);
	}

	// ============================================
	// DEBT MANAGEMENT
	// ============================================

	/// <summary>
	/// Creates a debt for a player. Returns the debt ID.
	/// </summary>
	public string CreateDebt(string debtorId, string? creditorId, int amount, DebtReason reason, string description)
	{
		var debtor = GetPlayer(debtorId);
		var creditor = creditorId != null ? GetPlayer(creditorId) : null;

		var debt = new DebtState
		{
			Id = Guid.NewGuid().ToString("N")[..8],
			DebtorId = debtorId,
			DebtorName = debtor?.Name ?? "Unknown",
			CreditorId = creditorId ?? "Bank",
			CreditorName = creditor?.Name ?? "Bank",
			Amount = amount,
			Reason = reason,
			Description = description,
			CreatedAt = DateTime.UtcNow
		};
		_gameState.PendingDebts.Add(debt);
		return debt.Id;
	}

	/// <summary>
	/// Gets all pending debts for a player.
	/// </summary>
	public List<DebtState> GetDebtsFor(string playerId)
		=> _gameState.PendingDebts.Where(d => d.DebtorId == playerId).ToList();

	/// <summary>
	/// Gets a specific debt by ID.
	/// </summary>
	public DebtState? GetDebt(string debtId)
		=> _gameState.PendingDebts.FirstOrDefault(d => d.Id == debtId);

	/// <summary>
	/// Removes a debt after it's been resolved.
	/// </summary>
	public void RemoveDebt(string debtId)
		=> _gameState.PendingDebts.RemoveAll(d => d.Id == debtId);

	/// <summary>
	/// Checks if a player has any pending debts.
	/// </summary>
	public bool HasPendingDebts(string playerId)
		=> _gameState.PendingDebts.Any(d => d.DebtorId == playerId);

	/// <summary>
	/// Gets total debt amount for a player.
	/// </summary>
	public int GetTotalDebt(string playerId)
		=> _gameState.PendingDebts.Where(d => d.DebtorId == playerId).Sum(d => d.Amount);

	/// <summary>
	/// Attempts to pay an amount. Returns true if fully paid, false if debt created.
	/// </summary>
	public (bool success, string? debtId) TryPay(string payerId, string? recipientId, int amount, DebtReason reason, string description)
	{
		var payer = GetPlayer(payerId);
		if (payer == null)
		{
			return (false, null);
		}

		if (payer.Money >= amount)
		{
			// Can afford - make payment
			payer.Money -= amount;

			if (recipientId != null)
			{
				var recipient = GetPlayer(recipientId);
				if (recipient != null)
				{
					recipient.Money += amount;
					MarkMoneyGainerIfIndebted(recipientId);
				}
			}
			else
			{
				// Payment to bank
				_gameState.Bank.Money += amount;
			}
			return (true, null);
		}
		else
		{
			// Cannot afford - create debt
			var debtId = CreateDebt(payerId, recipientId, amount, reason, description);
			return (false, debtId);
		}
	}

	/// <summary>
	/// Loads squares from board data, calculating coordinates.
	/// </summary>
	public void LoadBoard(List<BoardData> boardData)
	{
		_gameState.Squares.Clear();
		for (int i = 0; i < boardData.Count; i++)
		{
			var data = boardData[i];
			var (x, y) = BoardCoordinates.Calculate(i);
			_gameState.Squares.Add(new Square
			{
				Id = i,
				X = x,
				Y = y,
				Name = data.Name,
				Price = data.Price,
				Color = data.Color,
				Key = data.Key,
				OwnerId = data.OwnerId
			});
		}
	}
}
