using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>Exploding-family runtime: the deck catalog and the family rules, for the handlers.</summary>
public sealed record ExplodingRuntime(
	IReadOnlyDictionary<string, ExplodingCardDef> Catalog,
	IReadOnlyList<ExplodingCardDef> Deck,
	ExplodingRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// The exploding family: turn-based press-your-luck against a shared,
/// ordered draw pile with bombs planted in it. On your turn you may play any number of action
/// cards and then you MUST draw one to end the turn; a bomb you cannot Defuse knocks you out,
/// and the last player standing wins. No board — the package ships a deck (cards.json) and rules
/// (manifest explodingRules). The hands and the draw-pile ORDER are secrets: everything that
/// leaves the server goes through <see cref="ProjectFor"/>.
/// </summary>
public sealed class ExplodingFamily : IGameFamily
{
	public string GameType => "exploding";

	private static readonly HashSet<string> CardTypes = new()
		{ "bomb", "defuse", "skip", "attack", "seeFuture", "shuffle", "favor", "nope", "cat" };

	public async Task<GameDefinition> LoadDefinitionAsync(string packageDir, Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		// No board.json at all: the deck IS the game content.
		var deck = await PackageJson.ReadAsync<List<ExplodingCardDef>>(packageDir, "cards.json");
		return new GameDefinition { Manifest = manifest, ExplodingDeck = deck, Cards = new List<CardDef>(), I18n = i18n };
	}

	/// <summary>Structural checks of an exploding deck: known types with names and counts, and
	/// enough of each ROLE to seat every table — a Defuse per hand, players−1 bombs to plant, and
	/// ordinary cards to fill the opening hands (the deck-size sweep uses the largest table).</summary>
	public void ValidateDefinition(GameDefinition d)
	{
		var deck = d.ExplodingDeck
			?? throw new InvalidOperationException("exploding package has no deck (cards.json).");
		if (deck.Count == 0)
		{
			throw new InvalidOperationException("exploding deck has no cards.");
		}

		var ids = deck.Select(c => c.Id).ToList();
		if (ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct().Count() != ids.Count)
		{
			throw new InvalidOperationException("every exploding card needs a unique id.");
		}

		foreach (var card in deck)
		{
			if (!CardTypes.Contains(card.Type))
			{
				throw new InvalidOperationException($"exploding card '{card.Id}' has an unknown type '{card.Type}'.");
			}

			if (string.IsNullOrWhiteSpace(card.NameKey))
			{
				throw new InvalidOperationException($"exploding card '{card.Id}' has no name (add a nameKey).");
			}

			if (card.Count < 1)
			{
				throw new InvalidOperationException($"exploding card '{card.Id}' needs a positive count.");
			}
		}

		var rules = d.Manifest.ExplodingRules ?? new ExplodingRulesConfig();
		if (rules.HandSize < 1)
		{
			throw new InvalidOperationException("explodingRules.handSize must be positive.");
		}

		if (rules.DefusesPerPlayer < 1)
		{
			throw new InvalidOperationException("explodingRules.defusesPerPlayer must be positive.");
		}

		if (rules.SeeFutureCount < 1)
		{
			throw new InvalidOperationException("explodingRules.seeFutureCount must be positive.");
		}

		if (rules.AttackDraws < 1)
		{
			throw new InvalidOperationException("explodingRules.attackDraws must be positive.");
		}

		if (rules.NopeWindowMillis < 1)
		{
			throw new InvalidOperationException("explodingRules.nopeWindowMillis must be positive.");
		}

		// The exploding family exposes no host house rules yet: reject any the package declares
		// (the same doctrine as every family — a package can't invent mechanics).
		if (d.Manifest.HouseRules.Count > 0)
		{
			throw new InvalidOperationException("the exploding family exposes no host house rules yet.");
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

		int RoleCount(string type) => deck.Where(c => c.Type == type).Sum(c => Math.Max(1, c.Count));
		var bombs = RoleCount("bomb");
		var defuses = RoleCount("defuse");
		var others = deck.Where(c => c.Type is not ("bomb" or "defuse")).Sum(c => Math.Max(1, c.Count));
		if (bombs < players.Max - 1)
		{
			throw new InvalidOperationException(
				$"the deck needs at least {players.Max - 1} bombs to seat {players.Max} players (has {bombs}).");
		}

		if (defuses < players.Max * rules.DefusesPerPlayer)
		{
			throw new InvalidOperationException(
				$"the deck needs at least {players.Max * rules.DefusesPerPlayer} defuses for {players.Max} players (has {defuses}).");
		}

		if (others < players.Max * rules.HandSize)
		{
			throw new InvalidOperationException(
				$"the deck needs at least {players.Max * rules.HandSize} non-bomb, non-defuse cards to deal {players.Max} hands of {rules.HandSize} (has {others}).");
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
		var deck = definition.ExplodingDeck
			?? throw new InvalidOperationException("exploding package has no deck (cards.json).");
		var rules = definition.Manifest.ExplodingRules ?? new ExplodingRulesConfig();

		var random = start.Random ?? new SystemRandomSource();
		var exploding = ExplodingRulebook.CreateInitialState(
			start.Players.Select(p => p.Id), deck, rules, random);

		var state = new GameState
		{
			GameType = "exploding",
			Exploding = exploding,
			ExplodingDeck = deck.ToList(),
			ExplodingRules = rules,
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
			// Open the game out loud: the deal, and the danger already lurking in the pile.
			PostStartAsync = announce => announce("game.exploding_game_started",
				new Dictionary<string, object>
				{
					["count"] = rules.HandSize,
					["bombs"] = Math.Max(0, start.Players.Count - 1),
				}),
		};
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> definition.ExplodingDeck is { } deck
			? Runtime(deck, definition.Manifest.ExplodingRules ?? new ExplodingRulesConfig())
			: null;

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> state.ExplodingDeck is { } deck
			? Runtime(deck, state.ExplodingRules ?? new ExplodingRulesConfig())
			: null;

	/// <summary>The snapshot persists the deck AND the effective rules: restoring prefers
	/// them over the re-staged manifest's defaults.</summary>
	public bool SnapshotCarriesRules => true;

	private static ExplodingRuntime Runtime(IReadOnlyList<ExplodingCardDef> deck, ExplodingRulesConfig rules)
		=> new(ExplodingRulebook.Catalog(deck), deck, rules);

	/// <summary>No dice in this family: the turn is play-actions-then-draw. Rolling must be
	/// REFUSED — null would mean "use the shared property flow".</summary>
	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> Task.FromResult<ServerResponse>(new ErrorResponse
		{
			Message = "This family has no dice",
			Code = "NO_DICE_IN_FAMILY",
		});

	/// <summary>
	/// A leaver's hand is discarded out of play and their seat leaves the walk. Runs BEFORE the
	/// generic turn pass: when the leaver held the turn, the family advances it itself (resetting
	/// the fresh turn's owed draw), so the shared flow doesn't need to.
	/// </summary>
	public async Task OnPlayerRetiredAsync(Player player, GameContext context)
	{
		if (context.GameState.Exploding is not { } exploding)
		{
			return;
		}

		var held = context.GameState.CurrentTurn == player.Id;
		ExplodingRulebook.Retire(exploding, player.Id);

		if (held && ExplodingRulebook.ActiveSeats(exploding).Count > 0)
		{
			var nextId = ExplodingRulebook.NextPlayer(exploding, player.Id);
			context.GameState.CurrentTurn = nextId;
			exploding.DrawsOwed = 1;
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
	/// The view <paramref name="playerId"/> may see: their OWN hand stays; every other hand
	/// collapses to its count and the whole draw pile collapses to its count (its order is the
	/// game's central secret — what a peek or a tuck reveals is delivered privately, once, and
	/// never stored). The discard pile stays whole (every card there is spent and face-up), and
	/// the pending action is public (the point is that everyone can react). A null player
	/// (public/spectator) sees no hand.
	/// </summary>
	public GameState ProjectFor(GameState state, string? playerId)
	{
		if (state.Exploding is not { } exploding)
		{
			return state;
		}

		var projected = exploding with
		{
			DrawPile = new List<ExplodingCardInstance>(),
			Seats = exploding.Seats.Select(seat => seat.PlayerId == playerId
				? seat
				: seat with { Hand = new List<ExplodingCardInstance>() }).ToList(),
		};
		return state with { Exploding = projected };
	}
}
