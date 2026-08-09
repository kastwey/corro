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
		var target = command.TargetPlayerId is { } tid
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
				await context.Announcer.ToPlayer(target.Id, card.PlayedKey + "_victim", playVars);
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
			await context.Announcer.ToPlayer(player.Id, "game.assembly_exiled_self", vars);
			await context.Announcer.ToAllExcept(player.Id, "game.assembly_exiled", vars);
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

	// ── Shared pieces ─────────────────────────────────────────────────────────

	private static ErrorResponse? Gate(GameContext context, out AssemblyState assembly)
	{
		assembly = context.GameState.Assembly!;
		return context.GameState.Assembly == null
			? new ErrorResponse { Message = "Not an assembly game", Code = "WRONG_FAMILY" }
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
