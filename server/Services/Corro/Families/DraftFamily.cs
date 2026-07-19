using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>Draft-family runtime: the deck catalog and the family rules, for the handlers.</summary>
public sealed record DraftRuntime(
	IReadOnlyDictionary<string, DraftCardDef> Catalog,
	IReadOnlyList<DraftCardDef> Deck,
	DraftRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// The draft family (simultaneous pick-and-pass drafting genre): the engine's third
/// hidden-information family — and its first SIMULTANEOUS one. There is no turn: every
/// trick all seats commit a secret pick (the command is not turn-bound, and
/// GameState.CurrentTurn stays null for the whole game); the server reveals when the last
/// one lands. No board — the package ships a deck (cards.json) and rules (manifest
/// draftRules); the client's central surface is the hand panel plus each seat's public
/// table. Hands, pending picks and the draw pile are secrets: every state that leaves
/// the server goes through <see cref="ProjectFor"/>.
/// </summary>
public sealed class DraftFamily : IGameFamily
{
	public string GameType => "draft";

	private static readonly HashSet<string> CardTypes = new()
		{ "points", "multiplier", "set", "scale", "majority", "dessert", "extra" };

	public async Task<GameDefinition> LoadDefinitionAsync(string packageDir, Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		// No board.json at all: the deck IS the game content.
		var deck = await PackageJson.ReadAsync<List<DraftCardDef>>(packageDir, "cards.json");
		return new GameDefinition { Manifest = manifest, DraftDeck = deck, Cards = new List<CardDef>(), I18n = i18n };
	}

	/// <summary>Structural checks of a draft deck: known card types with coherent scoring
	/// attributes, named cards, and enough cards to deal every round at every table size.</summary>
	public void ValidateDefinition(GameDefinition d)
	{
		var deck = d.DraftDeck
			?? throw new InvalidOperationException("draft package has no deck (cards.json).");
		if (deck.Count == 0)
		{
			throw new InvalidOperationException("draft deck has no cards.");
		}

		var ids = deck.Select(c => c.Id).ToList();
		if (ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct().Count() != ids.Count)
		{
			throw new InvalidOperationException("every draft card needs a unique id.");
		}

		foreach (var card in deck)
		{
			if (!CardTypes.Contains(card.Type))
			{
				throw new InvalidOperationException($"draft card '{card.Id}' has an unknown type '{card.Type}'.");
			}

			if (string.IsNullOrWhiteSpace(card.NameKey))
			{
				throw new InvalidOperationException($"draft card '{card.Id}' has no name (add a nameKey).");
			}

			if (card.Count < 1)
			{
				throw new InvalidOperationException($"draft card '{card.Id}' needs a positive count.");
			}

			switch (card.Type)
			{
				case "points" when card.Value < 1:
					throw new InvalidOperationException($"draft card '{card.Id}' needs a positive value.");
				case "multiplier" when card.Factor < 2:
					throw new InvalidOperationException($"draft card '{card.Id}' needs a factor of at least 2.");
				case "set" when card.SetSize < 2 || card.SetPoints < 1:
					throw new InvalidOperationException(
						$"draft card '{card.Id}' needs a setSize of at least 2 and positive setPoints.");
				case "scale" when card.Scale.Count == 0 || card.Scale.Any(step => step < 0):
					throw new InvalidOperationException(
						$"draft card '{card.Id}' needs a scale ladder of non-negative steps.");
				case "majority" when card.Icons < 1:
					throw new InvalidOperationException($"draft card '{card.Id}' needs at least one icon.");
			}
		}

		var rules = d.Manifest.DraftRules ?? new DraftRulesConfig();
		if (rules.Rounds < 1)
		{
			throw new InvalidOperationException("draftRules.rounds must be positive.");
		}

		if (rules.MajorityFirst < 1 || rules.MajoritySecond < 0)
		{
			throw new InvalidOperationException("draftRules majority prizes must not be negative.");
		}

		if (rules.DessertBonus < 0 || rules.DessertPenalty < 0)
		{
			throw new InvalidOperationException("draftRules dessert stakes must not be negative.");
		}

		// No host-customizable rules in this family yet: a manifest declaring one is a bug.
		if (d.Manifest.HouseRules.Count > 0)
		{
			throw new InvalidOperationException("the draft family declares no house rules yet.");
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
		for (var seats = players.Min; seats <= players.Max; seats++)
		{
			var handSize = DraftRulebook.HandSizeFor(rules, seats);
			if (handSize < 2)
			{
				throw new InvalidOperationException(
					$"draftRules.handSizeBase ({rules.HandSizeBase}) deals hands of {handSize} to {seats} players; at least 2 is needed.");
			}

			var needed = rules.Rounds * seats * handSize;
			if (totalCards < needed)
			{
				throw new InvalidOperationException(
					$"the deck ({totalCards} cards) is too small for {seats} players: {rules.Rounds} rounds of {handSize}-card hands need {needed}.");
			}
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
		var deck = definition.DraftDeck
			?? throw new InvalidOperationException("draft package has no deck (cards.json).");
		var rules = definition.Manifest.DraftRules ?? new DraftRulesConfig();

		var random = start.Random ?? new SystemRandomSource();
		var state = new GameState
		{
			GameType = "draft",
			Draft = DraftRulebook.CreateInitialState(
				start.Players.Select(p => p.Id), deck, rules, random),
			DraftDeck = deck.ToList(),
			DraftRules = rules,
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
			// Simultaneous family: NOBODY holds the turn, ever. Pick commands are not
			// turn-bound and the client surfaces don't show a turn holder.
			CurrentTurn = null,
			BoardName = definition.Manifest.Name is { Count: > 0 } ? new Dictionary<string, string>(definition.Manifest.Name) : null,
			CenterBrand = definition.Manifest.CenterBrand,
			Tokens = definition.Manifest.Tokens,
			Currency = definition.Manifest.Currency,
			Terminology = definition.Manifest.Terminology,
		};

		var handSize = DraftRulebook.HandSizeFor(rules, start.Players.Count);
		return new FamilyGame
		{
			State = state,
			Runtime = Runtime(deck, rules),
			// Open the first round out loud: how many cards everyone holds and what to do.
			PostStartAsync = announce => announce("game.draft_round_started",
				new Dictionary<string, object> { ["round"] = 1, ["count"] = handSize }),
		};
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> definition.DraftDeck is { } deck
			? Runtime(deck, definition.Manifest.DraftRules ?? new DraftRulesConfig())
			: null;

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> state.DraftDeck is { } deck
			? Runtime(deck, state.DraftRules ?? new DraftRulesConfig())
			: null;

	/// <summary>The snapshot persists the deck AND the effective rules: restoring prefers
	/// them over the re-staged manifest's defaults.</summary>
	public bool SnapshotCarriesRules => true;

	private static DraftRuntime Runtime(IReadOnlyList<DraftCardDef> deck, DraftRulesConfig rules)
		=> new(DraftRulebook.Catalog(deck), deck, rules);

	/// <summary>No dice in this family: the whole game is pick → reveal → pass. Rolling
	/// must be REFUSED — null would mean "use the shared property flow".</summary>
	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> Task.FromResult<ServerResponse>(new ErrorResponse
		{
			Message = "This family has no dice",
			Code = "NO_DICE_IN_FAMILY",
		});

	/// <summary>
	/// A leaver's seat is FOLDED (hand and unscored table leave the game; the seat stops
	/// counting for picks, rotation, deals and races) so play never stalls on a ghost
	/// that would never pick. When the fold completes the current trick — the leaver was
	/// the last holdout — the reveal cascade fires exactly as if they had picked.
	/// </summary>
	public async Task OnPlayerRetiredAsync(Player player, GameContext context)
	{
		if (context.GameState.Draft is not { } draft)
		{
			return;
		}

		if (DraftRulebook.Retire(draft, player.Id))
		{
			await DraftTurnFlow.RevealAsync(context);
		}
	}

	// ── Hidden information ────────────────────────────────────────────────────

	public bool HasHiddenInformation => true;

	/// <summary>
	/// The view <paramref name="playerId"/> may see: their OWN hand and pending pick stay;
	/// every other hand collapses to its count and every other pending pick to the
	/// HasPicked flag (knowing WHAT a rival committed before the reveal would break the
	/// genre). The draw pile collapses to its count for everyone. Tables, desserts and
	/// scores are public — everyone watched every reveal. A null player (public/spectator
	/// view) sees no hand at all.
	/// </summary>
	public GameState ProjectFor(GameState state, string? playerId)
	{
		if (state.Draft is not { } draft)
		{
			return state;
		}

		var projected = draft with
		{
			DrawPile = new List<DraftCardInstance>(),
			Seats = draft.Seats.Select(seat => seat.PlayerId == playerId
				? seat
				: seat with { Hand = new List<DraftCardInstance>(), CommittedInstanceId = null, CommittedSecondId = null }).ToList(),
		};
		return state with { Draft = projected };
	}
}
