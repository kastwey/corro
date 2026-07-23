using CorroServer.Models;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Turn flow of the track family (snakes-and-ladders style), on top of the pure
/// <see cref="TrackRulebook"/>: roll → walk → landing effects → win or pass the turn.
/// No player decisions exist in this family — the flow is roll-and-resolve.
/// The SERVER owns the voice: every step is announced here with actorId + _self conventions.
/// </summary>
public static class TrackTurnFlow
{
	public static async Task<ServerResponse> ProcessRollAsync(int rolled, Player player, GameContext context)
	{
		var (board, rules) = context.Family<TrackRuntime>();
		var track = context.GameState.Track
			?? throw new InvalidOperationException("track state missing");

		// The roll is the CAUSE of the movement: Move phase, spoken immediately, arming the
		// client's announcement gate so every Resolve consequence below (the slide down a
		// snake, the next turn…) waits for the piece animation — same contract as the other
		// families' dice lines.
		await context.Announcer.Announce("game.track_rolled", new()
		{
			["player"] = player.Name,
			["value"] = rolled,
			["actorId"] = player.Id,
		}, AnnouncementPhase.Move);

		var result = TrackRulebook.Move(board, rules, track, player.Id, rolled);

		if (result.Landed == result.From && result.Final == result.From)
		{
			// "stay" finish rule: the overshoot loses the move.
			await context.Announce("game.track_overshoot_stay",
				VisualNarrativeVars.Add(new() { ["player"] = player.Name, ["actorId"] = player.Id },
					"outcome", targetPlayerId: player.Id, tone: "loss"));
			await EndTrackTurnAsync(context);
			return new TrackRollResponse { Value = rolled, TurnEnded = true };
		}

		// The walk itself (to where the dice landed, before effects): Move phase — it is
		// the movement line that paces the hop. The position is applied in STAGES from
		// here on, one turn segment per stage, so the piece visibly stops where the die
		// landed before sliding down a snake or up a ladder (the same checkpoint pattern
		// used by other staged moves: "land here → hop → land there").
		TrackRulebook.PositionOf(track, player.Id).Square = result.Landed;
		await context.Announcer.Announce("game.track_moved",
			VisualNarrativeVars.Add(new()
			{
				["player"] = player.Name, ["square"] = result.Landed, ["actorId"] = player.Id,
			}, "movement", player.Id, player.Id),
			AnnouncementPhase.Move);

		// The bounce is a consequence of the walk segment, spoken once the piece settles.
		if (result.Bounced)
		{
			await context.Announce("game.track_bounced",
				VisualNarrativeVars.Add(new()
				{
					["player"] = player.Name, ["square"] = result.Landed, ["actorId"] = player.Id,
				}, "detail", targetPlayerId: player.Id));
		}

		foreach (var effect in result.EffectsApplied)
		{
			// Close the previous segment (its announcements + the state standing on the
			// effect's mouth), then slide: the effect line is the CAUSE of this segment's
			// motion, so it is Move-phase — spoken as the slide starts, not after it.
			await context.Presenter.CheckpointTurnSegmentAsync();
			TrackRulebook.PositionOf(track, player.Id).Square = effect.To;
			// Direction picks the engine line ("you climb…" / "you slide down…"); the
			// shipped package THEMES these keys in its own i18n (ladder/snake wording).
			var key = effect.To > effect.From ? "game.track_effect_up" : "game.track_effect_down";
			await context.Announcer.Announce(key, VisualNarrativeVars.Add(new()
			{
				["player"] = player.Name,
				["from"] = effect.From,
				["to"] = effect.To,
				["actorId"] = player.Id,
			}, "track-effect", player.Id, player.Id,
				tone: effect.To > effect.From ? "gain" : "loss"), AnnouncementPhase.Move);
		}

		if (result.Won)
		{
			await HandlePlayerFinishedAsync(player, context);
			return new TrackRollResponse { Value = rolled, TurnEnded = true };
		}

		if (rules.RollAgainOnMax && rolled == 6)
		{
			await context.Announce("game.track_roll_again",
				new() { ["player"] = player.Name, ["actorId"] = player.Id });
			return new TrackRollResponse { Value = rolled, RollAgain = true };
		}

		await EndTrackTurnAsync(context);
		return new TrackRollResponse { Value = rolled, TurnEnded = true };
	}

	/// <summary>
	/// Reaching the final square: same placings flow as the race — the finisher takes the
	/// next place (the first also takes the win), leaves the rotation (NextTurn skips
	/// anyone with a place), and the game closes when a single player remains.
	/// </summary>
	private static async Task HandlePlayerFinishedAsync(Player player, GameContext context)
	{
		var players = context.GameState.Players;
		player.FinishPlace = players.Count(p => p.FinishPlace > 0) + 1;
		player.Status = PlayerStatus.Finished;

		var vars = VisualNarrativeVars.Add(
			new Dictionary<string, object> { ["player"] = player.Name, ["actorId"] = player.Id },
			"milestone", targetPlayerId: player.Id, tone: "gain");
		if (player.FinishPlace == 1)
		{
			context.GameState.WinnerId = player.Id;
			await context.Announce("game.track_won", vars);
		}
		else
		{
			await context.Announce("game.track_finished", new(vars) { ["place"] = player.FinishPlace });
		}

		var unfinished = players.Where(p => p.FinishPlace == 0 && !p.IsBankrupt).ToList();
		if (unfinished.Count <= 1)
		{
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

		await EndTrackTurnAsync(context);
	}

	private static async Task EndTrackTurnAsync(GameContext context)
	{
		context.Helper.NextTurn();
		var next = context.Helper.GetCurrentPlayer();
		if (next != null)
		{
			await context.Announce("game.turn_of", new() { ["player"] = next.Name, ["actorId"] = next.Id });
		}
	}
}
