using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Corro.Families;

/// <summary>
/// The property-trading family: the 40-square ring, the economy, buildings and card decks.
/// It is also the fallback for a missing/unknown gameType, so its board reader is what an
/// unsupported package fails against (after the content validator has flagged the type).
/// Its board and rent rules travel in first-class GameState/GameContext slots, so it has
/// no <see cref="IFamilyRuntime"/>.
/// </summary>
public sealed class PropertyFamily : IGameFamily
{
	public string GameType => "property";

	/// <summary>Leaving THIS family forfeits an estate: the classic bankruptcy wording.
	/// Every other family speaks the neutral retirement line instead.</summary>
	public string LeaveAnnouncementKey => "game.player_bankrupt";

	/// <summary>Card effect types the engine understands (see <see cref="CardEffectInterpreter"/>).</summary>
	private static readonly HashSet<string> KnownCardEffects = new()
	{
		"moveTo", "moveBy", "money", "collectFromEach", "payEach", "payPerBuilding",
		"sendToHolding", "grantReleasePass",
	};

	public async Task<GameDefinition> LoadDefinitionAsync(string packageDir, Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		var board = await PackageJson.ReadAsync<List<SquareDef>>(packageDir, "board.json");
		var cards = await PackageJson.ReadAsync<List<CardDef>>(packageDir, "cards.json");
		return new GameDefinition { Manifest = manifest, Board = board, Cards = cards, I18n = i18n };
	}

	public void ValidateDefinition(GameDefinition d)
	{
		if (d.Board.Count == 0)
		{
			throw new InvalidOperationException("board.json has no squares.");
		}

		// Board positions must be 0..N-1 exactly once (the perimeter is walked by index).
		var ids = d.Board.Select(s => s.Id).OrderBy(x => x).ToList();
		for (var i = 0; i < ids.Count; i++)
		{
			if (ids[i] != i)
			{
				throw new InvalidOperationException(
					$"board ids must be contiguous 0..{ids.Count - 1}; missing or duplicate around {i}.");
			}
		}

		var groupIds = d.Manifest.Groups.Select(g => g.Id).ToHashSet();
		var deckIds = d.Manifest.Decks.Select(dk => dk.Id).ToHashSet();

		foreach (var sq in d.Board)
		{
			if (sq.Group is { } g && !groupIds.Contains(g))
			{
				throw new InvalidOperationException($"square {sq.Id} references undefined group '{g}'.");
			}

			if (sq.Type == "deck" && (sq.Deck is null || !deckIds.Contains(sq.Deck)))
			{
				throw new InvalidOperationException($"deck square {sq.Id} references undefined deck '{sq.Deck}'.");
			}
		}

		foreach (var card in d.Cards)
		{
			if (!deckIds.Contains(card.Deck))
			{
				throw new InvalidOperationException($"card '{card.Id}' references undefined deck '{card.Deck}'.");
			}
		}

		// Card effects must be ones the engine understands (an unknown type would silently no-op).
		foreach (var card in d.Cards)
		{
			if (!string.IsNullOrEmpty(card.Effect.Type) && !KnownCardEffects.Contains(card.Effect.Type))
			{
				throw new InvalidOperationException($"card '{card.Id}' has an unknown effect type '{card.Effect.Type}'.");
			}
		}

		// SmallBuilding rules must reference a rule code the engine implements (a package can't invent one).
		foreach (var rule in d.Manifest.HouseRules)
		{
			if (!HouseRuleCatalog.IsKnown(rule.Id))
			{
				throw new InvalidOperationException($"smallBuilding rule '{rule.Id}' is not a known rule code.");
			}
		}

		// If the package provides tokens, it needs enough for a game (>= 2) with unique ids.
		if (d.Manifest.Tokens.Count > 0)
		{
			if (d.Manifest.Tokens.Count < 2)
			{
				throw new InvalidOperationException("a package that defines tokens must provide at least 2.");
			}

			var tokenIds = d.Manifest.Tokens.Select(t => t.Id).ToList();
			if (tokenIds.Any(string.IsNullOrWhiteSpace))
			{
				throw new InvalidOperationException("every token needs an id.");
			}

			if (tokenIds.Distinct().Count() != tokenIds.Count)
			{
				throw new InvalidOperationException("token ids must be unique.");
			}
		}

		// Group navigation keys: a package may give each group a single-letter board shortcut (colours
		// are package-specific, so the keys can't be hardcoded). Each must be a letter, unique across
		// groups, and not clash with a key the engine reserves (e.g. "c" = cash).
		var groupKeys = d.Manifest.Groups
			.Where(g => !string.IsNullOrEmpty(g.Key))
			.Select(g => (g.Id, Key: g.Key!.ToLowerInvariant()))
			.ToList();
		foreach (var (id, key) in groupKeys)
		{
			if (key.Length != 1 || key[0] < 'a' || key[0] > 'z')
			{
				throw new InvalidOperationException($"group '{id}' shortcut key must be a single letter a-z.");
			}

			if (EngineKeymap.ReservedLetters.Contains(key))
			{
				throw new InvalidOperationException($"group '{id}' shortcut key '{key}' is reserved by the engine.");
			}
		}
		var keyValues = groupKeys.Select(g => g.Key).ToList();
		if (keyValues.Distinct().Count() != keyValues.Count)
		{
			throw new InvalidOperationException("group shortcut keys must be unique.");
		}

		// Player-count range: at least 2 to play, max not below min, and never above the 8-piece
		// ceiling the lobby/board ring supports. If the package ships its own tokens, the maximum can't
		// exceed how many it provides (each player needs a distinct token).
		var players = d.Manifest.Players;
		if (players.Min < 2)
		{
			throw new InvalidOperationException("players.min must be at least 2.");
		}

		if (players.Max < players.Min)
		{
			throw new InvalidOperationException("players.max must be >= players.min.");
		}

		if (players.Max > 8)
		{
			throw new InvalidOperationException("players.max must be at most 8.");
		}

		if (d.Manifest.Tokens.Count > 0 && players.Max > d.Manifest.Tokens.Count)
		{
			throw new InvalidOperationException(
				$"players.max ({players.Max}) cannot exceed the number of tokens the package provides ({d.Manifest.Tokens.Count}).");
		}

		// Rule coherence: building smallBuildings (the buildingTable rent strategy) needs colour groups to
		// complete, so reject a board that builds but defines none.
		var buildsSmallBuildings = d.Manifest.Rules.RentStrategies.Values.Any(v => v == "buildingTable");
		if (buildsSmallBuildings && d.Manifest.Groups.All(g => string.IsNullOrEmpty(g.Color)))
		{
			throw new InvalidOperationException("board builds smallBuildings (buildingTable) but defines no colour groups.");
		}

		// Building tiers: at least one small construction, and every buildable property's rent table
		// must have base + Levels small + 1 big = Levels+2 entries, so the rent index always resolves.
		var levels = d.Manifest.Building.Levels;
		if (levels < 1)
		{
			throw new InvalidOperationException("building.levels must be at least 1.");
		}

		var buildTableTypes = d.Manifest.Rules.RentStrategies
			.Where(kv => kv.Value == "buildingTable").Select(kv => kv.Key).ToHashSet();
		foreach (var sq in d.Board)
		{
			if (sq.Rent is { } rent && buildTableTypes.Contains(sq.Type) && rent.Length != levels + 2)
			{
				throw new InvalidOperationException(
					$"property {sq.Id} must have {levels + 2} rent entries (base + {levels} small + 1 big) " +
					$"for building.levels={levels}, but has {rent.Length}.");
			}
		}

		// The current board ring (client GRID_SIZE = 11) renders exactly 40 squares. Checked last
		// so the more specific structural/reference errors above are reported first.
		if (d.Board.Count != 40)
		{
			throw new InvalidOperationException($"board must have 40 squares (the current ring), but has {d.Board.Count}.");
		}
	}

	public FamilyGame CreateGame(FamilyStartContext start)
	{
		var definition = start.Definition;

		// Use the lobby's customized settings when given (package defaults pre-filled in step 2 then
		// tweaked by the host); otherwise fall back to the package's own rule defaults.
		var settings = start.Settings ?? GameDefinitionAdapter.ToSettings(definition);
		var squares = GameDefinitionAdapter.ToSquares(definition, start.Lang);

		var state = new GameState
		{
			Players = start.Players.Select(p => new Player
			{
				Id = p.Id,
				Name = p.Name,
				Token = p.Token,
				IsBot = p.IsBot,
				Position = 0,
				Money = settings.StartingMoney,
				Properties = new List<int>(),
				ReleasePasses = 0
			}).ToList(),
			Bank = new BankInfo
			{
				Money = GameConstants.TotalBankMoney - start.Players.Count * settings.StartingMoney,
				FreeParkingJackpot = settings.FreeParkingJackpot
			},
			CurrentTurn = start.Players.FirstOrDefault()?.Id,
			Squares = squares,
			PackageCards = definition.Cards,
			Decks = definition.Manifest.Decks,
			BoardName = definition.Manifest.Name is { Count: > 0 } ? new Dictionary<string, string>(definition.Manifest.Name) : null,
			CenterBrand = definition.Manifest.CenterBrand,
			Tokens = definition.Manifest.Tokens,
			Groups = definition.Manifest.Groups,
			Currency = definition.Manifest.Currency,
			Terminology = definition.Manifest.Terminology,
			Building = definition.Manifest.Building,
			WalkToHolding = definition.Manifest.Rules.Holding.Walk,
			Settings = settings // public config for the active-rules dialog
		};

		return new FamilyGame { State = state, Settings = settings, RentRules = definition.Manifest.Rules };
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition) => null;

	public IFamilyRuntime? RuntimeFromState(GameState state) => null;

	/// <summary>The property dice flow (two dice, doubles, debt/holding guards) IS the shared
	/// default in <see cref="RollDiceHandler"/> — nothing to take over here.</summary>
	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context) => null;
}
