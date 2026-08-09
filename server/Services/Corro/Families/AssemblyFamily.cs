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
		{ "swapPiece", "stealPiece", "plague", "scrapHands", "fullSwap", "exile", "doubleAct", "handSwap" };

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
		var deck = DeckValidation.RequireWellFormedDeck(d.AssemblyDeck, "assembly", CardTypes);

		var pieceColors = deck
			.Where(c => c.Type == "piece" && c.Color is { } col && col != AssemblyRulebook.Wild)
			.Select(c => c.Color!).ToHashSet();

		// An INERT piece is untouchable by definition, so its colour answers nothing: attacks
		// and remedies in that colour would be dead cards. Such colours are excluded from the
		// set an attack/remedy may legally answer.
		var inertOnlyColors = deck
			.Where(c => c.Type == "piece" && c.Color is { } col && col != AssemblyRulebook.Wild)
			.GroupBy(c => c.Color!)
			.Where(g => g.All(c => c.Inert))
			.Select(g => g.Key)
			.ToHashSet();

		foreach (var card in deck)
		{
			switch (card.Type)
			{
				case "piece" or "attack" or "remedy" when string.IsNullOrWhiteSpace(card.Color):
					throw new InvalidOperationException($"assembly card '{card.Id}' needs a colour.");
				case "attack" or "remedy" when card.Color != AssemblyRulebook.Wild && !pieceColors.Contains(card.Color!):
					throw new InvalidOperationException(
						$"assembly card '{card.Id}' answers colour '{card.Color}', which no piece comes in.");
				case "attack" or "remedy" when inertOnlyColors.Contains(card.Color!):
					throw new InvalidOperationException(
						$"assembly card '{card.Id}' answers colour '{card.Color}', whose pieces are all inert and cannot be touched.");
				case "special" when card.SpecialKind is null || !SpecialKinds.Contains(card.SpecialKind):
					throw new InvalidOperationException(
						$"assembly card '{card.Id}' needs a known specialKind ({string.Join(", ", SpecialKinds)}).");
			}

			// Each trait belongs to exactly one card type; anywhere else it would silently
			// do nothing, which is how a package ends up shipping a card that lies.
			if (card.Resistant && card.Type != "attack")
			{
				throw new InvalidOperationException($"assembly card '{card.Id}' is resistant, which only attacks can be.");
			}

			if (card.Potent && card.Type != "remedy")
			{
				throw new InvalidOperationException($"assembly card '{card.Id}' is potent, which only remedies can be.");
			}

			if (card.Inert && card.Type != "piece")
			{
				throw new InvalidOperationException($"assembly card '{card.Id}' is inert, which only pieces can be.");
			}

			// An inert WILD piece would be an untouchable joker: it fills any missing colour
			// and nothing can ever take it out of play.
			if (card.Inert && card.Color == AssemblyRulebook.Wild)
			{
				throw new InvalidOperationException($"assembly card '{card.Id}' cannot be both inert and wild.");
			}
		}

		// A resistant attack that no remedy in the deck can lift is a permanent kill: only a
		// POTENT remedy (or an exile special) ever clears one.
		if (deck.Any(c => c.Type == "attack" && c.Resistant)
			&& !deck.Any(c => c.Type == "remedy" && c.Potent)
			&& !deck.Any(c => c.Type == "special" && c.SpecialKind == "exile"))
		{
			throw new InvalidOperationException(
				"the deck has resistant attacks but nothing that lifts them (a potent remedy or an exile special).");
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

		// The duel house rule raises the goal by one at a two-player table, so the deck must
		// carry enough colours for the HIGHEST goal it can ever be played at.
		var topGoal = Math.Max(rules.SlotsToWin,
			d.Manifest.HouseRules.Any(r => r.Id == "assemblyDuelGoal") ? rules.SlotsToWin + 1 : rules.SlotsToWin);
		if (pieceColors.Count < topGoal)
		{
			throw new InvalidOperationException(
				$"the deck's pieces come in {pieceColors.Count} colours but the goal can reach {topGoal}.");
		}

		// House rules must reference ASSEMBLY codes the engine implements (same doctrine as
		// every family: a package can't invent mechanics, only expose known codes).
		foreach (var rule in d.Manifest.HouseRules)
		{
			if (!HouseRuleCatalog.IsKnownAssembly(rule.Id))
			{
				throw new InvalidOperationException($"assembly rule '{rule.Id}' is not a known assembly rule code.");
			}
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
		// The host's lobby choices override the package defaults. The EFFECTIVE rules ride
		// the state (State.AssemblyRules) so a restore reads them back — see SnapshotCarriesRules.
		if (start.RuleValues is { Count: > 0 } chosen)
		{
			foreach (var (id, value) in chosen)
			{
				rules = HouseRuleCatalog.ApplyAssembly(rules, id, value);
			}
		}

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
			// Out of the game, but WHAT left is still a secret worth keeping: the counts are
			// public (SyncCounts), the identities never leave the server.
			ExiledPile = new List<AssemblyCardInstance>(),
			Seats = assembly.Seats.Select(seat => seat.PlayerId == playerId
				? seat
				: seat with { Hand = new List<AssemblyCardInstance>() }).ToList(),
		};
		return state with { Assembly = projected };
	}
}
