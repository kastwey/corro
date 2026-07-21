using CorroServer.Models;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Turn flow of the race family, on top of the pure <see cref="RaceRulebook"/>: roll → (choose
/// piece) → move → chained bonuses → extra roll on the extra-roll value or pass the turn.
/// The SERVER owns the voice: every step is announced here with actorId + _self conventions.
/// </summary>
public static class RaceTurnFlow
{
	public static async Task<ServerResponse> ProcessRollAsync(int rolled, Player player, GameContext context)
	{
		var (board, rules, race) = Deps(context);
		if (race.PendingMove != null)
		{
			return new ErrorResponse { Message = "Resolve your pending move first", Code = "RESOLVE_MOVE_FIRST" };
		}

		// The roll is the CAUSE of the movement, so it carries the Move phase: the client
		// speaks it immediately and its announcement gate arms, holding every Resolve-phase
		// consequence below (captures, the next turn…) until the piece animation settles —
		// same contract as the property family's dice roll (see DiceRollPhaseTests).
		await context.Announcer.Announce("game.race_rolled", new()
		{
			["player"] = player.Name,
			["value"] = rolled,
			["actorId"] = player.Id,
		}, AnnouncementPhase.Move);

		var isExtra = rolled == rules.ExtraRollOn;
		race.ConsecutiveSixes = isExtra ? race.ConsecutiveSixes + 1 : 0;

		// Teams mode: a player whose own seat is complete rolls for their PARTNER's pieces
		// ("help your teammate"). Every seat-bound step below uses this mover, while the
		// announcements keep naming the actor (they rolled and chose).
		var moverId = EffectiveMoverId(context, player);

		// Third consecutive extra-roll value: the last piece moved goes home and the turn is lost.
		if (isExtra && rules.ThreeSixesPenalty && race.ConsecutiveSixes >= 3)
		{
			var punished = RaceRulebook.ApplyThreeSixesPenalty(race, moverId);
			await context.Announce(punished != null ? "game.race_three_sixes" : "game.race_three_sixes_spared",
				new() { ["player"] = player.Name, ["actorId"] = player.Id });
			await EndRaceTurnAsync(context);
			return new RaceRollResponse { Value = rolled, TurnEnded = true };
		}

		var (options, mandate) = RaceRulebook.LegalMovesForRollDetailed(board, rules, race, moverId, rolled);
		// An obligation that locked otherwise-movable pieces is voiced, so "why can't I
		// move that piece?" never goes unanswered at the table.
		// Move phase: the mandate explains the movement about to happen, so it must be
		// spoken with the roll, not held back and read after the piece already moved.
		if (mandate == "exit")
		{
			await context.Announcer.Announce("game.race_forced_exit",
				new() { ["player"] = player.Name, ["value"] = rolled, ["actorId"] = player.Id },
				AnnouncementPhase.Move);
		}
		else if (mandate == "barrier")
		{
			await context.Announcer.Announce("game.race_forced_barrier",
				new() { ["player"] = player.Name, ["value"] = rolled, ["actorId"] = player.Id },
				AnnouncementPhase.Move);
		}
		if (options.Count == 0)
		{
			await context.Announce("game.race_no_move", new() { ["player"] = player.Name, ["actorId"] = player.Id });
			if (isExtra)
			{
				await AnnounceRollAgainAsync(player, context);
				return new RaceRollResponse { Value = rolled, RollAgain = true };
			}
			await EndRaceTurnAsync(context);
			return new RaceRollResponse { Value = rolled, TurnEnded = true };
		}

		var steps = options[0].ExitsHome
			? rolled
			: RaceRulebook.EffectiveSteps(rules, RaceRulebook.SeatOf(race, moverId), rolled);

		if (options.Count == 1)
		{
			await ApplyOptionAsync(options[0], "roll", rolled, player, moverId, context);
			return new RaceRollResponse { Value = rolled };
		}

		race.PendingMove = new PendingRaceMove
		{
			PlayerId = player.Id,
			MoverId = moverId,
			Steps = steps,
			Kind = "roll",
			Rolled = rolled,
			Options = options,
		};
		// No spoken "choose a piece" line: the client's choice dialog announces itself
		// (title + options) when it takes focus, so a server line would be read twice.
		return new RaceRollResponse { Value = rolled, RequiresChoice = true };
	}

	/// <summary>
	/// Applies a chosen (or the only) move, announces it, then chases bonuses/turn end.
	/// <paramref name="moverId"/> owns the SEAT being moved: the actor themselves, or their
	/// partner once the actor's own seat is complete (teams mode).
	/// </summary>
	public static async Task ApplyOptionAsync(
		RaceMoveOption option, string kind, int rolled, Player player, string moverId, GameContext context)
	{
		var (board, rules, race) = Deps(context);
		var result = RaceRulebook.ApplyMove(race, moverId, option);
		var vars = new Dictionary<string, object> { ["player"] = player.Name, ["actorId"] = player.Id };

		// The movement line carries the Move phase for the same reason the bus departure
		// does (see CorroRulebook's bus handling): a piece CHOICE arrives as its own
		// action with no roll line, so this is the only line that can arm the client's
		// announcement gate — otherwise the consequences (capture, the next turn…) are
		// voiced the instant the choice is confirmed, before the piece has visibly moved.
		if (option.ExitsHome)
		{
			// Name the landing square so an exit is unambiguous at the table (a coalesced
			// "you rolled X… <rival> brings a piece into play" burst once read as if a
			// non-5 had exited a piece).
			await context.Announcer.Announce("game.race_exited",
				new(vars) { ["square"] = option.ToSquare }, AnnouncementPhase.Move);
		}
		else if (option.ToLocation == RacePieceLocation.Goal)
		{
			await context.Announcer.Announce("game.race_goal",
				new(vars) { ["bonus"] = rules.GoalBonus }, AnnouncementPhase.Move);
		}
		else if (option.ToLocation == RacePieceLocation.Corridor)
		{
			await context.Announcer.Announce("game.race_moved_corridor",
				new(vars) { ["square"] = option.ToSquare }, AnnouncementPhase.Move);
		}
		else
		{
			await context.Announcer.Announce("game.race_moved",
				new(vars) { ["square"] = option.ToSquare }, AnnouncementPhase.Move);
		}

		// Landing facts a sighted player sees at a glance, voiced AFTER the piece lands
		// (Resolve phase, paced by the client's gate): the fresh barrier, and the safe
		// refuge. Exits skip the safe line — every salida is safe by definition, and the
		// exit announcement already names it.
		if (result.FormedBarrier)
		{
			await context.Announce("game.race_barrier_formed", new(vars) { ["square"] = option.ToSquare });
		}
		if (!option.ExitsHome && option.ToLocation == RacePieceLocation.Circuit
			&& board.SafeSquares.Contains(option.ToSquare))
		{
			await context.Announce("game.race_landed_safe", new(vars) { ["square"] = option.ToSquare });
		}

		if (result.CapturedPlayerId is { } victimId)
		{
			var victim = context.Helper.GetPlayer(victimId);
			await context.Announce("game.race_captured",
				new(vars) { ["victim"] = victim?.Name ?? victimId, ["bonus"] = rules.CaptureBonus });
			// The victim gets a first-person message describing what happened to their piece
			await context.Announcer.ToPlayer(victimId, "game.race_captured_victim",
				new() { ["player"] = player.Name, ["square"] = option.ToSquare });
			race.PendingBonuses.Add(rules.CaptureBonus);
			race.PendingBonusKinds.Add("captureBonus");
		}
		if (result.ReachedGoal)
		{
			race.PendingBonuses.Add(rules.GoalBonus);
			race.PendingBonusKinds.Add("goalBonus");
		}
		if (result.PlayerFinished)
		{
			// The SEAT just completed belongs to the mover (the actor, or their partner in
			// teams mode): teams decide a team win or a switch to helping; solo keeps the
			// placings flow.
			if (race.TeamsMode)
			{
				await HandleSeatFinishedInTeamsAsync(rolled, player, moverId, context);
			}
			else
			{
				await HandlePlayerFinishedAsync(player, context);
			}
			return;
		}

		await ResolveFollowupsAsync(rolled, player, moverId, context);
	}

	/// <summary>
	/// Teams mode, a seat just completed. If the partner's seat is complete too, the TEAM
	/// wins (both take place 1, the rivals place 2). Otherwise the actor's own seat is the
	/// finished one: from now on their rolls move the partner's pieces — starting with any
	/// pending bonus (the goal's count-10 plays with the partner's counters, as at the table).
	/// </summary>
	private static async Task HandleSeatFinishedInTeamsAsync(
		int rolled, Player player, string moverId, GameContext context)
	{
		var (board, rules, race) = Deps(context);
		var partnerId = RaceRulebook.TeammateOf(board, race, moverId);
		var teamComplete = partnerId != null && RaceRulebook.SeatFinished(race, partnerId);

		if (teamComplete)
		{
			var mover = context.Helper.GetPlayer(moverId);
			var partner = context.Helper.GetPlayer(partnerId!);
			foreach (var p in context.GameState.Players)
			{
				p.FinishPlace = (p.Id == moverId || p.Id == partnerId) ? 1 : 2;
				p.Status = PlayerStatus.Finished;
			}
			context.GameState.WinnerId = player.Id; // the actor completed the team
			context.GameState.IsGameOver = true;
			race.PendingBonuses.Clear();
			race.PendingBonusKinds.Clear();
			await context.Announce("game.race_team_won", new()
			{
				["playerA"] = mover?.Name ?? moverId,
				["playerB"] = partner?.Name ?? partnerId!,
				["actorId"] = player.Id,
			});
			return;
		}

		await context.Announce("game.race_finished_team",
			new() { ["player"] = player.Name, ["actorId"] = player.Id });
		// Follow-ups continue on the PARTNER's seat (bonuses, extra roll or turn end).
		await ResolveFollowupsAsync(rolled, player, partnerId ?? moverId, context);
	}

	/// <summary>
	/// A player just brought their last piece to the goal. Classic table parcheesi keeps
	/// playing for the remaining places: the finisher takes the next place (the first one
	/// also takes the win), leaves the turn rotation (NextTurn skips anyone with a place),
	/// and the game only ends when a single player remains — who takes the last place.
	/// </summary>
	private static async Task HandlePlayerFinishedAsync(Player player, GameContext context)
	{
		var race = context.GameState.Race!;
		var players = context.GameState.Players;
		player.FinishPlace = players.Count(p => p.FinishPlace > 0) + 1;
		player.Status = PlayerStatus.Finished;

		var vars = new Dictionary<string, object> { ["player"] = player.Name, ["actorId"] = player.Id };
		if (player.FinishPlace == 1)
		{
			context.GameState.WinnerId = player.Id;
			await context.Announce("game.race_won", vars);
		}
		else
		{
			await context.Announce("game.race_finished", new(vars) { ["place"] = player.FinishPlace });
		}

		// A finished player has no piece left to play a pending bonus (the goal bonus of
		// their last piece) and no extra roll to claim: their run ends here, without the
		// "bonus lost" noise.
		race.PendingBonuses.Clear();
		race.PendingBonusKinds.Clear();

		var unfinished = players.Where(p => p.FinishPlace == 0 && !p.IsBankrupt).ToList();
		if (unfinished.Count <= 1)
		{
			// The one player left takes the last place implicitly: standings are complete.
			if (unfinished.Count == 1)
			{
				unfinished[0].FinishPlace = players.Count(p => p.FinishPlace > 0) + 1;
				unfinished[0].Status = PlayerStatus.Finished;
			}
			context.GameState.IsGameOver = true;
			var winner = players.FirstOrDefault(p => p.Id == context.GameState.WinnerId);
			if (winner != null)
			{
				await context.Announce("game.game_over", new()
				{
					["winner"] = winner.Name,
					["actorId"] = winner.Id,
				});
			}
			return;
		}

		await EndRaceTurnAsync(context); // NextTurn skips players holding a place
	}

	/// <summary>Plays queued bonuses (auto/choice/lost), then grants the extra roll or ends the turn.</summary>
	private static async Task ResolveFollowupsAsync(int rolled, Player player, string moverId, GameContext context)
	{
		var (board, rules, race) = Deps(context);

		while (race.PendingBonuses.Count > 0)
		{
			var steps = race.PendingBonuses[0];
			var kind = race.PendingBonusKinds[0];
			race.PendingBonuses.RemoveAt(0);
			race.PendingBonusKinds.RemoveAt(0);

			var options = RaceRulebook.LegalMoves(board, rules, race, moverId, steps);
			if (options.Count == 0)
			{
				await context.Announce("game.race_bonus_lost",
					new() { ["player"] = player.Name, ["steps"] = steps, ["actorId"] = player.Id });
				continue;
			}
			if (options.Count == 1)
			{
				await ApplyOptionAsync(options[0], kind, rolled, player, moverId, context); // re-enters here
				return;
			}
			race.PendingMove = new PendingRaceMove
			{
				PlayerId = player.Id,
				MoverId = moverId,
				Steps = steps,
				Kind = kind,
				Rolled = rolled,
				Options = options,
			};
			// Silent for the same reason as the roll path: the dialog voices itself.
			return;
		}

		if (rolled == rules.ExtraRollOn)
		{
			await AnnounceRollAgainAsync(player, context);
			return; // same player's turn continues
		}
		await EndRaceTurnAsync(context);
	}

	private static Task AnnounceRollAgainAsync(Player player, GameContext context)
		=> context.Announce("game.race_roll_again", new()
		{
			["player"] = player.Name,
			["actorId"] = player.Id,
		});

	/// <summary>The seat the actor's roll moves: their own — or their partner's once the
	/// actor's own seat is complete (teams mode).</summary>
	private static string EffectiveMoverId(GameContext context, Player player)
	{
		var race = context.GameState.Race!;
		if (!race.TeamsMode || !RaceRulebook.SeatFinished(race, player.Id))
		{
			return player.Id;
		}

		return RaceRulebook.TeammateOf(context.Family<RaceRuntime>().Board, race, player.Id) ?? player.Id;
	}

	private static async Task EndRaceTurnAsync(GameContext context)
	{
		var race = context.GameState.Race!;
		race.ConsecutiveSixes = 0;
		race.LastMovedPieceIndex = null;
		context.Helper.NextTurn();
		var next = context.Helper.GetCurrentPlayer();
		if (next != null)
		{
			await context.Announce("game.turn_of", new() { ["player"] = next.Name, ["actorId"] = next.Id });
		}
	}

	private static (Models.Corro.RaceBoardDef Board, Models.Corro.RaceRulesConfig Rules, RaceState Race) Deps(GameContext context)
	{
		var runtime = context.Family<RaceRuntime>();
		return (runtime.Board, runtime.Rules,
			context.GameState.Race ?? throw new InvalidOperationException("race state missing"));
	}
}

/// <summary>Resolves the current player's pending piece choice (race family).</summary>
public class MoveRacePieceHandler : ICommandHandler<MoveRacePieceCommand>
{
	public async Task<ServerResponse> HandleAsync(MoveRacePieceCommand command, GameContext context)
	{
		if (context.RequirePlayer(command.PlayerId, out var player) is { } error)
		{
			return error;
		}

		var race = context.GameState.Race;
		if (race?.PendingMove is not { } pending || pending.PlayerId != player.Id)
		{
			return new ErrorResponse { Message = "No pending move", Code = "NO_PENDING_MOVE" };
		}

		var option = pending.Options.FirstOrDefault(o => o.PieceIndex == command.PieceIndex);
		if (option == null)
		{
			return new ErrorResponse { Message = "That piece cannot make this move", Code = "ILLEGAL_MOVE" };
		}

		var moverId = pending.MoverId ?? player.Id;

		race.PendingMove = null;
		await RaceTurnFlow.ApplyOptionAsync(option, pending.Kind, pending.Rolled, player, moverId, context);
		return new RaceMoveResponse { PieceIndex = option.PieceIndex };
	}
}
