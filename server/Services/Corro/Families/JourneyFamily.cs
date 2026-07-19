using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Corro.Families;

/// <summary>Journey-family runtime: the deck catalog and the family rules, for the command handlers.</summary>
public sealed record JourneyRuntime(
	IReadOnlyDictionary<string, JourneyCardDef> Catalog,
	IReadOnlyList<JourneyCardDef> Deck,
	JourneyRulesConfig Rules) : IFamilyRuntime;

/// <summary>
/// The journey family (Mil Millas genre): the engine's first HIDDEN-INFORMATION family. There
/// is no board — the package ships a deck (cards.json) and rules (manifest journeyRules); the
/// client's central surface is the hand panel. Hands and the draw-pile order are secrets:
/// every state that leaves the server goes through <see cref="ProjectFor"/>.
/// </summary>
public sealed class JourneyFamily : IGameFamily
{
	public string GameType => "journey";

	private static readonly HashSet<string> CardTypes = new() { "distance", "attack", "remedy", "immunity" };

	public async Task<GameDefinition> LoadDefinitionAsync(string packageDir, Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n)
	{
		// No board.json at all: the deck IS the game content.
		var deck = await PackageJson.ReadAsync<List<JourneyCardDef>>(packageDir, "cards.json");
		return new GameDefinition { Manifest = manifest, JourneyDeck = deck, Cards = new List<CardDef>(), I18n = i18n };
	}

	/// <summary>Structural checks of a journey deck: known card types, coherent hazard kinds
	/// (every attack classed, every remedy/immunity answering a hazard that exists), positive
	/// distances, named cards, and a playable configuration.</summary>
	public void ValidateDefinition(GameDefinition d)
	{
		var deck = d.JourneyDeck
			?? throw new InvalidOperationException("journey package has no deck (cards.json).");
		if (deck.Count == 0)
		{
			throw new InvalidOperationException("journey deck has no cards.");
		}

		var ids = deck.Select(c => c.Id).ToList();
		if (ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct().Count() != ids.Count)
		{
			throw new InvalidOperationException("every journey card needs a unique id.");
		}

		var attackKinds = deck.Where(c => c.Type == "attack").Select(c => c.Kind).ToHashSet();
		foreach (var card in deck)
		{
			if (!CardTypes.Contains(card.Type))
			{
				throw new InvalidOperationException($"journey card '{card.Id}' has an unknown type '{card.Type}'.");
			}

			if (string.IsNullOrWhiteSpace(card.NameKey))
			{
				throw new InvalidOperationException($"journey card '{card.Id}' has no name (add a nameKey).");
			}

			if (card.Count < 1)
			{
				throw new InvalidOperationException($"journey card '{card.Id}' needs a positive count.");
			}

			switch (card.Type)
			{
				case "distance" when card.Value <= 0:
					throw new InvalidOperationException($"distance card '{card.Id}' needs a positive value.");
				case "attack" when string.IsNullOrWhiteSpace(card.Kind):
					throw new InvalidOperationException($"attack card '{card.Id}' needs a hazard kind.");
				case "attack" when card.HazardClass != "stopper" && card.HazardClass != "limiter":
					throw new InvalidOperationException($"attack card '{card.Id}' needs a hazardClass of 'stopper' or 'limiter'.");
				case "remedy" when string.IsNullOrWhiteSpace(card.Kind):
					throw new InvalidOperationException($"remedy card '{card.Id}' needs the hazard kind it cures.");
				case "remedy" when !attackKinds.Contains(card.Kind) && card.Kind != InitialHazardOf(d):
					throw new InvalidOperationException($"remedy card '{card.Id}' cures '{card.Kind}', which no attack inflicts.");
				case "immunity":
					{
						var shields = card.ShieldsKinds.Count > 0 ? card.ShieldsKinds : (card.Kind is { } k ? new List<string> { k } : new());
						if (shields.Count == 0)
						{
							throw new InvalidOperationException($"immunity card '{card.Id}' shields nothing (add kind or shieldsKinds).");
						}

						foreach (var kind in shields)
						{
							if (!attackKinds.Contains(kind) && kind != InitialHazardOf(d))
							{
								throw new InvalidOperationException($"immunity card '{card.Id}' shields '{kind}', which no attack inflicts.");
							}
						}

						break;
					}
			}
		}

		var rules = d.Manifest.JourneyRules ?? new JourneyRulesConfig();
		if (rules.GoalKm < 1)
		{
			throw new InvalidOperationException("journeyRules.goalKm must be positive.");
		}

		if (rules.HandSize < 1)
		{
			throw new InvalidOperationException("journeyRules.handSize must be positive.");
		}
		// The initial hazard must be curable, or nobody could ever start rolling.
		if (!string.IsNullOrEmpty(rules.InitialHazard)
			&& !deck.Any(c => c.Type == "remedy" && c.Kind == rules.InitialHazard)
			&& !deck.Any(c => c.Type == "immunity" && (c.ShieldsKinds.Contains(rules.InitialHazard) || c.Kind == rules.InitialHazard)))
		{
			throw new InvalidOperationException($"no remedy or immunity answers the initial hazard '{rules.InitialHazard}'.");
		}
		// The goal must be reachable with exact play: some distance value must divide into it.
		if (!deck.Any(c => c.Type == "distance"))
		{
			throw new InvalidOperationException("journey deck has no distance cards.");
		}

		// House rules must reference JOURNEY codes the engine implements (same doctrine as the
		// property family: a package can't invent mechanics).
		foreach (var rule in d.Manifest.HouseRules)
		{
			if (!HouseRuleCatalog.IsKnownJourney(rule.Id))
			{
				throw new InvalidOperationException($"journey rule '{rule.Id}' is not a known journey rule code.");
			}
		}

		// Players: enough opening hands must exist, and tokens bound the count as everywhere.
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
				$"the deck ({totalCards} cards) is too small for {players.Max} players with hands of {rules.HandSize}.");
		}

		if (d.Manifest.Tokens.Count > 0 && players.Max > d.Manifest.Tokens.Count)
		{
			throw new InvalidOperationException(
				$"players.max ({players.Max}) cannot exceed the number of tokens the package provides ({d.Manifest.Tokens.Count}).");
		}
	}

	private static string InitialHazardOf(GameDefinition d)
		=> (d.Manifest.JourneyRules ?? new JourneyRulesConfig()).InitialHazard;

	public FamilyGame CreateGame(FamilyStartContext start)
	{
		var definition = start.Definition;
		var deck = definition.JourneyDeck
			?? throw new InvalidOperationException("journey package has no deck (cards.json).");
		var rules = definition.Manifest.JourneyRules ?? new JourneyRulesConfig();
		// The host's lobby choices override the package defaults. The EFFECTIVE rules are
		// stored on the state below (State.JourneyRules), so a restore reads them back
		// instead of recomputing — see SnapshotCarriesRules.
		if (start.RuleValues is { Count: > 0 } chosen)
		{
			foreach (var (id, value) in chosen)
			{
				rules = HouseRuleCatalog.ApplyJourney(rules, id, value);
			}
		}

		// Team play: each team is ONE seat (car/km/state/score shared, hands per member).
		// Individual play is the degenerate case — every player a one-member team.
		var teams = start.Teams is { Count: > 0 } arranged
			? arranged
			: start.Players.Select(p => new List<string> { p.Id }).ToList();
		var byId = start.Players.ToDictionary(p => p.Id);
		if (teams.SelectMany(t => t).Except(byId.Keys).Any()
			|| teams.SelectMany(t => t).Count() != start.Players.Count
			|| teams.SelectMany(t => t).Distinct().Count() != start.Players.Count)
		{
			throw new InvalidOperationException("journey teams must cover every player exactly once.");
		}

		// The INTERLEAVED turn order (1,3,5,2,4,6 for three pairs) is simply the players
		// list ordering — member 0 of each team, then member 1 of each… NextTurn walks the
		// players list untouched and the interleave falls out.
		var ordered = new List<Player>();
		for (var round = 0; round < teams.Max(t => t.Count); round++)
		{
			foreach (var team in teams)
			{
				if (round < team.Count)
				{
					ordered.Add(byId[team[round]]);
				}
			}
		}

		// Everyone wears their TEAM's engine-palette colour: the seat's car on the strip,
		// the panel identity and the spoken colour word all share it. (Individual play:
		// one-member teams in join order — the same per-player palette as before.)
		var teamIndexOf = teams
			.SelectMany((team, index) => team.Select(id => (id, index)))
			.ToDictionary(x => x.id, x => x.index);

		var random = start.Random ?? new SystemRandomSource();
		var state = new GameState
		{
			GameType = "journey",
			Journey = JourneyRulebook.CreateInitialState(teams, deck, rules, random),
			JourneyDeck = deck.ToList(),
			JourneyRules = rules,
			Players = ordered.Select(p => new Player
			{
				Id = p.Id,
				Name = p.Name,
				Token = p.Token,
				IsBot = p.IsBot,
				Position = 0,
				Money = 0,
				Color = EnginePalette.ColorFor(teamIndexOf[p.Id]),
			}).ToList(),
			CurrentTurn = ordered.FirstOrDefault()?.Id,
			BoardName = definition.Manifest.Name is { Count: > 0 } ? new Dictionary<string, string>(definition.Manifest.Name) : null,
			CenterBrand = definition.Manifest.CenterBrand,
			Tokens = definition.Manifest.Tokens,
			Currency = definition.Manifest.Currency,
			Terminology = definition.Manifest.Terminology,
		};

		return new FamilyGame { State = state, Runtime = Runtime(deck, rules) };
	}

	public IFamilyRuntime? CreateRuntime(GameDefinition definition)
		=> definition.JourneyDeck is { } deck
			? Runtime(deck, definition.Manifest.JourneyRules ?? new JourneyRulesConfig())
			: null;

	public IFamilyRuntime? RuntimeFromState(GameState state)
		=> state.JourneyDeck is { } deck
			? Runtime(deck, state.JourneyRules ?? new JourneyRulesConfig())
			: null;

	/// <summary>The snapshot persists the deck AND the effective rules (house-rule choices
	/// applied at start): restoring must prefer them over the re-staged manifest's defaults.</summary>
	public bool SnapshotCarriesRules => true;

	private static JourneyRuntime Runtime(IReadOnlyList<JourneyCardDef> deck, JourneyRulesConfig rules)
		=> new(JourneyRulebook.Catalog(deck), deck, rules);

	/// <summary>No dice in this family: the turn is draw → play/discard. Rolling must be
	/// REFUSED here — returning null would mean "use the shared property flow" and the
	/// server would happily roll two dice in a card game.</summary>
	public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
		=> Task.FromResult<ServerResponse>(new ErrorResponse
		{
			Message = "This family has no dice",
			Code = "NO_DICE_IN_FAMILY",
		});

	/// <summary>
	/// A leaver's hand goes face-up to the discards (it recirculates); their TEAM keeps
	/// playing while any member remains, and only then the whole seat retires (car parked
	/// as history, no longer attackable). Runs BEFORE the generic turn pass, so a leaver
	/// who held the turn also releases the draw flag, and a coup fourré window waiting on
	/// them resolves as a silent decline (the held hazard already landed).
	/// </summary>
	public Task OnPlayerRetiredAsync(Player player, GameContext context)
	{
		if (context.GameState.Journey is not { } journey)
		{
			return Task.CompletedTask;
		}

		var seat = journey.Seats.FirstOrDefault(s => s.Members.Any(m => m.PlayerId == player.Id));
		if (seat == null)
		{
			return Task.CompletedTask;
		}

		var member = seat.Members.First(m => m.PlayerId == player.Id);
		journey.DiscardPile.AddRange(member.Hand);
		member.Hand.Clear();

		var gone = context.GameState.Players
			.Where(p => p.IsBankrupt).Select(p => p.Id).ToHashSet();
		if (seat.Members.All(m => gone.Contains(m.PlayerId)))
		{
			seat.Retired = true;
		}

		if (journey.PendingCoup is { } coup && coup.VictimId == player.Id)
		{
			journey.PendingCoup = null; // the silent decline: the hazard stays where it fell
		}

		if (context.GameState.CurrentTurn == player.Id)
		{
			journey.HasDrawn = false; // the draw belonged to the leaver, not the next turn
		}

		JourneyRulebook.SyncCounts(journey);
		return Task.CompletedTask;
	}

	// ── Hidden information ────────────────────────────────────────────────────

	public bool HasHiddenInformation => true;

	/// <summary>
	/// The view <paramref name="playerId"/> may see: their OWN hand stays; every other hand —
	/// their partner's included (official partnership rules: hands are private even between
	/// partners) — and the draw pile collapse to their counts (kept true by SyncCounts). The
	/// discard pile, kilometres, hazards and immunities are public — everyone watched them
	/// happen. A null player (public/spectator view) sees no hand at all.
	/// </summary>
	public GameState ProjectFor(GameState state, string? playerId)
	{
		if (state.Journey is not { } journey)
		{
			return state;
		}

		var projected = journey with
		{
			DrawPile = new List<JourneyCardInstance>(),
			Seats = journey.Seats.Select(seat => seat with
			{
				Members = seat.Members.Select(member => member.PlayerId == playerId
					? member
					: member with { Hand = new List<JourneyCardInstance>() }).ToList(),
			}).ToList(),
			// The pending coup names the victim's own immunity card: only they may see which.
			PendingCoup = journey.PendingCoup is { } coup && coup.VictimId != playerId
				? coup with { ImmunityInstanceId = string.Empty }
				: journey.PendingCoup,
		};
		return state with { Journey = projected };
	}
}
