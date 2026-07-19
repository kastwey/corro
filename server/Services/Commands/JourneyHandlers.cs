using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Turn flow of the journey family, on top of the pure <see cref="JourneyRulebook"/>:
/// draw → play or discard, the coup fourré interrupt, the hand-end scoring + redeal, and the
/// match end. The SERVER owns the voice, with one secrecy rule: a PUBLIC card identity
/// (played/discarded) is announced as its own NameKey line right after the action sentence —
/// the two-line pattern of the property deck — while the PRIVATE draw identity goes ToPlayer
/// only, in a separate dispatch, so it never rides shared announcement vars.
/// </summary>
public static class JourneyTurnFlow
{
	public static async Task<ServerResponse> DrawAsync(Player player, GameContext context)
	{
		if (Gate(context, out var journey) is { } gateError)
		{
			return gateError;
		}

		if (journey.HasDrawn)
		{
			return new ErrorResponse { Message = "You already drew this turn", Code = "ALREADY_DREW" };
		}

		var result = JourneyRulebook.Draw(journey, player.Id);
		if (!result.Ok)
		{
			return new ErrorResponse { Message = result.ReasonKey ?? "empty", Code = "DECK_EMPTY" };
		}

		// Everyone hears THAT you drew; only you hear WHAT (two dispatches, never shared vars).
		await context.Announcer.ToAllExcept(player.Id, "game.journey_drew",
			new() { ["player"] = player.Name });
		await context.Announcer.ToPlayer(player.Id, "game.journey_drew_self");
		var runtime = context.Family<JourneyRuntime>();
		if (runtime.Catalog.GetValueOrDefault(result.Card!.CardId) is { } drawn)
		{
			await context.Announcer.ToPlayer(player.Id, drawn.NameKey);
		}

		return new JourneyActionResponse { Action = "draw" };
	}

	public static async Task<ServerResponse> PlayAsync(JourneyPlayCommand command, Player player, GameContext context, IRandomSource random)
	{
		if (Gate(context, out var journey) is { } gateError)
		{
			return gateError;
		}

		if (MustDrawFirst(journey) is { } drawError)
		{
			return drawError;
		}

		var runtime = context.Family<JourneyRuntime>();
		var seat = JourneyRulebook.SeatOf(journey, player.Id);
		// Captured BEFORE the play so "you just got rolling" can be celebrated after it.
		var wasStopped = JourneyRulebook.IsStopped(seat, runtime.Catalog);

		var result = JourneyRulebook.Play(journey, player.Id, command.InstanceId, command.TargetId,
			runtime.Rules, runtime.Catalog);
		if (!result.Ok)
		{
			return new ErrorResponse { Message = result.ReasonKey ?? "illegal", Code = "JOURNEY_ILLEGAL_PLAY" };
		}

		var card = result.Card!;
		// The attack's victim is a SEAT: a lone player by name, a team by its colour word.
		var victimSeat = command.TargetId is { } tid ? JourneyRulebook.SeatOf(journey, tid) : null;
		var targetName = victimSeat != null ? SeatName(context, journey, victimSeat) : null;

		if (!string.IsNullOrEmpty(card.PlayedKey))
		{
			// The package themes this card's play in ONE line ("{{player}} llena el tanque de
			// su {{token}}"), replacing the generic sentence + card-name pair. The client
			// resolves tokenId into the piece's localized name as {{token}}.
			var vars = new Dictionary<string, object>
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
				["tokenId"] = player.Token ?? string.Empty,
			};
			if (card.Type == "distance") { vars["km"] = card.Value; vars["total"] = seat.Km; }

			if (card.Type == "attack" && victimSeat != null)
			{
				// An attack has THREE audiences, one line each: the attacker ("¡Lanzas…!"),
				// the VICTIM SEAT — every member of it, in team play, addressed in the
				// PLURAL ("¡{{player}} os lanza…!") — and the table. The client falls back
				// _victim_team → _victim → base when a package skips a variant.
				var victimIds = victimSeat.Members.Select(m => m.PlayerId).ToHashSet();
				var victimSuffix = victimSeat.Members.Count > 1 ? "_victim_team" : "_victim";
				vars["target"] = targetName ?? string.Empty;
				await context.Announcer.ToPlayer(player.Id, card.PlayedKey + "_self", vars);
				foreach (var victim in victimIds)
				{
					await context.Announcer.ToPlayer(victim, card.PlayedKey + victimSuffix, vars);
				}

				foreach (var other in context.GameState.Players.Where(p => p.Id != player.Id && !victimIds.Contains(p.Id)))
				{
					await context.Announcer.ToPlayer(other.Id, card.PlayedKey, vars);
				}
			}
			else
			{
				await context.Announce(card.PlayedKey, vars);
			}
		}
		else
		{
			switch (card.Type)
			{
				case "distance":
					await context.Announce("game.journey_played_distance", new()
					{
						["player"] = player.Name,
						["km"] = card.Value,
						["total"] = seat.Km,
						["actorId"] = player.Id,
					});
					break;

				case "attack":
					await context.Announce("game.journey_attacked", new()
					{
						["player"] = player.Name,
						["target"] = targetName ?? string.Empty,
						["actorId"] = player.Id,
					});
					await context.Announce(card.NameKey, new() { ["actorId"] = player.Id });
					break;

				case "remedy":
					await context.Announce("game.journey_played_remedy", new()
					{
						["player"] = player.Name,
						["actorId"] = player.Id,
					});
					await context.Announce(card.NameKey, new() { ["actorId"] = player.Id });
					break;

				case "immunity":
					await context.Announce("game.journey_played_immunity", new()
					{
						["player"] = player.Name,
						["actorId"] = player.Id,
					});
					await context.Announce(card.NameKey, new() { ["actorId"] = player.Id });
					break;
			}
		}

		// The coup window is the VICTIM's secret: telling anyone else they hold the shield
		// would leak their hand. (Outside the switch: themed attacks pause the game too.)
		if (result.CoupOffered && journey.PendingCoup is { } coup)
		{
			await context.Announcer.ToPlayer(coup.VictimId, "game.journey_coup_offer");
		}

		// The moment that matters at the table: a remedy/immunity that clears your LAST
		// stopper puts you back on the road — say so ("¡En marcha!"), not just the card.
		if (wasStopped && !JourneyRulebook.IsStopped(seat, runtime.Catalog))
		{
			await context.Announce("game.journey_now_rolling", new()
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
			});
		}

		if (result.HandComplete || JourneyRulebook.HandOver(journey, runtime.Rules))
		{
			await EndHandAsync(context, result.HandComplete ? player : null, random);
			return new JourneyActionResponse { Action = "play", HandEnded = true, TurnEnded = true };
		}
		if (result.CoupOffered)
		{
			// The game pauses on the victim's decision; the turn advances when they answer.
			return new JourneyActionResponse { Action = "play", TurnEnded = false };
		}
		await EndJourneyTurnAsync(context);
		return new JourneyActionResponse { Action = "play", TurnEnded = true };
	}

	public static async Task<ServerResponse> DiscardAsync(JourneyDiscardCommand command, Player player, GameContext context, IRandomSource random)
	{
		if (Gate(context, out var journey) is { } gateError)
		{
			return gateError;
		}

		if (MustDrawFirst(journey) is { } drawError)
		{
			return drawError;
		}

		var runtime = context.Family<JourneyRuntime>();
		var result = JourneyRulebook.Discard(journey, player.Id, command.InstanceId, runtime.Catalog);
		if (!result.Ok)
		{
			return new ErrorResponse { Message = result.ReasonKey ?? "illegal", Code = "JOURNEY_ILLEGAL_PLAY" };
		}

		// The discard pile is face-up: the identity is public, same two-line pattern.
		await context.Announce("game.journey_discarded", new()
		{
			["player"] = player.Name,
			["actorId"] = player.Id,
		});
		if (result.Card is { } card)
		{
			await context.Announce(card.NameKey, new() { ["actorId"] = player.Id });
		}

		// Discarding the last card with an exhausted pile can end the hand.
		if (JourneyRulebook.HandOver(journey, runtime.Rules))
		{
			await EndHandAsync(context, completer: null, random);
			return new JourneyActionResponse { Action = "discard", HandEnded = true, TurnEnded = true };
		}
		await EndJourneyTurnAsync(context);
		return new JourneyActionResponse { Action = "discard", TurnEnded = true };
	}

	public static async Task<ServerResponse> ResolveCoupAsync(JourneyCoupCommand command, Player player, GameContext context)
	{
		var journey = context.GameState.Journey;
		if (journey == null)
		{
			return new ErrorResponse { Message = "Not a journey game", Code = "WRONG_FAMILY" };
		}

		var runtime = context.Family<JourneyRuntime>();
		var pending = journey.PendingCoup; // captured before the rulebook clears it
		var result = JourneyRulebook.ResolveCoup(journey, player.Id, command.Accept, runtime.Catalog);
		if (!result.Ok)
		{
			return new ErrorResponse { Message = result.ReasonKey ?? "no coup", Code = "JOURNEY_NO_COUP" };
		}

		if (result.Accepted && pending != null)
		{
			var attacker = context.GameState.Players.FirstOrDefault(p => p.Id == pending.AttackerId);
			await context.Announce("game.journey_coup", new()
			{
				["player"] = player.Name,
				["attacker"] = attacker?.Name ?? string.Empty,
				["actorId"] = player.Id,
			});
			var immunity = JourneyRulebook.SeatOf(journey, player.Id).Immunities.LastOrDefault();
			if (immunity != null && runtime.Catalog.GetValueOrDefault(immunity) is { } card)
			{
				await context.Announce(card.NameKey, new() { ["actorId"] = player.Id });
			}

			// The classic reward: the turn passes to the coup's author — unless the coup
			// played their LAST card with a dry pile (no replacement): a cardless turn
			// would deadlock, so the skip applies here too.
			journey.HasDrawn = false;
			context.GameState.CurrentTurn = player.Id;
			await SkipCardlessPlayersAsync(context);
			var current = context.Helper.GetCurrentPlayer();
			if (current != null)
			{
				await context.Announce("game.turn_of", new() { ["player"] = current.Name, ["actorId"] = current.Id });
			}

			return new JourneyActionResponse { Action = "coup", TurnEnded = true };
		}

		// Declined: silently (announcing it would reveal the shield they chose to keep).
		// The attacker's paused turn now ends the ordinary way.
		await EndJourneyTurnAsync(context);
		return new JourneyActionResponse { Action = "coup", TurnEnded = true };
	}

	// ── Shared pieces ─────────────────────────────────────────────────────────

	/// <summary>Family + interrupt gate: journey commands (except the coup answer) are
	/// rejected while a coup decision is pending.</summary>
	private static ErrorResponse? Gate(GameContext context, out JourneyState journey)
	{
		journey = context.GameState.Journey!;
		if (context.GameState.Journey == null)
		{
			return new ErrorResponse { Message = "Not a journey game", Code = "WRONG_FAMILY" };
		}

		if (journey.PendingCoup != null)
		{
			return new ErrorResponse { Message = "A coup fourré is pending", Code = "RESOLVE_COUP_FIRST" };
		}

		return null;
	}

	/// <summary>The classic turn shape: with cards still in the pile you draw BEFORE acting.</summary>
	private static ErrorResponse? MustDrawFirst(JourneyState journey)
		=> !journey.HasDrawn && journey.DrawPile.Count > 0
			? new ErrorResponse { Message = "Draw a card first", Code = "DRAW_FIRST" }
			: null;

	/// <summary>A seat's spoken identity: the lone player's name, or — shared seat — the TEAM
	/// word, sent as the `__team:&lt;colorId&gt;` convention so each client localizes it into
	/// its own language ("Equipo rojo" / "Red team"); see the announcer's resolveTeamVars.</summary>
	private static string SeatName(GameContext context, JourneyState journey, JourneySeatState seat)
		=> seat.Members.Count > 1
			? $"__team:{EnginePalette.NameFor(journey.Seats.IndexOf(seat))}"
			: context.GameState.Players.FirstOrDefault(p => p.Id == seat.PlayerId)?.Name ?? seat.PlayerId;

	private static async Task EndJourneyTurnAsync(GameContext context)
	{
		context.GameState.Journey!.HasDrawn = false;
		context.Helper.NextTurn();
		await SkipCardlessPlayersAsync(context);
		var next = context.Helper.GetCurrentPlayer();
		if (next != null)
		{
			await context.Announce("game.turn_of", new() { ["player"] = next.Name, ["actorId"] = next.Id });
		}
	}

	/// <summary>
	/// With the pile dry, an empty-handed player can neither draw, play nor discard: their
	/// turn would DEADLOCK the table (the hand only ends when EVERY hand is empty). Skip
	/// them aloud until someone who can act holds the turn. Bounded: if everyone were
	/// cardless the hand-over check would have ended the hand before reaching here.
	/// </summary>
	private static async Task SkipCardlessPlayersAsync(GameContext context)
	{
		var journey = context.GameState.Journey!;
		if (journey.DrawPile.Count > 0)
		{
			return;
		}

		var guard = context.GameState.Players.Count;
		while (guard-- > 0)
		{
			var current = context.Helper.GetCurrentPlayer();
			if (current == null)
			{
				return;
			}

			var member = journey.Seats.SelectMany(s => s.Members).FirstOrDefault(m => m.PlayerId == current.Id);
			if (member == null || member.Hand.Count > 0)
			{
				return;
			}

			await context.Announce("game.journey_no_cards_skip", new()
			{
				["player"] = current.Name,
				["actorId"] = current.Id,
			});
			context.Helper.NextTurn();
		}
	}

	/// <summary>
	/// Score the finished hand (spoken per seat, best first), then either close the match
	/// (placings by score, end screen) or redeal the next hand of the same match.
	/// </summary>
	private static async Task EndHandAsync(GameContext context, Player? completer, IRandomSource random)
	{
		var runtime = context.Family<JourneyRuntime>();
		var journey = context.GameState.Journey!;

		if (completer != null)
		{
			// The SEAT completed the trip (the completer's team, when shared).
			var completerSeat = JourneyRulebook.SeatOf(journey, completer.Id);
			await context.Announce("game.journey_hand_won", new()
			{
				["player"] = SeatName(context, journey, completerSeat),
				["goal"] = runtime.Rules.GoalKm,
				["actorId"] = completer.Id,
			});
		}
		else
		{
			await context.Announce("game.journey_hand_exhausted", null);
		}

		var scores = JourneyRulebook.ScoreHand(journey, runtime.Catalog, runtime.Rules);
		foreach (var score in scores.OrderByDescending(s => s.Total))
		{
			var seat = journey.Seats.First(s => s.PlayerId == score.PlayerId);
			await context.Announce("game.journey_hand_score", new()
			{
				["player"] = SeatName(context, journey, seat),
				["total"] = score.Total,
				["match"] = score.MatchScore,
				["actorId"] = score.PlayerId,
			});
		}

		if (JourneyRulebook.MatchOver(journey, runtime.Rules))
		{
			// Placings by match score (best first); the end screen reads FinishPlace/WinnerId
			// exactly like the race and track families. EVERY member of a seat shares its
			// place — partners win and lose together.
			var ordered = journey.Seats.OrderByDescending(s => s.Score).ToList();
			foreach (var (seat, index) in ordered.Select((s, i) => (s, i)))
			{
				foreach (var member in seat.Members)
				{
					var p = context.GameState.Players.FirstOrDefault(pl => pl.Id == member.PlayerId);
					if (p != null) { p.FinishPlace = index + 1; p.Status = PlayerStatus.Finished; }
				}
			}

			var winningSeat = ordered.FirstOrDefault();
			context.GameState.WinnerId = winningSeat?.PlayerId;
			context.GameState.IsGameOver = true;
			if (winningSeat != null)
			{
				await context.Announce("game.game_over", new()
				{
					["winner"] = SeatName(context, journey, winningSeat),
					["actorId"] = winningSeat.PlayerId,
				});
			}

			return;
		}

		// Same match, next hand: fresh deal, scores carried; the rotation simply continues.
		context.GameState.Journey = JourneyRulebook.StartNextHand(journey, runtime.Deck, runtime.Rules, random);
		await context.Announce("game.journey_new_hand", new() { ["round"] = context.GameState.Journey.Round });
		await EndJourneyTurnAsync(context);
	}
}

/// <summary>Journey: draw the top card.</summary>
public class JourneyDrawHandler : ICommandHandler<JourneyDrawCommand>
{
	public async Task<ServerResponse> HandleAsync(JourneyDrawCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await JourneyTurnFlow.DrawAsync(player, context);
	}
}

/// <summary>Journey: play a card (attacks carry the victim). Carries the rulebook for its
/// randomness source: ending a hand redeals through it (identity shuffle in E2E).</summary>
public class JourneyPlayHandler : ICommandHandler<JourneyPlayCommand>
{
	private readonly ICorroRulebook _rulebook;
	public JourneyPlayHandler(ICorroRulebook rulebook) => _rulebook = rulebook;

	public async Task<ServerResponse> HandleAsync(JourneyPlayCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await JourneyTurnFlow.PlayAsync(command, player, context, _rulebook.RandomSource);
	}
}

/// <summary>Journey: discard instead of playing (may exhaust the hand → redeal too).</summary>
public class JourneyDiscardHandler : ICommandHandler<JourneyDiscardCommand>
{
	private readonly ICorroRulebook _rulebook;
	public JourneyDiscardHandler(ICorroRulebook rulebook) => _rulebook = rulebook;

	public async Task<ServerResponse> HandleAsync(JourneyDiscardCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await JourneyTurnFlow.DiscardAsync(command, player, context, _rulebook.RandomSource);
	}
}

/// <summary>Journey: the victim's coup fourré answer (out of turn).</summary>
public class JourneyCoupHandler : ICommandHandler<JourneyCoupCommand>
{
	public async Task<ServerResponse> HandleAsync(JourneyCoupCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await JourneyTurnFlow.ResolveCoupAsync(command, player, context);
	}
}
