using CorroServer.Models;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Flow of the draft family, on top of the pure <see cref="DraftRulebook"/>: the secret
/// simultaneous pick, the reveal once the LAST pick lands, the leftward pass, the round
/// scoring and the end-of-game dessert race. The SERVER owns the voice. Secrecy rules of
/// this genre: a committed pick's identity goes ToPlayer only (the table just hears WHO
/// has picked); the reveal is public — everyone hears every card at once.
/// </summary>
public static class DraftTurnFlow
{
	public static async Task<ServerResponse> PickAsync(DraftPickCommand command, Player player,
		GameContext context)
	{
		var draft = context.GameState.Draft;
		if (draft == null)
		{
			return new ErrorResponse { Message = "Not a draft game", Code = "WRONG_FAMILY" };
		}

		if (context.GameState.IsGameOver)
		{
			return new ErrorResponse { Message = "game.draft_game_over", Code = "GAME_OVER" };
		}

		var runtime = context.Family<DraftRuntime>();
		var result = DraftRulebook.Commit(draft, player.Id, command.InstanceId,
			command.SecondInstanceId, runtime.Catalog);
		if (!result.Ok)
		{
			return new ErrorResponse { Message = result.ReasonKey ?? "illegal", Code = "DRAFT_ILLEGAL_PICK" };
		}

		// The pick's identity is the picker's alone until the reveal; the table only
		// learns WHO has already chosen (a re-pick changes nothing for them). A double
		// pick names both cards — still to the picker alone.
		var two = result.SecondCard != null;
		// actorId marks this as the PICKER's own line so the client can voice it assertively,
		// ahead of the screen reader's reading of the newly-focused card (the picked one just
		// left the hand). Without it the pick reads AFTER the new focus — tedious in live play.
		var cardVars = new Dictionary<string, object> { ["card"] = result.Card!.NameKey, ["actorId"] = player.Id };
		if (two)
		{
			cardVars["card2"] = result.SecondCard!.NameKey;
		}

		if (result.Replaced)
		{
			await context.Announcer.ToPlayer(player.Id,
				two ? "game.draft_repicked_two_self" : "game.draft_repicked_self", cardVars);
		}
		else
		{
			await context.Announcer.ToPlayer(player.Id,
				two ? "game.draft_picked_two_self" : "game.draft_picked_self", cardVars);
			await context.Announcer.ToAllExcept(player.Id, "game.draft_picked",
				new() { ["player"] = player.Name });
		}

		if (!result.AllCommitted)
		{
			return new DraftActionResponse { Action = result.Replaced ? "repick" : "pick" };
		}

		var (roundEnded, gameEnded) = await RevealAsync(context);
		return new DraftActionResponse
		{
			Action = result.Replaced ? "repick" : "pick",
			Revealed = true,
			RoundEnded = roundEnded,
			GameEnded = gameEnded,
		};
	}

	/// <summary>The trick completed: reveal every card at once, pass the hands (or score
	/// the round when they ran out), and close the game after the final round. Reached
	/// from the LAST pick — or from a retirement that removed the last holdout (the
	/// family's OnPlayerRetiredAsync), which is why it is public.</summary>
	public static async Task<(bool RoundEnded, bool GameEnded)> RevealAsync(GameContext context)
	{
		var draft = context.GameState.Draft!;
		var runtime = context.Family<DraftRuntime>();
		var round = draft.Round;

		var reveal = DraftRulebook.Reveal(draft, runtime.Catalog);
		await context.Announce("game.draft_all_picked", new());
		foreach (var entry in reveal.Entries)
		{
			var name = context.GameState.Players.FirstOrDefault(p => p.Id == entry.Seat.PlayerId)?.Name
				?? entry.Seat.PlayerId;
			if (entry.Multiplier is { } boost)
			{
				await context.Announce("game.draft_revealed_boosted", new()
				{
					["player"] = name,
					["actorId"] = entry.Seat.PlayerId,
					["card"] = entry.Card.NameKey,
					["multiplier"] = boost.NameKey,
					["factor"] = boost.Factor,
				});
			}
			else
			{
				// The picker already heard "Coges X" when they chose it, so their own plain
				// reveal is a redundant echo — send it only to the OTHERS, for whom the pick
				// was secret. (A BOOSTED reveal keeps its self line above: the multiplier and
				// score are new information worth hearing.)
				await context.Announcer.ToAllExcept(entry.Seat.PlayerId, "game.draft_revealed", new()
				{
					["player"] = name,
					["actorId"] = entry.Seat.PlayerId,
					["card"] = entry.Card.NameKey,
				});
			}
			// The second card of a double pick: say what paid for it and that it now
			// travels with the passing hand (the next player inherits it).
			if (entry.SpentExtra is { } extra)
			{
				await context.Announce("game.draft_extra_returned", new()
				{
					["player"] = name,
					["actorId"] = entry.Seat.PlayerId,
					["extra"] = extra.NameKey,
				});
			}
		}

		if (!reveal.RoundEnded)
		{
			var handSize = draft.Seats.FirstOrDefault()?.Hand.Count ?? 0;
			await context.Announce("game.draft_hands_passed", new() { ["count"] = handSize });
			return (false, false);
		}

		// The hands ran out: score the round out loud, one line per seat.
		foreach (var score in DraftRulebook.ScoreRound(draft, runtime.Catalog, runtime.Rules))
		{
			var name = context.GameState.Players.FirstOrDefault(p => p.Id == score.Seat.PlayerId)?.Name
				?? score.Seat.PlayerId;
			await context.Announce("game.draft_round_scored", new()
			{
				["player"] = name,
				["actorId"] = score.Seat.PlayerId,
				["round"] = round,
				["points"] = score.Points,
				["total"] = score.Total,
			});
		}

		if (draft.Round < runtime.Rules.Rounds)
		{
			draft.Round++;
			DraftRulebook.DealRound(draft, runtime.Rules);
			await context.Announce("game.draft_round_started", new()
			{
				["round"] = draft.Round,
				["count"] = DraftRulebook.HandSizeFor(runtime.Rules, draft.Seats.Count),
			});
			return (true, false);
		}

		await EndGameAsync(context);
		return (true, true);
	}

	/// <summary>Game end: the dessert race (bonus/penalty lines for the affected seats),
	/// placings by score with the dessert stash as tiebreaker, and the winning line.</summary>
	private static async Task EndGameAsync(GameContext context)
	{
		var draft = context.GameState.Draft!;
		var runtime = context.Family<DraftRuntime>();

		foreach (var dessert in DraftRulebook.ScoreDesserts(draft, runtime.Rules))
		{
			var name = context.GameState.Players.FirstOrDefault(p => p.Id == dessert.Seat.PlayerId)?.Name
				?? dessert.Seat.PlayerId;
			await context.Announce(
				dessert.Delta > 0 ? "game.draft_dessert_bonus" : "game.draft_dessert_penalty", new()
				{
					["player"] = name,
					["actorId"] = dessert.Seat.PlayerId,
					["count"] = dessert.Seat.Desserts.Count,
					["points"] = Math.Abs(dessert.Delta),
					["total"] = dessert.Total,
				});
		}

		var placings = DraftRulebook.Placings(draft);
		foreach (var (seat, index) in placings.Select((s, i) => (s, i)))
		{
			var p = context.GameState.Players.FirstOrDefault(pl => pl.Id == seat.PlayerId);
			if (p != null) { p.FinishPlace = index + 1; p.Status = PlayerStatus.Finished; }
		}
		var winner = context.GameState.Players.FirstOrDefault(p => p.Id == placings[0].PlayerId);
		context.GameState.WinnerId = placings[0].PlayerId;
		context.GameState.IsGameOver = true;

		await context.Announce("game.draft_final_score", new()
		{
			["player"] = winner?.Name ?? placings[0].PlayerId,
			["actorId"] = placings[0].PlayerId,
			["total"] = placings[0].Score,
		});
		await context.Announce("game.game_over", new()
		{
			["winner"] = winner?.Name ?? placings[0].PlayerId,
			["actorId"] = placings[0].PlayerId,
		});
	}
}

/// <summary>Draft: commit (or replace) the caller's secret pick for this trick. The
/// reveal, the pass, the scoring and the game end all cascade from the LAST pick.</summary>
public class DraftPickHandler : ICommandHandler<DraftPickCommand>
{
	public async Task<ServerResponse> HandleAsync(DraftPickCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		return await DraftTurnFlow.PickAsync(command, player, context);
	}
}
