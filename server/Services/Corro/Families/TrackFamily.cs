using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>Track-family runtime: the linear track and its rules, for the command handlers.</summary>
public sealed record TrackRuntime(TrackBoardDef Board, TrackRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// The track family (snakes-and-ladders style): one piece per player on a single linear track,
/// roll-and-resolve with jump effects. The smallest family of all — no squares, no economy,
/// no player decisions.
/// </summary>
public sealed class TrackFamily : IGameFamily
{
	public string GameType => "track";

	public async Task<GameDefinition> LoadDefinitionAsync(string packageDir, Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		var trackBoard = await PackageJson.ReadAsync<TrackBoardDef>(packageDir, "board.json");
		return new GameDefinition { Manifest = manifest, TrackBoard = trackBoard, Cards = new List<CardDef>(), I18n = i18n };
	}

	/// <summary>Structural checks of a "track" board: a coherent 1..N track laid on a grid,
	/// and every effect jumping between two DIFFERENT in-range squares (never off the final
	/// square, and never two effects on the same square).</summary>
	public void ValidateDefinition(GameDefinition d)
	{
		var board = d.TrackBoard
			?? throw new InvalidOperationException("track package has no board (board.json).");

		if (board.TrackLength < 10)
		{
			throw new InvalidOperationException("track board trackLength must be at least 10.");
		}

		if (board.GridWidth < 2 || board.GridWidth > board.TrackLength)
		{
			throw new InvalidOperationException("track board gridWidth must be between 2 and trackLength.");
		}

		bool InTrack(int sq) => sq >= 1 && sq <= board.TrackLength;
		var froms = new HashSet<int>();
		foreach (var e in board.Effects)
		{
			if (!InTrack(e.From) || !InTrack(e.To))
			{
				throw new InvalidOperationException($"effect {e.From}->{e.To} is outside the track (1..{board.TrackLength}).");
			}

			if (e.From == e.To)
			{
				throw new InvalidOperationException($"effect on square {e.From} goes nowhere (from == to).");
			}

			if (e.From == board.TrackLength)
			{
				throw new InvalidOperationException("the final square cannot carry an effect (it is the goal).");
			}

			if (!froms.Add(e.From))
			{
				throw new InvalidOperationException($"square {e.From} carries more than one effect.");
			}

			if (string.IsNullOrWhiteSpace(e.Kind))
			{
				throw new InvalidOperationException($"effect {e.From}->{e.To} needs a kind (theme id, e.g. \"ladder\").");
			}
		}
	}

	/// <summary>Track-family game start: one piece per player, everyone off the board (square 0),
	/// each player wearing a colour from the engine palette so the board can tell them apart.</summary>
	public FamilyGame CreateGame(FamilyStartContext start)
	{
		var definition = start.Definition;
		var trackBoard = definition.TrackBoard
			?? throw new InvalidOperationException("track package has no board (board.json).");
		var trackRules = definition.Manifest.TrackRules ?? new TrackRulesConfig();

		var state = new GameState
		{
			GameType = "track",
			Track = TrackRulebook.CreateInitialState(start.Players.Select(p => p.Id)),
			TrackBoard = trackBoard,
			TrackRules = trackRules, // public config for the active-rules dialog

			Players = start.Players.Select((p, i) => new Player
			{
				Id = p.Id,
				Name = p.Name,
				Token = p.Token,
				IsBot = p.IsBot,
				Position = 0,
				Money = 0,
				Color = EnginePalette.ColorFor(i),
			}).ToList(),
			CurrentTurn = start.Players.FirstOrDefault()?.Id,
			BoardName = definition.Manifest.Name is { Count: > 0 } ? new Dictionary<string, string>(definition.Manifest.Name) : null,
			CenterBrand = definition.Manifest.CenterBrand,
			Tokens = definition.Manifest.Tokens,
			Currency = definition.Manifest.Currency,
			Terminology = definition.Manifest.Terminology,
		};

		return new FamilyGame { State = state, Runtime = new TrackRuntime(trackBoard, trackRules) };
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> definition.TrackBoard is { } board
			? new TrackRuntime(board, definition.Manifest.TrackRules ?? new TrackRulesConfig())
			: null;

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> state.TrackBoard is { } board
			? new TrackRuntime(board, state.TrackRules ?? new TrackRulesConfig())
			: null;

	/// <summary>One die, roll-and-resolve (no choices, no economy).</summary>
	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> TrackTurnFlow.ProcessRollAsync(rollSingleDie(), player, context);
}
