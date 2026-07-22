using CorroServer.Models;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Turn flow of the exploding family, on top of the pure
/// <see cref="ExplodingRulebook"/>. On your turn you may play action cards — each opens a
/// real-time Nope window (<see cref="NopeWindowService"/>) before it resolves — and then you
/// MUST draw to end the turn; a bomb you cannot Defuse knocks you out, and the last player
/// standing wins. The server owns the voice: an ACTION is public (the actor is always named,
/// "X plays..."), a DRAWN card's identity and a Defuse's chosen depth go ToPlayer only.
///
/// The flow logic is timer-free: playing sets the pending action, and the window service (armed
/// by the session registry when it sees a pending action) fires <see cref="ResolveWindowAsync"/>
/// when the configured window elapses. Tests drive that resolution directly. Effects apply on
/// RESOLUTION, so a Noped action never happened at all (only its spent card is on the discard).
/// </summary>
public static class ExplodingTurnFlow
{
	public static async Task<ServerResponse> PlayAsync(ExplodingPlayCommand command, Player player, GameContext context)
	{
		if (Gate(context, out var exploding) is { } gateError)
		{
			return gateError;
		}

		if (exploding.PendingAction != null)
		{
			return Illegal("game.exploding_window_open");
		}

		if (exploding.PendingBomb != null)
		{
			return Illegal("game.exploding_resolve_bomb_first");
		}

		if (exploding.PendingFavor != null)
		{
			return Illegal("game.exploding_resolve_favor_first");
		}

		var seat = exploding.Seats.FirstOrDefault(s => s.PlayerId == player.Id);
		if (seat is null || seat.Retired)
		{
			return Illegal("game.exploding_not_seated");
		}

		var instance = seat.Hand.FirstOrDefault(c => c.InstanceId == command.InstanceId);
		if (instance is null)
		{
			return Illegal("game.exploding_card_not_in_hand");
		}

		var runtime = context.Family<ExplodingRuntime>();
		var card = runtime.Catalog.GetValueOrDefault(instance.CardId);
		if (card is null)
		{
			return Illegal("game.exploding_unknown_card");
		}

		// Which cards this play spends, and its target (Favor / cat steal). Nope is its own
		// command; a bomb or a defuse is never played from the hand.
		var spent = new List<ExplodingCardInstance> { instance };
		string? targetId = null;
		switch (card.Type)
		{
			case "skip":
			case "attack":
			case "shuffle":
			case "seeFuture":
				break;

			case "favor":
				targetId = ValidTarget(exploding, player.Id, command.TargetId);
				if (targetId is null)
				{
					return Illegal("game.exploding_bad_target");
				}

				break;

			case "cat":
				{
					var second = command.SecondInstanceId is { } id2
						? seat.Hand.FirstOrDefault(c => c.InstanceId == id2) : null;
					if (second is null || !ExplodingRulebook.AreCatPair(instance, second, runtime.Catalog))
					{
						return Illegal("game.exploding_cat_needs_pair");
					}

					targetId = ValidTarget(exploding, player.Id, command.TargetId);
					if (targetId is null)
					{
						return Illegal("game.exploding_bad_target");
					}

					spent.Add(second);
					break;
				}

			default:
				return Illegal("game.exploding_not_playable");
		}

		// The cards are spent the moment they are played — even a Noped play leaves them discarded.
		foreach (var s in spent) { seat.Hand.Remove(s); exploding.DiscardPile.Add(s); }
		exploding.PendingAction = new PendingExplodingAction
		{
			ActorId = player.Id,
			CardId = card.Id,
			TargetId = targetId,
			NopeCount = 0,
			WindowStartedAt = DateTime.UtcNow,
		};
		ExplodingRulebook.SyncCounts(exploding);

		// The actor is always named — the earcon-countdown carries the reaction clock, the voice
		// carries the detail (both are fine to be cut short by a reflex Nope). A cat activation
		// spends TWO matching cards automatically, so say that explicitly instead of making it
		// sound as though the focused card was played alone.
		var playVars = new Dictionary<string, object>
		{
			["player"] = player.Name,
			["actorId"] = player.Id,
			["card"] = card.NameKey,
		};
		if (card.Type == "cat")
		{
			playVars["target"] = context.GameState.Players
				.FirstOrDefault(p => p.Id == targetId)?.Name ?? targetId!;
			await context.Announce("game.exploding_played_cat_pair", playVars);
		}
		else
		{
			await context.Announce("game.exploding_played", playVars);
		}
		return new ExplodingActionResponse { Action = "play", WindowOpen = true };
	}

	public static async Task<ServerResponse> NopeAsync(ExplodingNopeCommand command, Player player, GameContext context)
	{
		if (Gate(context, out var exploding) is { } gateError)
		{
			return gateError;
		}

		if (exploding.PendingAction is not { } pending)
		{
			return Illegal("game.exploding_nothing_to_nope");
		}

		var seat = exploding.Seats.FirstOrDefault(s => s.PlayerId == player.Id);
		if (seat is null || seat.Retired)
		{
			return Illegal("game.exploding_not_seated");
		}

		var instance = seat.Hand.FirstOrDefault(c => c.InstanceId == command.InstanceId);
		if (instance is null)
		{
			return Illegal("game.exploding_card_not_in_hand");
		}

		var runtime = context.Family<ExplodingRuntime>();
		if (runtime.Catalog.GetValueOrDefault(instance.CardId)?.Type != "nope")
		{
			return Illegal("game.exploding_not_a_nope");
		}

		seat.Hand.Remove(instance);
		exploding.DiscardPile.Add(instance);
		pending.NopeCount++;
		pending.WindowStartedAt = DateTime.UtcNow; // restart the suspense window
		ExplodingRulebook.SyncCounts(exploding);

		await context.Announce("game.exploding_noped", new()
		{
			["player"] = player.Name,
			["actorId"] = player.Id,
		});
		return new ExplodingActionResponse { Action = "nope", WindowOpen = true };
	}

	/// <summary>The Nope window elapsed: resolve the pending action — its effect if the Nope
	/// count is even, a fizzle if odd. Fired by the window timer (and directly by tests).</summary>
	public static async Task<ServerResponse> ResolveWindowAsync(GameContext context, IRandomSource random)
	{
		if (Gate(context, out var exploding) is { } gateError)
		{
			return gateError;
		}

		if (exploding.PendingAction is not { } pending)
		{
			return new ExplodingActionResponse { Action = "resolve" };
		}

		exploding.PendingAction = null;
		var actor = context.GameState.Players.FirstOrDefault(p => p.Id == pending.ActorId);
		var actorName = actor?.Name ?? pending.ActorId;

		if (ExplodingRulebook.NopeCancels(pending.NopeCount))
		{
			// Cancelled: the action never happened. The actor's turn simply continues.
			await context.Announce("game.exploding_action_cancelled", new()
			{
				["player"] = actorName,
				["actorId"] = pending.ActorId,
			});
			ExplodingRulebook.SyncCounts(exploding);
			return new ExplodingActionResponse { Action = "resolve" };
		}

		var runtime = context.Family<ExplodingRuntime>();
		var turnEnded = false;
		switch (pending.CardId is { } id && runtime.Catalog.TryGetValue(id, out var def) ? def.Type : "")
		{
			case "skip":
				await context.Announce("game.exploding_skipped", new()
				{ ["player"] = actorName, ["actorId"] = pending.ActorId });
				turnEnded = await EndOneDrawAsync(context, exploding, pending.ActorId);
				break;

			case "attack":
				await context.Announce("game.exploding_attacked", new()
				{ ["player"] = actorName, ["actorId"] = pending.ActorId });
				await AdvanceTurnAsync(context, exploding, pending.ActorId);
				exploding.DrawsOwed = runtime.Rules.AttackDraws; // the next player owes the stack
				turnEnded = true;
				break;

			case "shuffle":
				ExplodingRulebook.ShuffleDraw(exploding, random);
				await context.Announce("game.exploding_shuffled", new()
				{ ["player"] = actorName, ["actorId"] = pending.ActorId });
				break;

			case "seeFuture":
				var top = ExplodingRulebook.PeekTop(exploding, runtime.Rules.SeeFutureCount);
				await WhisperFutureAsync(context, pending.ActorId, top, runtime);
				await context.Announcer.ToAllExcept(pending.ActorId, "game.exploding_saw_future",
					new() { ["player"] = actorName });
				break;

			case "favor":
				{
					// The target must now hand the requester a card of their choice: the requester's
					// turn waits (PendingFavor), like a drawn bomb waits for its tuck.
					var targetName = context.GameState.Players.FirstOrDefault(p => p.Id == pending.TargetId)?.Name
						?? pending.TargetId ?? "";
					exploding.PendingFavor = new PendingExplodingFavor
					{
						RequesterId = pending.ActorId,
						TargetId = pending.TargetId!,
					};
					await context.Announcer.ToPlayer(pending.TargetId!, "game.exploding_favor_asked_victim",
						new() { ["player"] = actorName });
					await context.Announcer.ToAllExcept(pending.TargetId!, "game.exploding_favor_asked",
						new() { ["player"] = actorName, ["target"] = targetName });
					break;
				}

			case "cat":
				{
					// A cat pair steals a RANDOM card from the target — the actor's turn continues.
					var stolen = ExplodingRulebook.StealRandom(exploding, pending.TargetId!, pending.ActorId, random);
					var targetName = context.GameState.Players.FirstOrDefault(p => p.Id == pending.TargetId)?.Name
						?? pending.TargetId ?? "";
					if (stolen is not null)
					{
						var cardName = runtime.Catalog.GetValueOrDefault(stolen.CardId)?.NameKey ?? stolen.CardId;
						await context.Announcer.ToPlayer(pending.ActorId, "game.exploding_stole_self",
							new() { ["target"] = targetName, ["card"] = cardName, ["actorId"] = pending.ActorId });
						await context.Announcer.ToPlayer(pending.TargetId!, "game.exploding_stole_victim",
							new() { ["player"] = actorName, ["card"] = cardName });
						foreach (var other in context.GameState.Players
									 .Where(p => p.Id != pending.ActorId && p.Id != pending.TargetId && !p.IsBot))
						{
							await context.Announcer.ToPlayer(other.Id, "game.exploding_stole",
							new() { ["player"] = actorName, ["target"] = targetName });
						}
					}
					else
					{
						await context.Announce("game.exploding_stole_empty", new()
						{ ["player"] = actorName, ["actorId"] = pending.ActorId, ["target"] = targetName });
					}
					break;
				}
		}

		ExplodingRulebook.SyncCounts(exploding);
		return new ExplodingActionResponse { Action = "resolve", TurnEnded = turnEnded };
	}

	public static async Task<ServerResponse> DrawAsync(Player player, GameContext context, IRandomSource random)
	{
		if (Gate(context, out var exploding) is { } gateError)
		{
			return gateError;
		}

		if (exploding.PendingAction != null)
		{
			return Illegal("game.exploding_window_open");
		}

		if (exploding.PendingBomb != null)
		{
			return Illegal("game.exploding_resolve_bomb_first");
		}

		if (exploding.PendingFavor != null)
		{
			return Illegal("game.exploding_resolve_favor_first");
		}

		var seat = exploding.Seats.FirstOrDefault(s => s.PlayerId == player.Id);
		if (seat is null || seat.Retired)
		{
			return Illegal("game.exploding_not_seated");
		}

		var runtime = context.Family<ExplodingRuntime>();
		var card = ExplodingRulebook.DrawTop(exploding);
		if (card is null)
		{
			// The pile is empty (degenerate — a bomb usually goes first): just pass the turn.
			var passed = await EndOneDrawAsync(context, exploding, player.Id);
			return new ExplodingActionResponse { Action = "draw", TurnEnded = passed };
		}

		var def = runtime.Catalog.GetValueOrDefault(card.CardId);
		if (ExplodingRulebook.IsBomb(def))
		{
			var defuse = seat.Hand.FirstOrDefault(c => runtime.Catalog.GetValueOrDefault(c.CardId)?.Type == "defuse");
			if (defuse is not null)
			{
				seat.Hand.Remove(defuse);
				exploding.DiscardPile.Add(defuse);
				exploding.PendingBomb = new PendingExplodingBomb
				{
					PlayerId = player.Id,
					InstanceId = card.InstanceId,
					CardId = card.CardId,
				};
				ExplodingRulebook.SyncCounts(exploding);
				// Public: everyone hears the scare and the save. WHERE it goes stays secret.
				await context.Announce("game.exploding_drew_bomb_defused", new()
				{ ["player"] = player.Name, ["actorId"] = player.Id });
				return new ExplodingActionResponse { Action = "draw", AwaitingReinsert = true };
			}

			// No Defuse: the player is out. Their whole hand (and this bomb) leaves play.
			exploding.DiscardPile.Add(card);
			var place = ExplodingRulebook.ActiveSeats(exploding).Count; // includes them, at the moment they fall
			ExplodingRulebook.Retire(exploding, player.Id);
			player.FinishPlace = place;
			player.Status = PlayerStatus.Eliminated;
			await context.Announce("game.exploding_exploded", new()
			{ ["player"] = player.Name, ["actorId"] = player.Id });

			if (await EndGameIfSoleSurvivorAsync(context, exploding))
			{
				return new ExplodingActionResponse { Action = "draw", Exploded = true, GameEnded = true };
			}

			await AdvanceTurnAsync(context, exploding, player.Id);
			return new ExplodingActionResponse { Action = "draw", Exploded = true, TurnEnded = true };
		}

		// An ordinary card: into the hand. The identity is the drawer's alone. actorId does
		// not reveal anything, but marks the private line as the drawer's OWN action so the
		// client flushes it synchronously before repainting the hand with the new card.
		seat.Hand.Add(card);
		ExplodingRulebook.SyncCounts(exploding);
		await context.Announcer.ToPlayer(player.Id, "game.exploding_drew_self",
			new() { ["card"] = def?.NameKey ?? card.CardId, ["actorId"] = player.Id });
		await context.Announcer.ToAllExcept(player.Id, "game.exploding_drew",
			new() { ["player"] = player.Name, ["actorId"] = player.Id });

		var ended = await EndOneDrawAsync(context, exploding, player.Id);
		return new ExplodingActionResponse { Action = "draw", TurnEnded = ended };
	}

	public static async Task<ServerResponse> DefuseReinsertAsync(ExplodingDefuseCommand command, Player player, GameContext context)
	{
		if (Gate(context, out var exploding) is { } gateError)
		{
			return gateError;
		}

		if (exploding.PendingBomb is not { } bomb || bomb.PlayerId != player.Id)
		{
			return Illegal("game.exploding_no_bomb_pending");
		}

		ExplodingRulebook.InsertBomb(exploding,
			new ExplodingCardInstance { InstanceId = bomb.InstanceId, CardId = bomb.CardId }, command.Depth);
		exploding.PendingBomb = null;
		ExplodingRulebook.SyncCounts(exploding);

		// Private: only the tucker learns where it went (their memory is the whole point).
		await context.Announcer.ToPlayer(player.Id, "game.exploding_tucked_self",
			new() { ["depth"] = Math.Clamp(command.Depth, 0, exploding.DrawPile.Count) });

		// Drawing the bomb and defusing it WAS this turn's draw: the turn resolves now.
		var ended = await EndOneDrawAsync(context, exploding, player.Id);
		return new ExplodingActionResponse { Action = "defuse", TurnEnded = ended };
	}

	public static async Task<ServerResponse> GiveAsync(ExplodingGiveCommand command, Player player, GameContext context)
	{
		if (Gate(context, out var exploding) is { } gateError)
		{
			return gateError;
		}

		if (exploding.PendingFavor is not { } favor || favor.TargetId != player.Id)
		{
			return Illegal("game.exploding_no_favor_pending");
		}

		var moved = ExplodingRulebook.GiveCard(exploding, player.Id, favor.RequesterId, command.InstanceId);
		if (moved is null)
		{
			return Illegal("game.exploding_card_not_in_hand");
		}

		exploding.PendingFavor = null;

		var runtime = context.Family<ExplodingRuntime>();
		var requester = context.GameState.Players.FirstOrDefault(p => p.Id == favor.RequesterId);
		var requesterName = requester?.Name ?? favor.RequesterId;
		var cardName = runtime.Catalog.GetValueOrDefault(moved.CardId)?.NameKey ?? moved.CardId;

		// Private identities: the two of them learn WHICH card; the table just hears the favour paid.
		await context.Announcer.ToPlayer(favor.RequesterId, "game.exploding_favor_got_self",
			new() { ["player"] = player.Name, ["card"] = cardName });
		await context.Announcer.ToPlayer(player.Id, "game.exploding_favor_gave_self",
			new() { ["player"] = requesterName, ["card"] = cardName, ["actorId"] = player.Id });
		foreach (var other in context.GameState.Players
					 .Where(p => p.Id != favor.RequesterId && p.Id != player.Id && !p.IsBot))
		{
			await context.Announcer.ToPlayer(other.Id, "game.exploding_favor_done",
				new() { ["player"] = player.Name, ["target"] = requesterName });
		}

		ExplodingRulebook.SyncCounts(exploding);
		return new ExplodingActionResponse { Action = "give" };
	}

	// ── Shared pieces ─────────────────────────────────────────────────────────

	/// <summary>A legal target for a Favor / cat steal: a seat other than the actor that is still
	/// in the game. Returns the id, or null when it isn't valid.</summary>
	private static string? ValidTarget(ExplodingState exploding, string actorId, string? targetId)
	{
		if (string.IsNullOrEmpty(targetId) || targetId == actorId)
		{
			return null;
		}

		var seat = exploding.Seats.FirstOrDefault(s => s.PlayerId == targetId);
		return seat is { Retired: false } ? targetId : null;
	}

	private static ErrorResponse? Gate(GameContext context, out ExplodingState exploding)
	{
		exploding = context.GameState.Exploding!;
		return context.GameState.Exploding == null
			? new ErrorResponse { Message = "Not an exploding game", Code = "WRONG_FAMILY" }
			: null;
	}

	private static ErrorResponse Illegal(string reasonKey)
		=> new() { Message = reasonKey, Code = "EXPLODING_ILLEGAL" };

	/// <summary>One drawing obligation is met: if the player still owes turns (an Attack), they
	/// take another; otherwise the turn passes. Returns whether the turn passed.</summary>
	private static async Task<bool> EndOneDrawAsync(GameContext context, ExplodingState exploding, string actorId)
	{
		exploding.DrawsOwed = Math.Max(0, exploding.DrawsOwed - 1);
		if (exploding.DrawsOwed > 0)
		{
			// Still on the hook (attacked): announce that it is the SAME player's turn again.
			var me = context.GameState.Players.FirstOrDefault(p => p.Id == actorId);
			await context.Announce("game.exploding_again", new()
			{ ["player"] = me?.Name ?? actorId, ["actorId"] = actorId });
			return false;
		}
		await AdvanceTurnAsync(context, exploding, actorId);
		return true;
	}

	private static async Task AdvanceTurnAsync(GameContext context, ExplodingState exploding, string actorId)
	{
		var nextId = ExplodingRulebook.NextPlayer(exploding, actorId);
		context.GameState.CurrentTurn = nextId;
		exploding.DrawsOwed = 1;
		var next = context.GameState.Players.FirstOrDefault(p => p.Id == nextId);
		await context.Announce("game.turn_of", new()
		{ ["player"] = next?.Name ?? nextId, ["actorId"] = nextId });
	}

	/// <summary>Close the game when only one seat is left in — that player wins.</summary>
	private static async Task<bool> EndGameIfSoleSurvivorAsync(GameContext context, ExplodingState exploding)
	{
		if (ExplodingRulebook.SoleSurvivor(exploding) is not { } survivor)
		{
			return false;
		}

		var winner = context.GameState.Players.FirstOrDefault(p => p.Id == survivor.PlayerId);
		survivor.HandCount = survivor.Hand.Count;
		context.GameState.IsGameOver = true;
		context.GameState.WinnerId = survivor.PlayerId;
		context.GameState.WinnerName = winner?.Name;
		await context.Announce("game.game_over", new()
		{ ["winner"] = winner?.Name ?? survivor.PlayerId, ["actorId"] = survivor.PlayerId });
		return true;
	}

	/// <summary>See the Future: the peeked cards, in draw order, whispered to the peeker alone.
	/// One line with the names nested ($t-resolved per language); fixed slots per count (1..3),
	/// the base key stays real (the count-1 line) so the i18n scan sees a literal.</summary>
	private static async Task WhisperFutureAsync(
		GameContext context, string playerId, IReadOnlyList<ExplodingCardInstance> top, ExplodingRuntime runtime)
	{
		var keys = top.Select(i => runtime.Catalog.GetValueOrDefault(i.CardId)?.NameKey).ToList();
		if (top.Count is >= 1 and <= 3 && keys.All(k => k != null))
		{
			var suffix = top.Count == 1 ? "" : $"_{top.Count}";
			var vars = new Dictionary<string, object> { ["count"] = top.Count };
			for (var n = 0; n < top.Count; n++)
			{
				vars[$"card{n + 1}"] = keys[n]!;
			}

			await context.Announcer.ToPlayer(playerId, $"game.exploding_future{suffix}", vars);
		}
		else if (top.Count == 0)
		{
			await context.Announcer.ToPlayer(playerId, "game.exploding_future_empty");
		}
		else
		{
			foreach (var key in keys.Where(k => k != null))
			{
				await context.Announcer.ToPlayer(playerId, key!);
			}
		}
	}
}

// ── Command handlers ──────────────────────────────────────────────────────────

/// <summary>Exploding: play an action card (opens the Nope window).</summary>
public class ExplodingPlayHandler : ICommandHandler<ExplodingPlayCommand>
{
	public async Task<ServerResponse> HandleAsync(ExplodingPlayCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await ExplodingTurnFlow.PlayAsync(command, player, context);
	}
}

/// <summary>Exploding: play a Nope (off-turn).</summary>
public class ExplodingNopeHandler : ICommandHandler<ExplodingNopeCommand>
{
	public async Task<ServerResponse> HandleAsync(ExplodingNopeCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await ExplodingTurnFlow.NopeAsync(command, player, context);
	}
}

/// <summary>Exploding: draw to end the turn — carries the rulebook's randomness for a shuffle.</summary>
public class ExplodingDrawHandler : ICommandHandler<ExplodingDrawCommand>
{
	private readonly ICorroRulebook _rulebook;
	public ExplodingDrawHandler(ICorroRulebook rulebook) => _rulebook = rulebook;

	public async Task<ServerResponse> HandleAsync(ExplodingDrawCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await ExplodingTurnFlow.DrawAsync(player, context, _rulebook.RandomSource);
	}
}

/// <summary>Exploding: tuck a defused bomb back at a chosen secret depth.</summary>
public class ExplodingDefuseHandler : ICommandHandler<ExplodingDefuseCommand>
{
	public async Task<ServerResponse> HandleAsync(ExplodingDefuseCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await ExplodingTurnFlow.DefuseReinsertAsync(command, player, context);
	}
}

/// <summary>Exploding: as a Favor's target, give the requester a card of your choice (off-turn).</summary>
public class ExplodingGiveHandler : ICommandHandler<ExplodingGiveCommand>
{
	public async Task<ServerResponse> HandleAsync(ExplodingGiveCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await ExplodingTurnFlow.GiveAsync(command, player, context);
	}
}

/// <summary>Exploding: resolve the pending action once its Nope window elapsed (timer-driven).</summary>
public class ExplodingResolveWindowHandler : ICommandHandler<ExplodingResolveWindowCommand>
{
	private readonly ICorroRulebook _rulebook;
	public ExplodingResolveWindowHandler(ICorroRulebook rulebook) => _rulebook = rulebook;

	public async Task<ServerResponse> HandleAsync(ExplodingResolveWindowCommand command, GameContext context)
		=> await ExplodingTurnFlow.ResolveWindowAsync(context, _rulebook.RandomSource);
}
