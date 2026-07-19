using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Small helpers that collapse the guard boilerplate every command handler repeated: resolving the
/// acting player (or the standard PLAYER_NOT_FOUND error) and turning a failed rulebook outcome into an
/// ErrorResponse. Keeps handlers to "guard, delegate, shape the success response".
/// </summary>
public static class CommandOutcomeExtensions
{
	/// <summary>
	/// Resolves the command's player. Returns null when found (with <paramref name="player"/> set), or the
	/// standard PLAYER_NOT_FOUND error to return otherwise. Usage:
	/// <c>if (context.RequirePlayer(command.PlayerId, out var player) is { } error) return error;</c>
	/// </summary>
	public static ErrorResponse? RequirePlayer(this GameContext context, string playerId, out Player player)
	{
		var found = context.Helper.GetPlayer(playerId);
		player = found!;
		return found is null
			? new ErrorResponse { Message = "Player not found", Code = "PLAYER_NOT_FOUND" }
			: null;
	}

	/// <summary>
	/// The ErrorResponse for a failed outcome, or null when it succeeded (the handler then builds its own
	/// success response). Usage: <c>if (outcome.AsError() is { } error) return error;</c>
	/// </summary>
	public static ErrorResponse? AsError(this IOutcome outcome)
		=> outcome.Success
			? null
			: new ErrorResponse { Message = outcome.Error ?? string.Empty, Code = outcome.ErrorCode ?? string.Empty };
}
