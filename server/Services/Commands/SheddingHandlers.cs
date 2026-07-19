using CorroServer.Models;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Turn flow of the shedding family, on top of the pure <see cref="SheddingRulebook"/>:
/// play a matching card (wilds naming the colour), draw one and maybe play it, the
/// action effects, the automatic one-card-left shout (the SERVER speaks it — information
/// parity, never a reflex race), round scoring and the redeal. The server owns the
/// voice. Secrecy: a PLAYED card is public; a DRAWN card's identity goes ToPlayer only.
/// </summary>
public static class SheddingTurnFlow
{
	public static async Task<ServerResponse> PlayAsync(SheddingPlayCommand command, Player player,
		GameContext context, IRandomSource random)
	{
		if (Gate(context, out var shedding) is { } gateError)
		{
			return gateError;
		}

		// The last-card window closes the moment the next player acts: whoever was on the
		// hook is safe now (nobody caught them in time).
		shedding.PendingLastCardCall = null;

		var runtime = context.Family<SheddingRuntime>();
		var result = SheddingRulebook.Play(shedding, player.Id, command.InstanceId,
			command.ChosenColor, runtime.Rules, runtime.Catalog, command.ExtraInstanceIds);
		if (!result.Ok)
		{
			return new ErrorResponse { Message = result.ReasonKey ?? "illegal", Code = "SHEDDING_ILLEGAL_PLAY" };
		}

		var card = result.Card!;
		// A doubles play (several identical cards at once) announces the count; a single
		// card keeps the classic line.
		if (result.Copies > 1)
		{
			await context.Announce("game.shedding_played_doubles", new()
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
				["card"] = card.NameKey,
				["count"] = result.Copies,
			});
		}
		else
		{
			await context.Announce("game.shedding_played", new()
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
				["card"] = card.NameKey,
			});
		}
		if (card.Type is "wild" or "wildDrawFour")
		{
			await context.Announce("game.shedding_color_chosen", new()
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
				["color"] = $"colors.{result.ColorInForce}",
			});
		}
		if (result.Reversed)
		{
			await context.Announce("game.shedding_reversed", new()
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
			});
		}

		// Deliberately NO one-card-left shout (design decision with Juanjo): hand counts
		// are ON-DEMAND information — S reads your own status, Shift+S every rival's
		// count and score — so noticing a short hand stays part of the game for
		// everyone, sighted or not.
		if (result.RoundWon)
		{
			var (roundEnded, gameEnded) = await EndRoundAsync(context, player, random);
			return new SheddingActionResponse
			{
				Action = "play",
				TurnEnded = true,
				RoundEnded = roundEnded,
				GameEnded = gameEnded,
			};
		}

		// Last-card rule: playing down to one card puts you on the hook — declare it (U) or be
		// caught until the next player acts. A BOT declares automatically (correct play, never
		// a free catch); a human must say it. Set before the effect branches so every exit
		// path carries the hook. (No auto-shout: WHO is exposed is on-demand — the watch key.)
		if (runtime.Rules.LastCardCall && SheddingRulebook.SeatOf(shedding, player.Id).Hand.Count == 1)
		{
			if (player.IsBot)
			{
				await AnnounceLastCardCalledAsync(context, player);
			}
			else
			{
				shedding.PendingLastCardCall = player.Id;
			}
		}

		// Stacking rule: the draw card piled onto the penalty instead of landing it. Hand
		// the growing total to the next player, who must stack again or draw it all.
		if (result.OpensPenaltyStack)
		{
			shedding.PendingPenalty = new SheddingPenalty
			{
				Amount = result.PenaltyDraws,
				LastType = card.Type,
			};
			await context.Announce("game.shedding_stack", new()
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
				["total"] = result.PenaltyDraws,
			});
			await AdvanceTurnAsync(context, shedding, player.Id, skipOne: false);
			return new SheddingActionResponse { Action = "play", TurnEnded = true };
		}

		// The victim suffers BEFORE the turn resolves: penalty draws (identities theirs
		// alone) and the lost turn are spoken in table order.
		if (result.PenaltyDraws > 0 || result.SkipsNext)
		{
			var victimId = SheddingRulebook.NextVictim(shedding, player.Id);
			var victim = context.GameState.Players.FirstOrDefault(p => p.Id == victimId);
			if (result.PenaltyDraws > 0 && victim != null)
			{
				var drawn = SheddingRulebook.DrawInto(
					shedding, SheddingRulebook.SeatOf(shedding, victimId), result.PenaltyDraws, random);
				await context.Announce("game.shedding_drew_penalty", new()
				{
					["player"] = victim.Name,
					["actorId"] = victimId,
					["count"] = drawn.Count,
				});
				await WhisperDrawnAsync(context, victimId, drawn, runtime);
			}
			if (result.SkipsNext && victim != null)
			{
				await context.Announce("game.shedding_skipped", new()
				{
					["player"] = victim.Name,
					["actorId"] = victimId,
				});
			}
		}

		await AdvanceTurnAsync(context, shedding, player.Id, result.SkipsNext);
		return new SheddingActionResponse { Action = "play", TurnEnded = true };
	}

	public static async Task<ServerResponse> DrawAsync(Player player, GameContext context, IRandomSource random)
	{
		if (Gate(context, out var shedding) is { } gateError)
		{
			return gateError;
		}

		if (shedding.PendingDrawnPlay?.PlayerId == player.Id)
		{
			return new ErrorResponse { Message = "game.shedding_pending_decision", Code = "SHEDDING_ILLEGAL_PLAY" };
		}

		shedding.PendingLastCardCall = null; // This turn action closes any open declaration window.

		var runtime = context.Family<SheddingRuntime>();
		var seat = SheddingRulebook.SeatOf(shedding, player.Id);

		// Stacking rule: a penalty is on this player. Drawing means taking the WHOLE pile
		// (they chose not to stack) and losing the turn — no draw-and-play pause.
		if (shedding.PendingPenalty is { } pending)
		{
			var taken = SheddingRulebook.DrawInto(shedding, seat, pending.Amount, random);
			shedding.PendingPenalty = null;
			await context.Announce("game.shedding_drew_penalty", new()
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
				["count"] = taken.Count,
			});
			await WhisperDrawnAsync(context, player.Id, taken, runtime);
			await AdvanceTurnAsync(context, shedding, player.Id, skipOne: false);
			return new SheddingActionResponse { Action = "draw", TurnEnded = true };
		}
		var drawn = SheddingRulebook.DrawInto(shedding, seat, 1, random);
		if (drawn.Count == 0)
		{
			// Nearly every card sits in hands: nothing to draw, the turn just passes.
			await context.Announce("game.shedding_deck_empty", new()
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
			});
			await AdvanceTurnAsync(context, shedding, player.Id, skipOne: false);
			return new SheddingActionResponse { Action = "draw", TurnEnded = true };
		}

		await context.Announcer.ToAllExcept(player.Id, "game.shedding_drew",
			new() { ["player"] = player.Name });

		var card = runtime.Catalog[drawn[0].CardId];
		var playable = runtime.Rules.DrawnCardPlayable
			&& SheddingRulebook.CanPlay(card, seat, shedding, runtime.Rules, runtime.Catalog).Ok;
		if (playable)
		{
			// The game pauses on the drawer's choice: play it (Enter) or keep it (Space).
			shedding.PendingDrawnPlay = new PendingDrawnPlay
			{
				PlayerId = player.Id,
				InstanceId = drawn[0].InstanceId,
			};
			await context.Announcer.ToPlayer(player.Id, "game.shedding_drew_playable",
				new() { ["card"] = card.NameKey });
			return new SheddingActionResponse { Action = "draw", TurnEnded = false };
		}

		await context.Announcer.ToPlayer(player.Id, "game.shedding_drew_unplayable",
			new() { ["card"] = card.NameKey });
		await AdvanceTurnAsync(context, shedding, player.Id, skipOne: false);
		return new SheddingActionResponse { Action = "draw", TurnEnded = true };
	}

	public static async Task<ServerResponse> KeepAsync(Player player, GameContext context)
	{
		if (Gate(context, out var shedding) is { } gateError)
		{
			return gateError;
		}

		shedding.PendingLastCardCall = null; // This turn action closes any open declaration window.
		if (shedding.PendingDrawnPlay?.PlayerId != player.Id)
		{
			return new ErrorResponse { Message = "game.shedding_nothing_pending", Code = "SHEDDING_ILLEGAL_PLAY" };
		}

		shedding.PendingDrawnPlay = null;
		await context.Announce("game.shedding_kept", new()
		{
			["player"] = player.Name,
			["actorId"] = player.Id,
		});
		await AdvanceTurnAsync(context, shedding, player.Id, skipOne: false);
		return new SheddingActionResponse { Action = "keep", TurnEnded = true };
	}

	// ── Last-card declaration (house rule) ─────────────────────────────────────

	/// <summary>Declare the last card (the U key): clears the hook if it is on you. Off-turn — anyone
	/// on the hook may declare during the window.</summary>
	public static async Task<ServerResponse> DeclareLastCardAsync(Player player, GameContext context)
	{
		if (Gate(context, out var shedding) is { } gateError)
		{
			return gateError;
		}

		if (!context.Family<SheddingRuntime>().Rules.LastCardCall)
		{
			return new ErrorResponse { Message = "game.shedding_last_card_off", Code = "SHEDDING_ILLEGAL_PLAY" };
		}

		if (!SheddingRulebook.DeclareLastCard(shedding, player.Id))
		{
			return new ErrorResponse { Message = "game.shedding_last_card_nothing", Code = "SHEDDING_ILLEGAL_PLAY" };
		}

		await AnnounceLastCardCalledAsync(context, player);
		SheddingRulebook.SyncCounts(shedding);
		return new SheddingActionResponse { Action = "declareLastCard", TurnEnded = false };
	}

	/// <summary>Catch a rival who forgot the declaration (the catch key): they draw the penalty. Off-turn
	/// — anyone but the exposed player may call it, until the next player acts.</summary>
	public static async Task<ServerResponse> CatchLastCardAsync(Player player, GameContext context, IRandomSource random)
	{
		if (Gate(context, out var shedding) is { } gateError)
		{
			return gateError;
		}

		var runtime = context.Family<SheddingRuntime>();
		if (!runtime.Rules.LastCardCall)
		{
			return new ErrorResponse { Message = "game.shedding_last_card_off", Code = "SHEDDING_ILLEGAL_PLAY" };
		}

		var victimId = SheddingRulebook.CatchLastCard(shedding, player.Id);
		if (victimId == null)
		{
			return new ErrorResponse { Message = "game.shedding_last_card_no_target", Code = "SHEDDING_ILLEGAL_PLAY" };
		}

		var victim = context.GameState.Players.FirstOrDefault(p => p.Id == victimId);
		var drawn = SheddingRulebook.DrawInto(
			shedding, SheddingRulebook.SeatOf(shedding, victimId), runtime.Rules.LastCardPenalty, random);

		// Three audiences, one line each (the attack pattern): the catcher, the caught, the
		// table. The caught also hears WHICH cards they drew, privately.
		var vars = new Dictionary<string, object>
		{
			["catcher"] = player.Name,
			["victim"] = victim?.Name ?? victimId,
			["count"] = drawn.Count,
		};
		await context.Announcer.ToPlayer(player.Id, "game.shedding_last_card_caught_self", vars);
		await context.Announcer.ToPlayer(victimId, "game.shedding_last_card_caught_victim", vars);
		foreach (var other in context.GameState.Players
					 .Where(p => p.Id != player.Id && p.Id != victimId && !p.IsBot))
		{
			await context.Announcer.ToPlayer(other.Id, "game.shedding_last_card_caught", vars);
		}

		await WhisperDrawnAsync(context, victimId, drawn, runtime);

		return new SheddingActionResponse { Action = "catchLastCard", TurnEnded = false };
	}

	/// <summary>Announces the declaration in first person to the caller and third person to the table.</summary>
	private static async Task AnnounceLastCardCalledAsync(GameContext context, Player player)
		=> await context.Announce("game.shedding_last_card_called", new()
		{
			["player"] = player.Name,
			["actorId"] = player.Id,
		});

	// ── Shared pieces ─────────────────────────────────────────────────────────

	private static ErrorResponse? Gate(GameContext context, out SheddingState shedding)
	{
		shedding = context.GameState.Shedding!;
		return context.GameState.Shedding == null
			? new ErrorResponse { Message = "Not a shedding game", Code = "WRONG_FAMILY" }
			: null;
	}

	/// <summary>A penalty's identities are the victim's alone: ONE line with the names
	/// nested in ($t-resolved per language), fixed slots per count — penalties are 2 or
	/// 4 in this genre. The suffix trick keeps the base key a REAL key (the count-1
	/// line), so the i18n scan sees an existing literal.</summary>
	private static async Task WhisperDrawnAsync(
		GameContext context, string victimId, IReadOnlyList<SheddingCardInstance> drawn, SheddingRuntime runtime)
	{
		var keys = drawn.Select(i => runtime.Catalog.GetValueOrDefault(i.CardId)?.NameKey).ToList();
		if (drawn.Count is >= 1 and <= 4 && keys.All(k => k != null))
		{
			var suffix = drawn.Count == 1 ? "" : $"_{drawn.Count}";
			var vars = new Dictionary<string, object> { ["count"] = drawn.Count };
			for (var n = 0; n < drawn.Count; n++)
			{
				vars[$"card{n + 1}"] = keys[n]!;
			}

			await context.Announcer.ToPlayer(victimId, $"game.shedding_penalty_cards{suffix}", vars);
		}
		else
		{
			foreach (var key in keys.Where(k => k != null))
			{
				await context.Announcer.ToPlayer(victimId, key!);
			}
		}
	}

	/// <summary>Direction-aware turn pass (skipping the victim when the play says so).</summary>
	private static async Task AdvanceTurnAsync(
		GameContext context, SheddingState shedding, string actorId, bool skipOne)
	{
		var nextId = SheddingRulebook.NextPlayer(shedding, actorId, skipOne);
		context.GameState.CurrentTurn = nextId;
		var next = context.GameState.Players.FirstOrDefault(p => p.Id == nextId);
		await context.Announce("game.turn_of", new()
		{
			["player"] = next?.Name ?? nextId,
			["actorId"] = nextId,
		});
	}

	/// <summary>The hand emptied: collect every rival hand's points, and either open the
	/// next round (the winner leads it) or close the match.</summary>
	private static async Task<(bool RoundEnded, bool GameEnded)> EndRoundAsync(
		GameContext context, Player winner, IRandomSource random)
	{
		var shedding = context.GameState.Shedding!;
		var runtime = context.Family<SheddingRuntime>();
		var round = shedding.Round;

		var score = SheddingRulebook.ScoreRound(shedding, winner.Id, runtime.Catalog);
		await context.Announce("game.shedding_round_won", new()
		{
			["player"] = winner.Name,
			["actorId"] = winner.Id,
			["round"] = round,
			["points"] = score.Points,
			["total"] = score.Total,
		});

		if (runtime.Rules.TargetScore > 0 && score.Total < runtime.Rules.TargetScore)
		{
			shedding.Round++;
			var opener = SheddingRulebook.DealRound(shedding, runtime.Deck, runtime.Rules, random);
			context.GameState.CurrentTurn = winner.Id; // the round winner leads the next
			await context.Announce("game.shedding_round_started", new()
			{
				["round"] = shedding.Round,
				["count"] = runtime.Rules.HandSize,
				["card"] = opener.NameKey,
			});
			await context.Announce("game.turn_of", new()
			{
				["player"] = winner.Name,
				["actorId"] = winner.Id,
			});
			return (true, false);
		}

		foreach (var (seat, index) in SheddingRulebook.Placings(shedding).Select((s, i) => (s, i)))
		{
			var p = context.GameState.Players.FirstOrDefault(pl => pl.Id == seat.PlayerId);
			if (p != null) { p.FinishPlace = index + 1; p.Status = PlayerStatus.Finished; }
		}
		context.GameState.WinnerId = winner.Id;
		context.GameState.IsGameOver = true;
		await context.Announce("game.game_over", new()
		{
			["winner"] = winner.Name,
			["actorId"] = winner.Id,
		});
		return (true, true);
	}
}

/// <summary>Shedding: play a matching card (wilds carry the chosen colour). Carries the
/// rulebook for its randomness source: penalty draws may reshuffle the buried discards.</summary>
public class SheddingPlayHandler : ICommandHandler<SheddingPlayCommand>
{
	private readonly ICorroRulebook _rulebook;
	public SheddingPlayHandler(ICorroRulebook rulebook) => _rulebook = rulebook;

	public async Task<ServerResponse> HandleAsync(SheddingPlayCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await SheddingTurnFlow.PlayAsync(command, player, context, _rulebook.RandomSource);
	}
}

/// <summary>Shedding: draw one card — and maybe get the play-it-or-keep-it pause.</summary>
public class SheddingDrawHandler : ICommandHandler<SheddingDrawCommand>
{
	private readonly ICorroRulebook _rulebook;
	public SheddingDrawHandler(ICorroRulebook rulebook) => _rulebook = rulebook;

	public async Task<ServerResponse> HandleAsync(SheddingDrawCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await SheddingTurnFlow.DrawAsync(player, context, _rulebook.RandomSource);
	}
}

/// <summary>Shedding: keep the just-drawn card and pass the turn.</summary>
public class SheddingKeepHandler : ICommandHandler<SheddingKeepCommand>
{
	public async Task<ServerResponse> HandleAsync(SheddingKeepCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await SheddingTurnFlow.KeepAsync(player, context);
	}
}

/// <summary>Shedding: declare the last card. Off-turn.</summary>
public class SheddingDeclareLastCardHandler : ICommandHandler<SheddingDeclareLastCardCommand>
{
	public async Task<ServerResponse> HandleAsync(SheddingDeclareLastCardCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await SheddingTurnFlow.DeclareLastCardAsync(player, context);
	}
}

/// <summary>Shedding: catch a rival who forgot the last-card declaration. Off-turn.</summary>
public class SheddingCatchLastCardHandler : ICommandHandler<SheddingCatchLastCardCommand>
{
	private readonly ICorroRulebook _rulebook;
	public SheddingCatchLastCardHandler(ICorroRulebook rulebook) => _rulebook = rulebook;

	public async Task<ServerResponse> HandleAsync(SheddingCatchLastCardCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await SheddingTurnFlow.CatchLastCardAsync(player, context, _rulebook.RandomSource);
	}
}
