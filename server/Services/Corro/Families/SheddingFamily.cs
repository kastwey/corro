using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>Shedding-family runtime: the deck catalog and the family rules, for the handlers.</summary>
public sealed record SheddingRuntime(
	IReadOnlyDictionary<string, SheddingCardDef> Catalog,
	IReadOnlyList<SheddingCardDef> Deck,
	SheddingRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// The shedding family: turn-based, match one card onto the
/// discards by colour, number or action type — or draw one and maybe play it. No board —
/// the package ships a deck (cards.json) and rules (manifest sheddingRules); the client's
/// central surface is the hand panel plus the public top-of-discards. Hands, the draw
/// pile, the BURIED discards and the drawer's pending decision are secrets: every state
/// that leaves the server goes through <see cref="ProjectFor"/>.
/// </summary>
public sealed class SheddingFamily : IGameFamily
{
	public string GameType => "shedding";

	private static readonly HashSet<string> CardTypes = new()
		{ "number", "skip", "reverse", "drawTwo", "wild", "wildDrawFour" };

	private static readonly HashSet<string> WildTypes = new() { "wild", "wildDrawFour" };

	public async Task<GameDefinition> LoadDefinitionAsync(string packageDir, Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		// No board.json at all: the deck IS the game content.
		var deck = await PackageJson.ReadAsync<List<SheddingCardDef>>(packageDir, "cards.json");
		return new GameDefinition { Manifest = manifest, SheddingDeck = deck, Cards = new List<CardDef>(), I18n = i18n };
	}

	/// <summary>Structural checks of a shedding deck: known types with coherent colours
	/// (wilds colourless, everything else coloured and named), at least two colours to
	/// match across, at least one number card (the round opener flips until one shows),
	/// and enough cards to deal every table size plus the opener.</summary>
	public void ValidateDefinition(GameDefinition d)
	{
		var deck = d.SheddingDeck
			?? throw new InvalidOperationException("shedding package has no deck (cards.json).");
		if (deck.Count == 0)
		{
			throw new InvalidOperationException("shedding deck has no cards.");
		}

		var ids = deck.Select(c => c.Id).ToList();
		if (ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct().Count() != ids.Count)
		{
			throw new InvalidOperationException("every shedding card needs a unique id.");
		}

		foreach (var card in deck)
		{
			if (!CardTypes.Contains(card.Type))
			{
				throw new InvalidOperationException($"shedding card '{card.Id}' has an unknown type '{card.Type}'.");
			}

			if (string.IsNullOrWhiteSpace(card.NameKey))
			{
				throw new InvalidOperationException($"shedding card '{card.Id}' has no name (add a nameKey).");
			}

			if (card.Count < 1)
			{
				throw new InvalidOperationException($"shedding card '{card.Id}' needs a positive count.");
			}

			if (WildTypes.Contains(card.Type) && card.Color != null)
			{
				throw new InvalidOperationException($"shedding card '{card.Id}' is wild: it carries no colour.");
			}

			if (!WildTypes.Contains(card.Type) && string.IsNullOrWhiteSpace(card.Color))
			{
				throw new InvalidOperationException($"shedding card '{card.Id}' needs a colour.");
			}

			if (card.Type == "number" && card.Value < 0)
			{
				throw new InvalidOperationException($"shedding card '{card.Id}' needs a non-negative value.");
			}

			if (card.Points is < 0)
			{
				throw new InvalidOperationException($"shedding card '{card.Id}' needs non-negative points.");
			}
		}

		var colors = deck.Where(c => c.Color != null).Select(c => c.Color!).Distinct().ToList();
		if (colors.Count < 2)
		{
			throw new InvalidOperationException("a shedding deck needs at least two colours to match across.");
		}

		if (!deck.Any(c => c.Type == "number"))
		{
			throw new InvalidOperationException("a shedding deck needs at least one number card (the round opener).");
		}

		var rules = d.Manifest.SheddingRules ?? new SheddingRulesConfig();
		if (rules.HandSize < 1)
		{
			throw new InvalidOperationException("sheddingRules.handSize must be positive.");
		}

		if (rules.TargetScore < 0)
		{
			throw new InvalidOperationException("sheddingRules.targetScore must not be negative.");
		}

		if (!HouseRuleCatalog.SheddingStackingModes.Contains(rules.Stacking))
		{
			throw new InvalidOperationException(
				$"sheddingRules.stacking must be one of {string.Join(", ", HouseRuleCatalog.SheddingStackingModes)}.");
		}

		// House rules must reference SHEDDING codes the engine implements (same doctrine as
		// every family: a package can't invent mechanics, only expose known codes).
		foreach (var rule in d.Manifest.HouseRules)
		{
			if (!HouseRuleCatalog.IsKnownShedding(rule.Id))
			{
				throw new InvalidOperationException($"shedding rule '{rule.Id}' is not a known shedding rule code.");
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
		if (totalCards < players.Max * rules.HandSize + 1)
		{
			throw new InvalidOperationException(
				$"the deck ({totalCards} cards) is too small for {players.Max} players with hands of {rules.HandSize} plus the opener.");
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
		var deck = definition.SheddingDeck
			?? throw new InvalidOperationException("shedding package has no deck (cards.json).");
		var rules = definition.Manifest.SheddingRules ?? new SheddingRulesConfig();
		// The host's lobby choices override the package defaults. The EFFECTIVE rules ride
		// the state (State.SheddingRules) so a restore reads them back — see SnapshotCarriesRules.
		if (start.RuleValues is { Count: > 0 } chosen)
		{
			foreach (var (id, value) in chosen)
			{
				rules = HouseRuleCatalog.ApplyShedding(rules, id, value);
			}
		}

		var random = start.Random ?? new SystemRandomSource();
		var shedding = new SheddingState
		{
			Seats = start.Players.Select(p => new SheddingSeatState { PlayerId = p.Id }).ToList(),
		};
		var opener = SheddingRulebook.DealRound(shedding, deck, rules, random);

		var state = new GameState
		{
			GameType = "shedding",
			Shedding = shedding,
			SheddingDeck = deck.ToList(),
			SheddingRules = rules,
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

		return new FamilyGame
		{
			State = state,
			Runtime = Runtime(deck, rules),
			// Open the round out loud: the deal and the card the discards start on.
			PostStartAsync = announce => announce("game.shedding_round_started",
				new Dictionary<string, object>
				{
					["round"] = 1,
					["count"] = rules.HandSize,
					["card"] = opener.NameKey,
				}),
		};
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> definition.SheddingDeck is { } deck
			? Runtime(deck, definition.Manifest.SheddingRules ?? new SheddingRulesConfig())
			: null;

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> state.SheddingDeck is { } deck
			? Runtime(deck, state.SheddingRules ?? new SheddingRulesConfig())
			: null;

	/// <summary>The snapshot persists the deck AND the effective rules: restoring prefers
	/// them over the re-staged manifest's defaults.</summary>
	public bool SnapshotCarriesRules => true;

	private static SheddingRuntime Runtime(IReadOnlyList<SheddingCardDef> deck, SheddingRulesConfig rules)
		=> new(SheddingRulebook.Catalog(deck), deck, rules);

	/// <summary>No dice in this family: the turn is play-or-draw. Rolling must be
	/// REFUSED — null would mean "use the shared property flow".</summary>
	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> Task.FromResult<ServerResponse>(new ErrorResponse
		{
			Message = "This family has no dice",
			Code = "NO_DICE_IN_FAMILY",
		});

	/// <summary>
	/// A leaver's hand slides under the discards (it recirculates) and their seat leaves
	/// the turn walk. Runs BEFORE the generic turn pass: when the leaver held the turn,
	/// the family advances it itself — DIRECTION-AWARE, which the generic +1 pass is not
	/// — so the correct neighbour plays next even mid-reverse.
	/// </summary>
	public async Task OnPlayerRetiredAsync(Player player, GameContext context)
	{
		if (context.GameState.Shedding is not { } shedding)
		{
			return;
		}

		var held = context.GameState.CurrentTurn == player.Id;
		SheddingRulebook.Retire(shedding, player.Id);

		if (held && SheddingRulebook.ActiveSeats(shedding).Count > 0)
		{
			var nextId = SheddingRulebook.NextPlayer(shedding, player.Id);
			context.GameState.CurrentTurn = nextId;
			var next = context.GameState.Players.FirstOrDefault(p => p.Id == nextId);
			await context.Announce("game.turn_of", new()
			{
				["player"] = next?.Name ?? nextId,
				["actorId"] = nextId,
			});
		}
	}

	// ── Hidden information ────────────────────────────────────────────────────

	public bool HasHiddenInformation => true;

	/// <summary>
	/// The view <paramref name="playerId"/> may see: their OWN hand and their own pending
	/// drawn-card decision stay; every other hand collapses to its count, the draw pile
	/// to its count, and the discards to their TOP card (the buried order reshuffles back
	/// into play, so it stays secret). A null player (public/spectator) sees no hand.
	/// </summary>
	public GameState ProjectFor(GameState state, string? playerId)
	{
		if (state.Shedding is not { } shedding)
		{
			return state;
		}

		var projected = shedding with
		{
			DrawPile = new List<SheddingCardInstance>(),
			DiscardPile = shedding.DiscardPile.Count > 0
				? new List<SheddingCardInstance> { shedding.DiscardPile[^1] }
				: new List<SheddingCardInstance>(),
			PendingDrawnPlay = shedding.PendingDrawnPlay?.PlayerId == playerId
				? shedding.PendingDrawnPlay
				: null,
			Seats = shedding.Seats.Select(seat => seat.PlayerId == playerId
				? seat
				: seat with { Hand = new List<SheddingCardInstance>() }).ToList(),
		};
		return state with { Shedding = projected };
	}
}
