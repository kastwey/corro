using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Turn flow of the assembly family, on top of the pure <see cref="AssemblyRulebook"/>:
/// play or discard, forced empty-hand passes, the end-of-turn refill, and the win. The
/// SERVER owns the voice. Secrecy rules of this genre: a PLAYED card's identity is public
/// (everyone sees it land) and gets the two-line pattern; DISCARDS are face-down (only the
/// count is spoken); the refill's identities go ToPlayer only.
/// </summary>
public static class AssemblyTurnFlow
{
	public static async Task<ServerResponse> PlayAsync(AssemblyPlayCommand command, Player player,
		GameContext context, IRandomSource random)
	{
		if (Gate(context, out var assembly) is { } gateError)
		{
			return gateError;
		}

		var runtime = context.Family<AssemblyRuntime>();
		var result = AssemblyRulebook.Play(assembly, player.Id, command.InstanceId,
			command.TargetPlayerId, command.TargetColor, command.GiveColor, runtime.Rules, runtime.Catalog);
		if (!result.Ok)
		{
			return new ErrorResponse { Message = result.ReasonKey ?? "illegal", Code = "ASSEMBLY_ILLEGAL_PLAY" };
		}

		var card = result.Card!;
		if (result.Suspended)
		{
			await AnnounceSuspensionAsync(context, player, card);
			return new AssemblyActionResponse { Action = "play", TurnEnded = false, AwaitingAnswer = true };
		}

		return await ResolvePlayAsync(context, player, result, command.TargetPlayerId, random);
	}

	/// <summary>
	/// A card has landed: say what it did (the package's voice or the engine's), then close the
	/// turn — or keep it open when the card bought more plays. Shared by the ordinary path and
	/// by a card that had to wait for the table's shield answers first.
	/// </summary>
	private static async Task<ServerResponse> ResolvePlayAsync(
		GameContext context, Player player, AssemblyRulebook.PlayResult result,
		string? targetPlayerId, IRandomSource random)
	{
		var runtime = context.Family<AssemblyRuntime>();
		var card = result.Card!;
		if (result.Fizzled)
		{
			// Everyone it could have reached shielded themselves: the card is spent for nothing.
			await context.Announce("game.assembly_play_fizzled", new()
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
				["card"] = card.NameKey,
			});
			await EndAssemblyTurnAsync(context, player, random);
			return new AssemblyActionResponse { Action = "play", TurnEnded = true };
		}

		var target = targetPlayerId is { } tid
			? context.GameState.Players.FirstOrDefault(p => p.Id == tid)
			: null;
		var visualTargetId = target?.Id ?? (card.Type is "piece" or "remedy" ? player.Id : null);
		var visualKind = card.Type switch
		{
			"piece" or "attack" or "remedy" => "card-play-rack",
			"special" when card.SpecialKind == "scrapHands" => "cards-discard",
			"special" when card.SpecialKind == "stealPiece" => "rack-transfer",
			"special" when card.SpecialKind is "swapPiece" or "fullSwap" => "rack-swap",
			"special" when card.SpecialKind == "plague" => "rack-spread",
			_ => "card-play-discard",
		};
		var playVars = VisualNarrativeVars.Add(new Dictionary<string, object>
		{
			["player"] = player.Name,
			["actorId"] = player.Id,
			["target"] = target?.Name ?? string.Empty,
			["color"] = card.Color ?? string.Empty,
		}, visualKind, player.Id, visualTargetId, card.Id,
			card.SpecialKind ?? card.Type, card.SpecialKind == "scrapHands" ? 1 : null);

		if (!string.IsNullOrEmpty(card.PlayedKey))
		{
			// The package themes this card's play in ONE line. Attacks (and targeted
			// specials) have three audiences, one line each — attacker, victim, table —
			// with the client's _victim → base fallback chain.
			if (target != null)
			{
				await context.Announcer.ToPlayer(player.Id, card.PlayedKey + "_self", playVars);
				// A card aimed at your OWN rack (the exile special usually is) has no victim
				// to tell apart from the actor — sending both lines would say it twice.
				if (target.Id != player.Id)
				{
					await context.Announcer.ToPlayer(target.Id, card.PlayedKey + "_victim", playVars);
				}

				foreach (var other in context.GameState.Players.Where(p => p.Id != player.Id && p.Id != target.Id))
				{
					await context.Announcer.ToPlayer(other.Id, card.PlayedKey, playVars);
				}
			}
			else
			{
				await context.Announce(card.PlayedKey, playVars);
			}
		}
		else
		{
			var key = card.Type switch
			{
				"piece" => "game.assembly_played_piece",
				"attack" => "game.assembly_attacked",
				"remedy" => "game.assembly_played_remedy",
				_ => "game.assembly_played_special",
			};
			// The piece's colour in playVars also drives the client's per-piece earcon
			// (assembly.piece.<color>): a pack ships one sound per piece.
			await context.Announce(key, playVars);
			await context.Announce(card.NameKey, new() { ["actorId"] = player.Id });
		}

		// How the victim's part ended up (live-play request: the hit alone didn't say).
		// The piece travels as its NameKey, nested-resolved client-side ($t), so every
		// player hears it in their own language; the victim gets the second person.
		if (result.AttackOutcome is { } outcome && target != null && result.AttackedPieceKey is { } pieceKey)
		{
			var vars = new Dictionary<string, object>
			{
				["piece"] = pieceKey,
				["target"] = target.Name,
			};
			VisualNarrativeVars.Add(vars, "outcome", player.Id, target.Id);
			await context.Announcer.ToPlayer(target.Id, $"game.assembly_hit_{outcome}_victim", vars);
			await context.Announcer.ToAllExcept(target.Id, $"game.assembly_hit_{outcome}", vars);
		}

		// What the remedy DID (live-play: "You immunized your module!" was never said —
		// curing, protecting and the definitive lock all sounded like a plain "plays a
		// remedy", for the actor AND for the table). actorId gives the first person.
		if (result.RemedyOutcome is { } remedyOutcome && result.RemediedPieceKey is { } remedied)
		{
			await context.Announce($"game.assembly_remedy_{remedyOutcome}", VisualNarrativeVars.Add(new()
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
				["piece"] = remedied,
			}, "outcome", player.Id, player.Id));
		}

		// What a steal/swap actually MOVED (live-play: the picker auto-resolves a step with
		// a single legal option, so the actor never chose — and never heard — which piece
		// they handed over). Three audiences, like the attack outcome above.
		if (result.TakenPieceKey is { } taken && target != null)
		{
			var stem = result.GivenPieceKey is { } given ? "game.assembly_swapped" : "game.assembly_stolen";
			var vars = new Dictionary<string, object>
			{
				["player"] = player.Name,
				["target"] = target.Name,
				["piece"] = taken,
			};
			if (result.GivenPieceKey is { } g)
			{
				vars["given"] = g;
			}
			VisualNarrativeVars.Add(vars, "outcome", player.Id, target.Id);

			await context.Announcer.ToPlayer(player.Id, stem + "_self", vars);
			await context.Announcer.ToPlayer(target.Id, stem + "_victim", vars);
			foreach (var other in context.GameState.Players.Where(p => p.Id != player.Id && p.Id != target.Id))
			{
				await context.Announcer.ToPlayer(other.Id, stem, vars);
			}
		}

		// An exile lifts an affliction off someone's rack for good — the actor chose the
		// rack, so the table needs to hear whose part was cleared.
		if (result.ExiledPieceKey is { } exiled && target != null)
		{
			var vars = new Dictionary<string, object>
			{
				["player"] = player.Name,
				["target"] = target.Name,
				["piece"] = exiled,
			};
			VisualNarrativeVars.Add(vars, "outcome", player.Id, target.Id);
			// Clearing your OWN rack is the commonest use, and "Ana lifts the damage off
			// Ana's part" is not a sentence anyone should have to listen to.
			var stem = target.Id == player.Id ? "game.assembly_exiled_own" : "game.assembly_exiled";
			await context.Announcer.ToPlayer(player.Id, stem + "_self", vars);
			await context.Announcer.ToAllExcept(player.Id, stem, vars);
		}

		if (result.Won)
		{
			await EndGameAsync(context, player);
			return new AssemblyActionResponse { Action = "play", GameEnded = true, TurnEnded = true };
		}

		// A doubleAct or handSwap buys more cards in the same turn. The turn only really
		// continues while the hand still has a legal play — otherwise the grant would leave
		// the player with nothing to do and no way to end their turn.
		var assemblyState = context.GameState.Assembly!;
		if (assemblyState.ExtraPlays > 0
			&& AssemblyRulebook.HasAnyLegalPlay(assemblyState, player.Id, runtime.Catalog))
		{
			await context.Announcer.ToPlayer(player.Id, "game.assembly_play_again_self",
				new() { ["count"] = assemblyState.ExtraPlays });
			await context.Announcer.ToAllExcept(player.Id, "game.assembly_play_again", new()
			{
				["player"] = player.Name,
				["count"] = assemblyState.ExtraPlays,
			});
			return new AssemblyActionResponse { Action = "play", TurnEnded = false };
		}

		await EndAssemblyTurnAsync(context, player, random);
		return new AssemblyActionResponse { Action = "play", TurnEnded = true };
	}

	public static async Task<ServerResponse> DiscardAsync(AssemblyDiscardCommand command, Player player,
		GameContext context, IRandomSource random)
	{
		if (Gate(context, out var assembly) is { } gateError)
		{
			return gateError;
		}

		var runtime = context.Family<AssemblyRuntime>();
		var result = AssemblyRulebook.Discard(assembly, player.Id, command.InstanceIds, runtime.Rules);
		if (!result.Ok)
		{
			return new ErrorResponse { Message = result.ReasonKey ?? "illegal", Code = "ASSEMBLY_ILLEGAL_PLAY" };
		}

		// Discards are FACE-DOWN in this genre: the table hears the count, never the cards.
		await context.Announce(result.Count == 0 ? "game.assembly_passed" : "game.assembly_discarded", new()
		{
			["player"] = player.Name,
			["count"] = result.Count,
			["actorId"] = player.Id,
		});

		await EndAssemblyTurnAsync(context, player, random);
		return new AssemblyActionResponse { Action = result.Count == 0 ? "pass" : "discard", TurnEnded = true };
	}

	// ── The shield: answering somebody else's card ────────────────────────────

	/// <summary>Answer the card hanging over the table: spend a shield, or let it through.</summary>
	public static async Task<ServerResponse> GuardAsync(AssemblyGuardCommand command, Player player,
		GameContext context, IRandomSource random)
	{
		if (Gate(context, out var assembly, allowPending: true) is { } gateError)
		{
			return gateError;
		}

		var runtime = context.Family<AssemblyRuntime>();
		var pending = assembly.PendingPlay;
		var result = AssemblyRulebook.Guard(assembly, player.Id, command.InstanceId, runtime.Catalog);
		if (!result.Ok)
		{
			return new ErrorResponse { Message = result.ReasonKey ?? "illegal", Code = "ASSEMBLY_ILLEGAL_PLAY" };
		}

		var cardKey = pending is { } p ? runtime.Catalog.GetValueOrDefault(p.CardId)?.NameKey : null;
		var vars = new Dictionary<string, object>
		{
			["player"] = player.Name,
			["actorId"] = player.Id,
			["card"] = cardKey ?? string.Empty,
		};
		if (result.Shielded)
		{
			VisualNarrativeVars.Add(vars, "card-play-discard", player.Id);
			await context.Announcer.ToPlayer(player.Id, "game.assembly_shielded_self", vars);
			await context.Announcer.ToAllExcept(player.Id, "game.assembly_shielded", vars);
		}
		else
		{
			await context.Announcer.ToPlayer(player.Id, "game.assembly_let_through_self", vars);
			await context.Announcer.ToAllExcept(player.Id, "game.assembly_let_through", vars);
		}

		return await AdvancePendingAsync(context, random);
	}

	/// <summary>A shield left the card looking for a new victim: the actor names one.</summary>
	public static async Task<ServerResponse> RetargetAsync(AssemblyRetargetCommand command, Player player,
		GameContext context, IRandomSource random)
	{
		if (Gate(context, out var assembly, allowPending: true) is { } gateError)
		{
			return gateError;
		}

		var runtime = context.Family<AssemblyRuntime>();
		var result = AssemblyRulebook.Retarget(assembly, player.Id, command.TargetPlayerId,
			command.TargetColor, command.GiveColor, runtime.Catalog);
		if (!result.Ok)
		{
			return new ErrorResponse { Message = result.ReasonKey ?? "illegal", Code = "ASSEMBLY_ILLEGAL_PLAY" };
		}

		return await AdvancePendingAsync(context, random);
	}

	/// <summary>
	/// Move a waiting card one step on: resolve it if nobody owes an answer any more, otherwise
	/// ask the next player (or tell the actor to re-aim) and leave the turn where it is.
	/// </summary>
	private static async Task<ServerResponse> AdvancePendingAsync(GameContext context, IRandomSource random)
	{
		var assembly = context.GameState.Assembly!;
		var runtime = context.Family<AssemblyRuntime>();
		var pending = assembly.PendingPlay;
		var resolved = AssemblyRulebook.TryResolvePending(assembly, runtime.Rules, runtime.Catalog);
		if (resolved == null)
		{
			// Still open: either the next player owes an answer, or the actor must re-aim.
			if (assembly.PendingPlay is { } still)
			{
				var actor = context.GameState.Players.FirstOrDefault(p => p.Id == still.ActorId);
				var cardKey = runtime.Catalog.GetValueOrDefault(still.CardId)?.NameKey ?? string.Empty;
				if (still.AwaitingRetarget)
				{
					await context.Announcer.ToPlayer(still.ActorId, "game.assembly_retarget_needed_self",
						new() { ["card"] = cardKey });
					await context.Announcer.ToAllExcept(still.ActorId, "game.assembly_retarget_needed",
						new() { ["player"] = actor?.Name ?? string.Empty, ["card"] = cardKey });
				}
				else
				{
					await AskNextAnswerAsync(context, still, cardKey, actor);
				}
			}

			return new AssemblyActionResponse { Action = "guard", TurnEnded = false, AwaitingAnswer = true };
		}

		var owner = context.GameState.Players.FirstOrDefault(p => p.Id == pending!.ActorId)!;
		return await ResolvePlayAsync(context, owner, resolved, pending!.TargetPlayerId, random);
	}

	/// <summary>Ask the player at the head of the queue whether they shield themselves. Only
	/// they can act until they answer, so the ask is a first-person prompt for them and news
	/// for everyone else.</summary>
	private static async Task AskNextAnswerAsync(
		GameContext context, PendingAssemblyPlay pending, string cardKey, Player? actor)
	{
		var asked = pending.AwaitingGuard[0];
		var askedPlayer = context.GameState.Players.FirstOrDefault(p => p.Id == asked);
		var vars = new Dictionary<string, object>
		{
			["player"] = actor?.Name ?? string.Empty,
			["target"] = askedPlayer?.Name ?? string.Empty,
			["card"] = cardKey,
		};
		await context.Announcer.ToPlayer(asked, "game.assembly_awaiting_answer_self", vars);
		await context.Announcer.ToAllExcept(asked, "game.assembly_awaiting_answer", vars);
	}

	/// <summary>A card was played and immediately paused: tell the table it is hanging there,
	/// and ask the first player who can answer it.</summary>
	private static async Task AnnounceSuspensionAsync(GameContext context, Player player, AssemblyCardDef card)
	{
		var pending = context.GameState.Assembly!.PendingPlay!;
		await AskNextAnswerAsync(context, pending, card.NameKey, player);
	}

	// ── Shared pieces ─────────────────────────────────────────────────────────

	/// <summary>Refuse anything that is not an answer while a card waits on the table: the
	/// turn is frozen until it resolves, so an ordinary play would jump the queue.</summary>
	private static ErrorResponse? Gate(GameContext context, out AssemblyState assembly,
		bool allowPending = false)
	{
		assembly = context.GameState.Assembly!;
		if (context.GameState.Assembly == null)
		{
			return new ErrorResponse { Message = "Not an assembly game", Code = "WRONG_FAMILY" };
		}

		return !allowPending && assembly.PendingPlay != null
			? new ErrorResponse { Message = "game.assembly_answer_pending", Code = "ASSEMBLY_ILLEGAL_PLAY" }
			: null;
	}

	/// <summary>End of turn: refill the actor, then advance through any players whose hands
	/// were emptied by an effect. An empty hand has no decision to make: it is a forced pass,
	/// followed by that player's normal refill.</summary>
	private static async Task EndAssemblyTurnAsync(GameContext context, Player player, IRandomSource random)
	{
		// Extra plays and the borrowed-hand discard block belong to the turn that bought them.
		AssemblyRulebook.ClearTurnGrants(context.GameState.Assembly!);
		await RefillAndAnnounceAsync(context, player, random);
		await AdvanceTurnAsync(context, random);
	}

	/// <summary>Refill one player's hand. Card identities remain private; the table hears
	/// only how many cards moved.</summary>
	private static async Task RefillAndAnnounceAsync(GameContext context, Player player, IRandomSource random)
	{
		var runtime = context.Family<AssemblyRuntime>();
		var drawn = AssemblyRulebook.RefillHand(context.GameState.Assembly!, player.Id, runtime.Rules, random);
		if (drawn.Count > 0)
		{
			await context.Announcer.ToAllExcept(player.Id, "game.assembly_refilled",
				VisualNarrativeVars.Add(new() { ["player"] = player.Name, ["count"] = drawn.Count },
					"card-draw", targetPlayerId: player.Id, count: drawn.Count));
			// ONE utterance with the names nested in ($t-resolved per language): a single
			// line survives a screen reader busy with the focus change, where a trailing
			// name-only line got swallowed (live-play bug: "it never says I drew").
			// i18next only resolves $t() in the TEMPLATE, so the keys have fixed slots
			// per count (1..3, the family's hand sizes); larger refills fall back to the
			// plain count + one line per card.
			var keys = drawn.Select(i => runtime.Catalog.GetValueOrDefault(i.CardId)?.NameKey).ToList();
			if (drawn.Count <= 3 && keys.All(k => k != null))
			{
				var suffix = drawn.Count == 1 ? "" : $"_{drawn.Count}";
				var vars = new Dictionary<string, object> { ["count"] = drawn.Count };
				for (var n = 0; n < drawn.Count; n++)
				{
					vars[$"card{n + 1}"] = keys[n]!;
				}
				VisualNarrativeVars.Add(vars, "card-draw", targetPlayerId: player.Id, count: drawn.Count);
				VisualNarrativeVars.AddPrivateCardIds(vars, drawn.Select(card => card.CardId));

				await context.Announcer.ToPlayer(player.Id, $"game.assembly_refilled_self{suffix}", vars);
			}
			else
			{
				var vars = VisualNarrativeVars.Add(new() { ["count"] = drawn.Count },
					"card-draw", targetPlayerId: player.Id, count: drawn.Count);
				VisualNarrativeVars.AddPrivateCardIds(vars, drawn.Select(card => card.CardId));
				await context.Announcer.ToPlayer(player.Id, "game.assembly_refilled_self_many", vars);
				foreach (var key in keys.Where(k => k != null))
				{
					await context.Announcer.ToPlayer(player.Id, key!);
				}
			}
		}
	}

	/// <summary>Advance to the next player who can make a decision. A special such as
	/// scrapHands can empty several rival hands at once; each affected player automatically
	/// passes, refills and loses that turn. The bounded walk also prevents malformed or
	/// exhausted custom decks from creating an infinite server loop.</summary>
	private static async Task AdvanceTurnAsync(GameContext context, IRandomSource random)
	{
		context.Helper.NextTurn();
		var assembly = context.GameState.Assembly!;
		var runtime = context.Family<AssemblyRuntime>();
		for (var visited = 0; visited < context.GameState.Players.Count; visited++)
		{
			var candidate = context.Helper.GetCurrentPlayer();
			if (candidate == null)
			{
				return;
			}

			var seat = assembly.Seats.FirstOrDefault(s => s.PlayerId == candidate.Id);
			if (seat == null)
			{
				break;
			}

			if (seat.Retired)
			{
				context.Helper.NextTurn();
				continue;
			}

			if (seat.Hand.Count > 0)
			{
				break;
			}

			// Preserve the same rulebook path as an explicit empty-list pass. This is a
			// forced transition rather than a client command because there is no choice.
			var pass = AssemblyRulebook.Discard(assembly, candidate.Id, Array.Empty<string>(), runtime.Rules);
			if (!pass.Ok)
			{
				break;
			}

			await context.Announce("game.assembly_passed", new()
			{
				["player"] = candidate.Name,
				["count"] = 0,
				["actorId"] = candidate.Id,
			});
			await RefillAndAnnounceAsync(context, candidate, random);
			context.Helper.NextTurn();
		}

		var next = context.Helper.GetCurrentPlayer();
		if (next != null)
		{
			await context.Announce("game.turn_of", new() { ["player"] = next.Name, ["actorId"] = next.Id });
		}
	}

	/// <summary>The rack is complete: placings (winner first, then by functional colours,
	/// then rack size), the end screen flags and the winning line.</summary>
	private static async Task EndGameAsync(GameContext context, Player winner)
	{
		var assembly = context.GameState.Assembly!;
		var runtime = context.Family<AssemblyRuntime>();

		var ordered = assembly.Seats
			.OrderByDescending(s => s.PlayerId == winner.Id
				? int.MaxValue
				: AssemblyRulebook.FunctionalColors(s))
			.ThenByDescending(s => s.Slots.Count)
			.ToList();
		foreach (var (seat, index) in ordered.Select((s, i) => (s, i)))
		{
			var p = context.GameState.Players.FirstOrDefault(pl => pl.Id == seat.PlayerId);
			if (p != null) { p.FinishPlace = index + 1; p.Status = PlayerStatus.Finished; }
		}
		context.GameState.WinnerId = winner.Id;
		context.GameState.IsGameOver = true;
		_ = runtime; // rules carry no scoring beyond the win in this family

		await context.Announce("game.game_over", new()
		{
			["winner"] = winner.Name,
			["actorId"] = winner.Id,
		});
	}
}

/// <summary>Assembly: play a card (attacks/specials carry their targeting). The end-of-turn
/// refill may reshuffle the discards through the context's randomness.</summary>
public class AssemblyPlayHandler : PlayerCommandHandler<AssemblyPlayCommand>
{
	protected override Task<ServerResponse> HandleAsync(AssemblyPlayCommand command, Player player, GameContext context)
		=> AssemblyTurnFlow.PlayAsync(command, player, context, context.Random);
}

/// <summary>Assembly: discard 1..MaxDiscard face-down (or pass with an empty hand).</summary>
public class AssemblyDiscardHandler : PlayerCommandHandler<AssemblyDiscardCommand>
{
	protected override Task<ServerResponse> HandleAsync(AssemblyDiscardCommand command, Player player, GameContext context)
		=> AssemblyTurnFlow.DiscardAsync(command, player, context, context.Random);
}

/// <summary>Assembly: answer a card played against you (off-turn) — shield or let it through.</summary>
public class AssemblyGuardHandler : PlayerCommandHandler<AssemblyGuardCommand>
{
	protected override Task<ServerResponse> HandleAsync(AssemblyGuardCommand command, Player player, GameContext context)
		=> AssemblyTurnFlow.GuardAsync(command, player, context, context.Random);
}

/// <summary>Assembly: name the new victim of a card a shield deflected.</summary>
public class AssemblyRetargetHandler : PlayerCommandHandler<AssemblyRetargetCommand>
{
	protected override Task<ServerResponse> HandleAsync(AssemblyRetargetCommand command, Player player, GameContext context)
		=> AssemblyTurnFlow.RetargetAsync(command, player, context, context.Random);
}
