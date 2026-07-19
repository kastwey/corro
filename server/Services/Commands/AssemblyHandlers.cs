using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Turn flow of the assembly family, on top of the pure <see cref="AssemblyRulebook"/>:
/// play or discard, the end-of-turn refill, and the win. The SERVER owns the voice. Secrecy
/// rules of this genre: a PLAYED card's identity is public (everyone sees it land) and gets
/// the two-line pattern; DISCARDS are face-down (only the count is spoken); the refill's
/// identities go ToPlayer only.
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

		if (!string.IsNullOrEmpty(card.PlayedKey))
		{
			// The package themes this card's play in ONE line. Attacks (and targeted
			// specials) have three audiences, one line each — attacker, victim, table —
			// with the client's _victim → base fallback chain.
			var vars = new Dictionary<string, object>
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
				["target"] = target?.Name ?? string.Empty,
			};
			if (target != null)
			{
				await context.Announcer.ToPlayer(player.Id, card.PlayedKey + "_self", vars);
				await context.Announcer.ToPlayer(target.Id, card.PlayedKey + "_victim", vars);
				foreach (var other in context.GameState.Players.Where(p => p.Id != player.Id && p.Id != target.Id))
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
			var key = card.Type switch
			{
				"piece" => "game.assembly_played_piece",
				"attack" => "game.assembly_attacked",
				"remedy" => "game.assembly_played_remedy",
				_ => "game.assembly_played_special",
			};
			await context.Announce(key, new()
			{
				["player"] = player.Name,
				["target"] = target?.Name ?? string.Empty,
				["actorId"] = player.Id,
				// The piece's colour rides along for the client's PER-PIECE earcon
				// (assembly.piece.<color>): a pack ships one sound per piece.
				["color"] = card.Color ?? string.Empty,
			});
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
			await context.Announcer.ToPlayer(target.Id, $"game.assembly_hit_{outcome}_victim", vars);
			await context.Announcer.ToAllExcept(target.Id, $"game.assembly_hit_{outcome}", vars);
		}

		// What the medicine DID (live-play: "¡Has inmunizado tu estómago!" was never said —
		// curing, protecting and the definitive lock all sounded like a plain "plays a
		// remedy", for the actor AND for the table). actorId gives the first person.
		if (result.RemedyOutcome is { } remedyOutcome && result.RemediedPieceKey is { } remedied)
		{
			await context.Announce($"game.assembly_remedy_{remedyOutcome}", new()
			{
				["player"] = player.Name,
				["actorId"] = player.Id,
				["piece"] = remedied,
			});
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

			await context.Announcer.ToPlayer(player.Id, stem + "_self", vars);
			await context.Announcer.ToPlayer(target.Id, stem + "_victim", vars);
			foreach (var other in context.GameState.Players.Where(p => p.Id != player.Id && p.Id != target.Id))
			{
				await context.Announcer.ToPlayer(other.Id, stem, vars);
			}
		}

		if (result.Won)
		{
			await EndGameAsync(context, player);
			return new AssemblyActionResponse { Action = "play", GameEnded = true, TurnEnded = true };
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

	/// <summary>End of turn: refill the actor's hand up to size (identities ToPlayer only,
	/// the table hears the count), then pass the turn.</summary>
	private static async Task EndAssemblyTurnAsync(GameContext context, Player player, IRandomSource random)
	{
		var runtime = context.Family<AssemblyRuntime>();
		var drawn = AssemblyRulebook.RefillHand(context.GameState.Assembly!, player.Id, runtime.Rules, random);
		if (drawn.Count > 0)
		{
			await context.Announcer.ToAllExcept(player.Id, "game.assembly_refilled",
				new() { ["player"] = player.Name, ["count"] = drawn.Count });
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

				await context.Announcer.ToPlayer(player.Id, $"game.assembly_refilled_self{suffix}", vars);
			}
			else
			{
				await context.Announcer.ToPlayer(player.Id, "game.assembly_refilled_self_many",
					new() { ["count"] = drawn.Count });
				foreach (var key in keys.Where(k => k != null))
				{
					await context.Announcer.ToPlayer(player.Id, key!);
				}
			}
		}

		context.Helper.NextTurn();
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

		int FunctionalColors(AssemblySeatState seat)
		{
			var functional = seat.Slots.Where(AssemblyRulebook.IsFunctional).Select(s => s.Color).ToList();
			return functional.Where(c => c != AssemblyRulebook.Wild).Distinct().Count()
				+ functional.Count(c => c == AssemblyRulebook.Wild);
		}

		var ordered = assembly.Seats
			.OrderByDescending(s => s.PlayerId == winner.Id ? int.MaxValue : FunctionalColors(s))
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

/// <summary>Assembly: play a card (attacks/specials carry their targeting). Carries the
/// rulebook for its randomness source: the end-of-turn refill may reshuffle the discards.</summary>
public class AssemblyPlayHandler : ICommandHandler<AssemblyPlayCommand>
{
	private readonly ICorroRulebook _rulebook;
	public AssemblyPlayHandler(ICorroRulebook rulebook) => _rulebook = rulebook;

	public async Task<ServerResponse> HandleAsync(AssemblyPlayCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await AssemblyTurnFlow.PlayAsync(command, player, context, _rulebook.RandomSource);
	}
}

/// <summary>Assembly: discard 1..MaxDiscard face-down (or pass with an empty hand).</summary>
public class AssemblyDiscardHandler : ICommandHandler<AssemblyDiscardCommand>
{
	private readonly ICorroRulebook _rulebook;
	public AssemblyDiscardHandler(ICorroRulebook rulebook) => _rulebook = rulebook;

	public async Task<ServerResponse> HandleAsync(AssemblyDiscardCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await AssemblyTurnFlow.DiscardAsync(command, player, context, _rulebook.RandomSource);
	}
}
