using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>Assembly-family runtime: the deck catalog and the family rules, for the handlers.</summary>
public sealed record AssemblyRuntime(
	IReadOnlyDictionary<string, AssemblyCardDef> Catalog,
	IReadOnlyList<AssemblyCardDef> Deck,
	AssemblyRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// The assembly family: the engine's second hidden-information family. No
/// board — the package ships a deck (cards.json) and rules (manifest assemblyRules); the
/// client's central surface is the hand panel plus each player's public rack. Hands, the
/// draw pile AND the discard pile (face-down in this genre) are secrets: every state that
/// leaves the server goes through <see cref="ProjectFor"/>.
/// </summary>
public sealed class AssemblyFamily : IGameFamily
{
	public string GameType => "assembly";

	private static readonly HashSet<string> CardTypes = new() { "piece", "attack", "remedy", "special" };
	private static readonly HashSet<string> SpecialKinds = new()
		{ "swapPiece", "stealPiece", "plague", "scrapHands", "fullSwap" };

	public async Task<GameDefinition> LoadDefinitionAsync(string packageDir, Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		// No board.json at all: the deck IS the game content.
		var deck = await PackageJson.ReadAsync<List<AssemblyCardDef>>(packageDir, "cards.json");
		return new GameDefinition { Manifest = manifest, AssemblyDeck = deck, Cards = new List<CardDef>(), I18n = i18n };
	}

	/// <summary>Structural checks of an assembly deck: known card types and special kinds,
	/// coherent colours (attacks/remedies answer piece colours that exist), enough distinct
	/// colours to ever win, named cards, and a playable configuration.</summary>
	public void ValidateDefinition(GameDefinition d)
	{
		var deck = d.AssemblyDeck
			?? throw new InvalidOperationException("assembly package has no deck (cards.json).");
		if (deck.Count == 0)
		{
			throw new InvalidOperationException("assembly deck has no cards.");
		}

		var ids = deck.Select(c => c.Id).ToList();
		if (ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct().Count() != ids.Count)
		{
			throw new InvalidOperationException("every assembly card needs a unique id.");
		}

		var pieceColors = deck
			.Where(c => c.Type == "piece" && c.Color is { } col && col != AssemblyRulebook.Wild)
			.Select(c => c.Color!).ToHashSet();

		foreach (var card in deck)
		{
			if (!CardTypes.Contains(card.Type))
			{
				throw new InvalidOperationException($"assembly card '{card.Id}' has an unknown type '{card.Type}'.");
			}

			if (string.IsNullOrWhiteSpace(card.NameKey))
			{
				throw new InvalidOperationException($"assembly card '{card.Id}' has no name (add a nameKey).");
			}

			if (card.Count < 1)
			{
				throw new InvalidOperationException($"assembly card '{card.Id}' needs a positive count.");
			}

			switch (card.Type)
			{
				case "piece" or "attack" or "remedy" when string.IsNullOrWhiteSpace(card.Color):
					throw new InvalidOperationException($"assembly card '{card.Id}' needs a colour.");
				case "attack" or "remedy" when card.Color != AssemblyRulebook.Wild && !pieceColors.Contains(card.Color!):
					throw new InvalidOperationException(
						$"assembly card '{card.Id}' answers colour '{card.Color}', which no piece comes in.");
				case "special" when card.SpecialKind is null || !SpecialKinds.Contains(card.SpecialKind):
					throw new InvalidOperationException(
						$"assembly card '{card.Id}' needs a known specialKind ({string.Join(", ", SpecialKinds)}).");
			}
		}

		var rules = d.Manifest.AssemblyRules ?? new AssemblyRulesConfig();
		if (rules.HandSize < 1)
		{
			throw new InvalidOperationException("assemblyRules.handSize must be positive.");
		}

		if (rules.SlotsToWin < 1)
		{
			throw new InvalidOperationException("assemblyRules.slotsToWin must be positive.");
		}

		if (rules.MaxDiscard < 1)
		{
			throw new InvalidOperationException("assemblyRules.maxDiscard must be positive.");
		}

		if (pieceColors.Count < rules.SlotsToWin)
		{
			throw new InvalidOperationException(
				$"the deck's pieces come in {pieceColors.Count} colours but slotsToWin needs {rules.SlotsToWin}.");
		}

		// No host-customizable rules in this family yet: a manifest declaring one is a bug.
		if (d.Manifest.HouseRules.Count > 0)
		{
			throw new InvalidOperationException("the assembly family declares no house rules yet.");
		}

		var players = d.Manifest.Players;
		if (players.Min < 2)
		{
			throw new InvalidOperationException("players.min must be at least 2.");
		}

		if (players.Max < players.Min)
		{
			throw new InvalidOperationException("players.max must be >= players.min.");
		}

		var totalCards = deck.Sum(c => Math.Max(1, c.Count));
		if (totalCards < players.Max * (rules.HandSize + 1))
		{
			throw new InvalidOperationException(
				$"the deck ({totalCards} cards) is too small for {players.Max} players with hands of {rules.HandSize}.");
		}

		if (d.Manifest.Tokens.Count > 0 && players.Max > d.Manifest.Tokens.Count)
		{
			throw new InvalidOperationException(
				$"players.max ({players.Max}) cannot exceed the number of tokens the package provides ({d.Manifest.Tokens.Count}).");
		}
	}

	public FamilyGame CreateGame(FamilyStartContext start)
	{
		var definition = start.Definition;
		var deck = definition.AssemblyDeck
			?? throw new InvalidOperationException("assembly package has no deck (cards.json).");
		var rules = definition.Manifest.AssemblyRules ?? new AssemblyRulesConfig();

		var random = start.Random ?? new SystemRandomSource();
		var state = new GameState
		{
			GameType = "assembly",
			Assembly = AssemblyRulebook.CreateInitialState(
				start.Players.Select(p => p.Id), deck, rules, random),
			AssemblyDeck = deck.ToList(),
			AssemblyRules = rules,
			Players = start.Players.Select((p, index) => new Player
			{
				Id = p.Id,
				Name = p.Name,
				Token = p.Token,
				IsBot = p.IsBot,
				Position = 0,
				Money = 0,
				Color = EnginePalette.ColorFor(index),
			}).ToList(),
			CurrentTurn = start.Players.FirstOrDefault()?.Id,
			BoardName = definition.Manifest.Name is { Count: > 0 } ? new Dictionary<string, string>(definition.Manifest.Name) : null,
			CenterBrand = definition.Manifest.CenterBrand,
			Tokens = definition.Manifest.Tokens,
			Currency = definition.Manifest.Currency,
			Terminology = definition.Manifest.Terminology,
		};

		return new FamilyGame { State = state, Runtime = Runtime(deck, rules) };
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> definition.AssemblyDeck is { } deck
			? Runtime(deck, definition.Manifest.AssemblyRules ?? new AssemblyRulesConfig())
			: null;

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> state.AssemblyDeck is { } deck
			? Runtime(deck, state.AssemblyRules ?? new AssemblyRulesConfig())
			: null;

	/// <summary>The snapshot persists the deck AND the effective rules: restoring prefers
	/// them over the re-staged manifest's defaults.</summary>
	public bool SnapshotCarriesRules => true;

	private static AssemblyRuntime Runtime(IReadOnlyList<AssemblyCardDef> deck, AssemblyRulesConfig rules)
		=> new(AssemblyRulebook.Catalog(deck), deck, rules);

	/// <summary>No dice in this family: the turn is play/discard → auto-refill. Rolling must
	/// be REFUSED — null would mean "use the shared property flow".</summary>
	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> Task.FromResult<ServerResponse>(new ErrorResponse
		{
			Message = "This family has no dice",
			Code = "NO_DICE_IN_FAMILY",
		});

	/// <summary>A leaver's seat is folded: hand and rack go to the face-down discards
	/// (the cards recirculate) and the seat stops being a target. The turn plumbing needs
	/// nothing else — <see cref="GameStateHelper.NextTurn"/> already skips the fallen.</summary>
	public Task OnPlayerRetiredAsync(Player player, GameContext context)
	{
		if (context.GameState.Assembly is { } assembly)
		{
			AssemblyRulebook.Retire(assembly, player.Id);
		}

		return Task.CompletedTask;
	}

	// ── Hidden information ────────────────────────────────────────────────────

	public bool HasHiddenInformation => true;

	/// <summary>
	/// The view <paramref name="playerId"/> may see: their OWN hand stays; every other hand,
	/// the draw pile AND the face-down discard pile collapse to their counts (kept true by
	/// SyncCounts). The racks are public — everyone watched every piece land. A null player
	/// (public/spectator view) sees no hand at all.
	/// </summary>
	public GameState ProjectFor(GameState state, string? playerId)
	{
		if (state.Assembly is not { } assembly)
		{
			return state;
		}

		var projected = assembly with
		{
			DrawPile = new List<AssemblyCardInstance>(),
			DiscardPile = new List<AssemblyCardInstance>(),
			Seats = assembly.Seats.Select(seat => seat.PlayerId == playerId
				? seat
				: seat with { Hand = new List<AssemblyCardInstance>() }).ToList(),
		};
		return state with { Assembly = projected };
	}
}
