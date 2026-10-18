using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>Authoritative flow around the pure bluff rulebook: the guards every command shares,
/// the phase transitions (the vote opens, the final opens, the reveal) and their voice.</summary>
public static class BluffRoundFlow
{
	public static ErrorResponse? RequireState(
		GameContext context,
		out BluffState state,
		out BluffRuntime runtime)
	{
		state = context.GameState.Bluff!;
		if (context.GameState.GameType != "bluff" || context.GameState.Bluff is null)
		{
			runtime = null!;
			return new ErrorResponse { Message = "Wrong game family", Code = "WRONG_FAMILY" };
		}
		runtime = context.FamilyRuntime as BluffRuntime
			?? new BluffRuntime(context.GameState.BluffRules ?? new BluffRulesConfig());
		return null;
	}

	/// <summary>The round the caller believes they are acting in must still be the live one:
	/// a slow tap after a timeout would otherwise write into the round that replaced it.</summary>
	public static ErrorResponse? RequireRound(BluffState state, int roundNumber)
		=> roundNumber != state.Round.RoundNumber
			? new ErrorResponse { Message = "That round has already moved on", Code = "BLUFF_STALE_ROUND" }
			: null;

	public static ErrorResponse? RequirePhase(BluffState state, BluffPhase phase)
		=> state.Round.Phase != phase
			? new ErrorResponse { Message = "The round is not at that stage", Code = "BLUFF_WRONG_PHASE" }
			: null;

	/// <summary>Only the master opens a round and moves the table past a reveal.</summary>
	public static ErrorResponse? RequireMaster(BluffState state, string playerId)
		=> state.MasterId != playerId
			? new ErrorResponse { Message = "Only the host runs the table", Code = "BLUFF_NOT_MASTER" }
			: null;

	public static bool DeadlinePassed(BluffState state)
		=> BluffRulebook.IsExpired(state.Round, DateTime.UtcNow);

	/// <summary>
	/// Whether this one finish or vote is worth a table-wide snapshot. In a hall, two hundred
	/// people finishing within a minute would be two hundred broadcasts to two hundred screens
	/// for a counter nobody reads to the unit; the counter moves at every tenth, in the last
	/// three, and of course when the phase closes. A small table still sees every one.
	/// </summary>
	internal static bool ProgressWorthBroadcasting(int remaining, int total)
	{
		if (remaining <= 3)
		{
			return true;
		}
		var step = Math.Max(1, total / 10);
		return (total - remaining) % step == 0;
	}

	/// <summary>Close the writing and open the first vote, whether the clock ran out or the last
	/// writer finished early.</summary>
	public static async Task<BluffActionResponse> OpenVotingAsync(
		GameContext context,
		BluffRulesConfig rules,
		string action,
		bool timedOut)
	{
		var state = context.GameState.Bluff!;
		BluffRulebook.CloseWriting(state.Round, rules, context.Random, DateTime.UtcNow);
		await context.Announce(timedOut ? "game.bluff_time_up_writing" : "game.bluff_writing_closed", new()
		{
			["count"] = state.Round.Lies.Count,
		});
		await context.Announce("game.bluff_voting_started", new()
		{
			["seconds"] = state.Round.DurationSeconds,
		});
		return new BluffActionResponse { Action = action, PhaseEnded = true };
	}

	/// <summary>Close the first vote: the final opens on a big table, the reveal on a small one.</summary>
	public static async Task<BluffActionResponse> CloseVotingAsync(
		GameContext context,
		BluffRulesConfig rules,
		string action,
		bool timedOut)
	{
		var state = context.GameState.Bluff!;
		if (timedOut)
		{
			await context.Announce("game.bluff_time_up_voting", null);
		}
		if (BluffRulebook.CloseVoting(state.Round, rules, context.Random, DateTime.UtcNow))
		{
			await context.Announce("game.bluff_final_started", new()
			{
				["count"] = state.Round.Lies.Count(lie => lie.Finalist),
				["seconds"] = state.Round.DurationSeconds,
			});
			return new BluffActionResponse { Action = action, PhaseEnded = true };
		}
		await RevealAsync(context, rules);
		return new BluffActionResponse { Action = action, PhaseEnded = true, RoundEnded = true };
	}

	public static async Task<BluffActionResponse> CloseFinalAsync(
		GameContext context,
		BluffRulesConfig rules,
		string action,
		bool timedOut)
	{
		var state = context.GameState.Bluff!;
		if (timedOut)
		{
			await context.Announce("game.bluff_time_up_voting", null);
		}
		BluffRulebook.CloseFinal(state.Round);
		await RevealAsync(context, rules);
		return new BluffActionResponse { Action = action, PhaseEnded = true, RoundEnded = true };
	}

	/// <summary>
	/// The room hears three sentences — the truth and how many found it, the bluff that fooled
	/// the most and whose it was, the funniest and whose — and each player hears privately what
	/// their own round came to, which is the part no summary can carry. The leader is named last,
	/// so the standings are one line and not two hundred.
	/// </summary>
	public static async Task RevealAsync(GameContext context, BluffRulesConfig rules)
	{
		var gameState = context.GameState;
		var state = gameState.Bluff!;
		var round = state.Round;
		var reveal = BluffRulebook.Score(state, round, rules);

		await context.Announce("game.bluff_reveal_truth", VisualNarrativeVars.Add(new()
		{
			["truth"] = round.Truth,
			["count"] = reveal.TruthFinderCount,
		}, "outcome", count: reveal.TruthFinderCount, tone: reveal.TruthFinderCount > 0 ? "gain" : "neutral"));

		var best = round.Lies.FirstOrDefault(lie => lie.Id == reveal.BestLieId);
		if (best is not null)
		{
			await AnnounceLieAsync(context, "game.bluff_reveal_best", best,
				best.BelieverIds.Count + best.FinalBelieverIds.Count);
		}
		var funniest = round.Lies.FirstOrDefault(lie => lie.Id == reveal.FunniestLieId);
		if (funniest is not null)
		{
			await AnnounceLieAsync(context, "game.bluff_reveal_funniest", funniest, funniest.FunnyVoterIds.Count);
		}

		foreach (var result in reveal.Results)
		{
			var key = (result.FoundTruth, result.ShownCount > 0, result.FooledCount > 0) switch
			{
				(true, false, _) => "game.bluff_result_truth_nolie",
				(true, true, true) => "game.bluff_result_truth_fooled",
				(true, true, false) => "game.bluff_result_truth_none",
				(false, false, _) => "game.bluff_result_miss_nolie",
				(false, true, true) => "game.bluff_result_miss_fooled",
				_ => "game.bluff_result_miss_none",
			};
			var gained = result.TruthPoints + result.FoolPoints;
			await context.Announcer.ToPlayer(result.PlayerId, key, VisualNarrativeVars.Add(new()
			{
				["truthPoints"] = result.TruthPoints,
				["fooled"] = result.FooledCount,
				["shown"] = result.ShownCount,
				["foolPoints"] = result.FoolPoints,
				["points"] = gained,
				["total"] = result.Total,
			}, "outcome", targetPlayerId: result.PlayerId, tone: gained > 0 ? "gain" : "neutral"));
		}

		var leader = BluffRulebook.Standings(state).First();
		await context.Announce("game.bluff_leader", new()
		{
			["player"] = BluffFamily.PlayerName(gameState, leader.PlayerId),
			["score"] = leader.Score,
			["actorId"] = leader.PlayerId,
		});
	}

	/// <summary>A bluff, with its author — or its first author and how many more, because the
	/// engine cannot join a list of names in every language and a sentence must still flow.</summary>
	private static Task AnnounceLieAsync(GameContext context, string key, BluffLieState lie, int count)
	{
		var authors = lie.AuthorIds;
		var first = BluffFamily.PlayerName(context.GameState, authors[0]);
		return authors.Count == 1
			? context.Announce(key, new()
			{
				["lie"] = lie.Text,
				["author"] = first,
				["count"] = count,
				["actorId"] = authors[0],
			})
			: context.Announce(key + "_more", new()
			{
				["lie"] = lie.Text,
				["author"] = first,
				["others"] = authors.Count - 1,
				["count"] = count,
			});
	}

	/// <summary>A departure can be the last thing a phase was waiting for.</summary>
	public static async Task SettleIfEveryoneIsDoneAsync(GameContext context, BluffRulesConfig rules)
	{
		var round = context.GameState.Bluff!.Round;
		switch (round.Phase)
		{
			case BluffPhase.Writing when BluffRulebook.WritersRemaining(round) == 0:
				await OpenVotingAsync(context, rules, "retire", timedOut: false);
				break;
			case BluffPhase.Voting when BluffRulebook.VotersRemaining(round, final: false) == 0:
				await CloseVotingAsync(context, rules, "retire", timedOut: false);
				break;
			case BluffPhase.FinalVoting when BluffRulebook.VotersRemaining(round, final: true) == 0:
				await CloseFinalAsync(context, rules, "retire", timedOut: false);
				break;
		}
	}

	/// <summary>Resolve whichever timed phase just ran out.</summary>
	public static Task<BluffActionResponse> ExpireAsync(GameContext context, BluffRulesConfig rules, string action)
	{
		var round = context.GameState.Bluff!.Round;
		return round.Phase switch
		{
			BluffPhase.Writing => OpenVotingAsync(context, rules, action, timedOut: true),
			BluffPhase.Voting => CloseVotingAsync(context, rules, action, timedOut: true),
			_ => CloseFinalAsync(context, rules, action, timedOut: true),
		};
	}
}

public sealed class BluffStartRoundHandler : PlayerCommandHandler<BluffStartRoundCommand>
{
	protected override async Task<ServerResponse> HandleAsync(
		BluffStartRoundCommand command,
		Player player,
		GameContext context)
	{
		if (BluffRoundFlow.RequireState(context, out var state, out var runtime) is { } stateError)
		{
			return stateError;
		}
		if (BluffRoundFlow.RequireRound(state, command.RoundNumber) is { } roundError)
		{
			return roundError;
		}
		if (BluffRoundFlow.RequirePhase(state, BluffPhase.Preparing) is { } phaseError)
		{
			return phaseError;
		}
		if (BluffRoundFlow.RequireMaster(state, player.Id) is { } masterError)
		{
			return masterError;
		}

		BluffRulebook.StartWriting(state.Round, runtime.Rules, DateTime.UtcNow);
		// The question is read the moment the clock starts and not before: everybody gets the
		// same seconds to think, which is the whole fairness of a simultaneous round.
		await context.Announce("game.bluff_round_started", new()
		{
			["round"] = state.Round.RoundNumber,
			["question"] = state.Round.Question,
			["seconds"] = state.Round.DurationSeconds,
			["actorId"] = player.Id,
		});
		return new BluffActionResponse { Action = "start" };
	}
}

public sealed class BluffWriteHandler : PlayerCommandHandler<BluffWriteCommand>
{
	protected override Task<ServerResponse> HandleAsync(
		BluffWriteCommand command,
		Player player,
		GameContext context)
	{
		if (BluffRoundFlow.RequireState(context, out var state, out _) is { } stateError)
		{
			return Task.FromResult<ServerResponse>(stateError);
		}
		if (BluffRoundFlow.RequireRound(state, command.RoundNumber) is { } roundError)
		{
			return Task.FromResult<ServerResponse>(roundError);
		}
		if (BluffRoundFlow.RequirePhase(state, BluffPhase.Writing) is { } phaseError)
		{
			return Task.FromResult<ServerResponse>(phaseError);
		}
		// The clock is the whole game here: a bluff that arrives after the deadline is not a
		// bluff. The clock's own expiry closes the phase; this just says no.
		if (BluffRoundFlow.DeadlinePassed(state))
		{
			return Task.FromResult<ServerResponse>(
				new ErrorResponse { Message = "The writing clock has run out", Code = "BLUFF_TIME_UP" });
		}

		ServerResponse response = BluffRulebook.Write(state.Round, player.Id, command.Text ?? string.Empty) switch
		{
			BluffRulebook.WriteOutcome.NotWriting => new ErrorResponse { Message = "You are not writing this round", Code = "BLUFF_NOT_WRITING" },
			BluffRulebook.WriteOutcome.AlreadyFinished => new ErrorResponse { Message = "You already finished writing", Code = "BLUFF_ALREADY_FINISHED" },
			BluffRulebook.WriteOutcome.TooLong => new ErrorResponse { Message = "That bluff is too long", Code = "BLUFF_LIE_TOO_LONG" },
			BluffRulebook.WriteOutcome.MatchesTruth => new ErrorResponse { Message = "That is the truth, write a bluff", Code = "BLUFF_WROTE_THE_TRUTH" },
			// Deliberately silent and private: a bluff is saved as it is typed, and nobody else
			// may know it exists yet.
			_ => new BluffActionResponse { Action = "write", Quiet = true },
		};
		return Task.FromResult(response);
	}
}

public sealed class BluffFinishWritingHandler : PlayerCommandHandler<BluffFinishWritingCommand>
{
	protected override async Task<ServerResponse> HandleAsync(
		BluffFinishWritingCommand command,
		Player player,
		GameContext context)
	{
		if (BluffRoundFlow.RequireState(context, out var state, out var runtime) is { } stateError)
		{
			return stateError;
		}
		if (BluffRoundFlow.RequireRound(state, command.RoundNumber) is { } roundError)
		{
			return roundError;
		}
		if (BluffRoundFlow.RequirePhase(state, BluffPhase.Writing) is { } phaseError)
		{
			return phaseError;
		}
		if (BluffRoundFlow.DeadlinePassed(state))
		{
			return await BluffRoundFlow.OpenVotingAsync(context, runtime.Rules, "finish", timedOut: true);
		}
		if (!BluffRulebook.FinishWriting(state.Round, player.Id))
		{
			return new ErrorResponse { Message = "You already finished writing", Code = "BLUFF_ALREADY_FINISHED" };
		}

		var remaining = BluffRulebook.WritersRemaining(state.Round);
		// Everyone is done with time to spare: nobody should sit listening to a clock that no
		// longer decides anything.
		if (remaining == 0)
		{
			return await BluffRoundFlow.OpenVotingAsync(context, runtime.Rules, "finish", timedOut: false);
		}
		// Private: a hall of "so-and-so has finished" would be a hall of noise.
		await context.Announcer.ToPlayer(player.Id, "game.bluff_you_finished", new()
		{
			["remaining"] = remaining,
		});
		return new BluffActionResponse
		{
			Action = "finish",
			Quiet = !BluffRoundFlow.ProgressWorthBroadcasting(remaining, state.Round.Entries.Count),
		};
	}
}

public sealed class BluffVoteHandler : PlayerCommandHandler<BluffVoteCommand>
{
	protected override async Task<ServerResponse> HandleAsync(
		BluffVoteCommand command,
		Player player,
		GameContext context)
	{
		if (BluffRoundFlow.RequireState(context, out var state, out var runtime) is { } stateError)
		{
			return stateError;
		}
		if (BluffRoundFlow.RequireRound(state, command.RoundNumber) is { } roundError)
		{
			return roundError;
		}
		var phase = command.Final ? BluffPhase.FinalVoting : BluffPhase.Voting;
		if (BluffRoundFlow.RequirePhase(state, phase) is { } phaseError)
		{
			return phaseError;
		}
		if (BluffRoundFlow.DeadlinePassed(state))
		{
			return command.Final
				? await BluffRoundFlow.CloseFinalAsync(context, runtime.Rules, "vote", timedOut: true)
				: await BluffRoundFlow.CloseVotingAsync(context, runtime.Rules, "vote", timedOut: true);
		}

		var result = BluffRulebook.Vote(state.Round, player.Id, command.Final, command.TruthPick, command.FunnyPick);
		switch (result.Outcome)
		{
			case BluffRulebook.VoteOutcome.WrongPhase:
				return new ErrorResponse { Message = "The round is not at that stage", Code = "BLUFF_WRONG_PHASE" };
			case BluffRulebook.VoteOutcome.NoBallot:
				return new ErrorResponse { Message = "You have no ballot in this vote", Code = "BLUFF_NO_BALLOT" };
			case BluffRulebook.VoteOutcome.UnknownOption:
				return new ErrorResponse { Message = "That line is not on your ballot", Code = "BLUFF_UNKNOWN_OPTION" };
			case BluffRulebook.VoteOutcome.SameOption:
				return new ErrorResponse { Message = "The truth and the funniest cannot be the same line", Code = "BLUFF_SAME_OPTION" };
			case BluffRulebook.VoteOutcome.NotAsked:
				return new ErrorResponse { Message = "This ballot does not ask for the funniest", Code = "BLUFF_NOT_ASKED" };
		}

		if (!result.BallotCompleted)
		{
			// A mark on a private ballot: saved, said to nobody, shown to nobody.
			return new BluffActionResponse { Action = "vote", Quiet = true };
		}
		var remaining = BluffRulebook.VotersRemaining(state.Round, command.Final);
		if (remaining == 0)
		{
			return command.Final
				? await BluffRoundFlow.CloseFinalAsync(context, runtime.Rules, "vote", timedOut: false)
				: await BluffRoundFlow.CloseVotingAsync(context, runtime.Rules, "vote", timedOut: false);
		}
		await context.Announcer.ToPlayer(player.Id, "game.bluff_you_voted", new()
		{
			["remaining"] = remaining,
		});
		var total = command.Final ? state.Round.FinalBallots.Count : state.Round.Ballots.Count;
		return new BluffActionResponse
		{
			Action = "vote",
			Quiet = !BluffRoundFlow.ProgressWorthBroadcasting(remaining, total),
		};
	}
}

public sealed class BluffNextRoundHandler : PlayerCommandHandler<BluffNextRoundCommand>
{
	protected override async Task<ServerResponse> HandleAsync(
		BluffNextRoundCommand command,
		Player player,
		GameContext context)
	{
		if (BluffRoundFlow.RequireState(context, out var state, out _) is { } stateError)
		{
			return stateError;
		}
		if (BluffRoundFlow.RequireRound(state, command.RoundNumber) is { } roundError)
		{
			return roundError;
		}
		if (BluffRoundFlow.RequirePhase(state, BluffPhase.Reveal) is { } phaseError)
		{
			return phaseError;
		}
		if (BluffRoundFlow.RequireMaster(state, player.Id) is { } masterError)
		{
			return masterError;
		}

		var deck = context.GameState.BluffDeck
			?? throw new InvalidOperationException("bluff deck missing from authoritative state");
		var advance = BluffRulebook.CompleteRound(state, deck);
		if (advance.GameOver && advance.WinnerId is { } winnerId)
		{
			BluffFamily.FinishGame(context.GameState, winnerId);
			var winner = state.Players.First(entry => entry.PlayerId == winnerId);
			await context.Announce("game.bluff_final_score", new()
			{
				["player"] = BluffFamily.PlayerName(context.GameState, winnerId),
				["actorId"] = winnerId,
				["total"] = winner.Score,
			});
			await context.Announce("game.game_over", new()
			{
				["winner"] = BluffFamily.PlayerName(context.GameState, winnerId),
				["actorId"] = winnerId,
			});
			return new BluffActionResponse { Action = "next", RoundEnded = true, GameEnded = true };
		}

		if (advance.TieBreakerStarted)
		{
			await context.Announce("game.bluff_tie_breaker", new()
			{
				["score"] = state.Players.Max(entry => entry.Score),
			});
		}
		await BluffFamily.AnnounceRoundPreparingAsync(context.Announce, context.GameState);
		return new BluffActionResponse { Action = "next", RoundEnded = true };
	}
}

public sealed class BluffExpirePhaseHandler : ICommandHandler<BluffExpirePhaseCommand>
{
	public async Task<ServerResponse> HandleAsync(BluffExpirePhaseCommand command, GameContext context)
	{
		if (BluffRoundFlow.RequireState(context, out var state, out var runtime) is { } stateError)
		{
			return stateError;
		}
		if (!BluffRulebook.IsTimed(state.Round))
		{
			return new ErrorResponse { Message = "Nothing is timed right now", Code = "BLUFF_WRONG_PHASE" };
		}
		if (!BluffRoundFlow.DeadlinePassed(state))
		{
			return new ErrorResponse { Message = "Time remains", Code = "BLUFF_TIME_REMAINING" };
		}
		return await BluffRoundFlow.ExpireAsync(context, runtime.Rules, "timeout");
	}
}
