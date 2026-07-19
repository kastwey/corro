using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>Race-family runtime: the circuit and its rules, for the command handlers.</summary>
public sealed record RaceRuntime(RaceBoardDef Board, RaceRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// The race family (parcheesi-style): several pieces per player racing a shared circuit into a
/// private corridor. No squares, no economy — the shared plumbing (turns, announcements,
/// persistence) is identical to the property family.
/// </summary>
public sealed class RaceFamily : IGameFamily
{
	public string GameType => "race";

	public async Task<GameDefinition> LoadDefinitionAsync(string packageDir, Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		// board.json is a circuit definition, and the family has no card decks — cards.json optional.
		var raceBoard = await PackageJson.ReadAsync<RaceBoardDef>(packageDir, "board.json");
		var raceCards = await PackageJson.ReadOptionalAsync<List<CardDef>>(packageDir, "cards.json") ?? new List<CardDef>();
		return new GameDefinition { Manifest = manifest, RaceBoard = raceBoard, Cards = raceCards, I18n = i18n };
	}

	/// <summary>Structural checks of a "race" board: a coherent circuit, seats inside it, and a
	/// seat (and token) for every supported player.</summary>
	public void ValidateDefinition(GameDefinition d)
	{
		var board = d.RaceBoard
			?? throw new InvalidOperationException("race package has no board (board.json).");

		if (board.CircuitLength < 4)
		{
			throw new InvalidOperationException("race board circuitLength must be at least 4.");
		}

		if (board.CorridorLength < 1)
		{
			throw new InvalidOperationException("race board corridorLength must be at least 1.");
		}

		if (board.PiecesPerPlayer < 1)
		{
			throw new InvalidOperationException("race board piecesPerPlayer must be at least 1.");
		}

		if (board.Seats.Count < 2)
		{
			throw new InvalidOperationException("race board must define at least 2 seats.");
		}

		var seatIds = board.Seats.Select(s => s.Id).ToList();
		if (seatIds.Any(string.IsNullOrWhiteSpace) || seatIds.Distinct().Count() != seatIds.Count)
		{
			throw new InvalidOperationException("every race seat needs a unique id.");
		}

		bool InCircuit(int sq) => sq >= 1 && sq <= board.CircuitLength;
		foreach (var seat in board.Seats)
		{
			if (!InCircuit(seat.StartSquare))
			{
				throw new InvalidOperationException($"seat '{seat.Id}' startSquare {seat.StartSquare} is outside the circuit (1..{board.CircuitLength}).");
			}

			if (!InCircuit(seat.CorridorEntry))
			{
				throw new InvalidOperationException($"seat '{seat.Id}' corridorEntry {seat.CorridorEntry} is outside the circuit (1..{board.CircuitLength}).");
			}
		}
		if (board.Seats.Select(s => s.StartSquare).Distinct().Count() != board.Seats.Count)
		{
			throw new InvalidOperationException("race seats must have distinct start squares.");
		}

		foreach (var safe in board.SafeSquares)
		{
			if (!InCircuit(safe))
			{
				throw new InvalidOperationException($"safe square {safe} is outside the circuit (1..{board.CircuitLength}).");
			}
		}
		// A start square must be safe: exiting home would otherwise expose the piece immediately,
		// and the exit-capture rule assumes the start is a (special) safe square.
		foreach (var seat in board.Seats)
		{
			if (!board.SafeSquares.Contains(seat.StartSquare))
			{
				throw new InvalidOperationException($"seat '{seat.Id}' startSquare {seat.StartSquare} must be listed in safeSquares.");
			}
		}

		// Players: bounded by the number of seats (each player takes one) and, as in every
		// family, by tokens when the package ships them.
		var players = d.Manifest.Players;
		if (players.Min < 2)
		{
			throw new InvalidOperationException("players.min must be at least 2.");
		}

		if (players.Max < players.Min)
		{
			throw new InvalidOperationException("players.max must be >= players.min.");
		}

		if (players.Max > board.Seats.Count)
		{
			throw new InvalidOperationException($"players.max ({players.Max}) cannot exceed the number of seats ({board.Seats.Count}).");
		}

		if (d.Manifest.Tokens.Count > 0 && players.Max > d.Manifest.Tokens.Count)
		{
			throw new InvalidOperationException(
				$"players.max ({players.Max}) cannot exceed the number of tokens the package provides ({d.Manifest.Tokens.Count}).");
		}
	}

	/// <summary>Race-family game start: each player takes a board seat in join order; every piece
	/// starts at home.</summary>
	public FamilyGame CreateGame(FamilyStartContext start)
	{
		var definition = start.Definition;
		var raceBoard = definition.RaceBoard
			?? throw new InvalidOperationException("race package has no board (board.json).");
		var raceRules = definition.Manifest.RaceRules ?? new RaceRulesConfig();

		// Lobby seat choices win; everyone else takes the free seats in turn order.
		var assigned = RaceRulebook.AssignSeats(raceBoard, start.Players.Select(p => (p.Id, p.SeatId)).ToList());
		var seatOf = assigned.ToDictionary(a => a.PlayerId, a => a.Seat);
		var seating = assigned.Select(a => (a.PlayerId, a.Seat.Id)).ToList();

		// Pairs only make sense as two teams of two on opposite seats.
		var teams = start.RaceTeams && start.Players.Count == 4 && raceBoard.Seats.Count == 4;

		var state = new GameState
		{
			GameType = "race",
			Race = RaceRulebook.CreateInitialState(raceBoard, seating) with { TeamsMode = teams },
			RaceBoard = raceBoard,
			RaceRules = raceRules, // public config for the active-rules dialog

			// Each player wears their SEAT's colour: the panel token, the board pieces and
			// any colour-coded UI all speak the same identity ("Ana is the red squadron").
			Players = start.Players.Select(p => new Player
			{
				Id = p.Id,
				Name = p.Name,
				Token = p.Token,
				IsBot = p.IsBot,
				Position = 0,
				Money = 0,
				SeatId = seatOf[p.Id].Id,
				Color = seatOf[p.Id].Color,
			}).ToList(),
			CurrentTurn = start.Players.FirstOrDefault()?.Id,
			BoardName = definition.Manifest.Name is { Count: > 0 } ? new Dictionary<string, string>(definition.Manifest.Name) : null,
			CenterBrand = definition.Manifest.CenterBrand,
			Tokens = definition.Manifest.Tokens,
			Currency = definition.Manifest.Currency,
			Terminology = definition.Manifest.Terminology,
		};

		// Pairs mode: say WHO plays with WHOM once, up front — partners are the
		// opposite seats, which a blind player cannot infer from the seat colours.
		Func<Func<string, Dictionary<string, object>?, Task>, Task>? postStart = null;
		if (state.Race is { TeamsMode: true } race && start.Players.Count == 4)
		{
			var bySeatIndex = race.Seats
				.OrderBy(s => raceBoard.Seats.FindIndex(d => d.Id == s.SeatId))
				.Select(s => start.Players.First(p => p.Id == s.PlayerId).Name)
				.ToList();
			postStart = announce => announce("game.race_teams", new Dictionary<string, object>
			{
				["a1"] = bySeatIndex[0],
				["a2"] = bySeatIndex[2],
				["b1"] = bySeatIndex[1],
				["b2"] = bySeatIndex[3],
			});
		}

		return new FamilyGame
		{
			State = state,
			Runtime = new RaceRuntime(raceBoard, raceRules),
			PostStartAsync = postStart,
		};
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> definition.RaceBoard is { } board
			? new RaceRuntime(board, definition.Manifest.RaceRules ?? new RaceRulesConfig())
			: null;

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> state.RaceBoard is { } board
			? new RaceRuntime(board, state.RaceRules ?? new RaceRulesConfig())
			: null;

	/// <summary>One die and the race's own turn flow (exit/captures/bonuses); none of the
	/// property-family checks (debt, holding, doubles) apply.</summary>
	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> RaceTurnFlow.ProcessRollAsync(rollSingleDie(), player, context);

	/// <summary>
	/// A leaver's pieces go HOME — off the circuit, so they stop blocking squares and
	/// barriers as ghosts — and any piece choice or bonus chain waiting on them clears
	/// (a pending choice would otherwise freeze the game on a player who will never
	/// answer). Runs BEFORE the generic turn pass, so turn-scoped counters reset too.
	/// </summary>
	public Task OnPlayerRetiredAsync(Player player, GameContext context)
	{
		if (context.GameState.Race is not { } race)
		{
			return Task.CompletedTask;
		}

		var seat = race.Seats.FirstOrDefault(s => s.PlayerId == player.Id);
		if (seat != null)
		{
			foreach (var piece in seat.Pieces)
			{
				piece.Location = RacePieceLocation.Home;
				piece.Square = 0;
			}
		}

		if (race.PendingMove is { } pending
			&& (pending.PlayerId == player.Id || pending.MoverId == player.Id))
		{
			race.PendingMove = null;
		}

		if (context.GameState.CurrentTurn == player.Id)
		{
			// The bonus chain and the sixes streak belonged to the leaver's turn.
			race.PendingBonuses.Clear();
			race.PendingBonusKinds.Clear();
			race.ConsecutiveSixes = 0;
			race.LastMovedPieceIndex = null;
		}
		return Task.CompletedTask;
	}
}
