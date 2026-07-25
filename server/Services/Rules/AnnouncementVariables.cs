using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

/// <summary>
/// Values sent with server-authored announcements that need client-side localization.
/// Package boards retain every locale for each square, so each listener can hear the same
/// event in their own language instead of the host's canonical game language.
/// </summary>
internal static class AnnouncementVariables
{
	/// <summary>A square's per-locale names when available; otherwise its canonical fallback.</summary>
	public static object SquareName(Square square)
		=> square.Names is { Count: > 0 } ? square.Names : square.Name;

	/// <summary>
	/// Resolve a state/outcome square index back to the live square catalog before announcing it.
	/// Outcome DTOs intentionally remain plain strings; narration must not lose the localized map.
	/// </summary>
	public static object SquareName(GameContext context, int squareIndex, string? fallback = null)
		=> context.Helper.GetSquare(squareIndex) is { } square
			? SquareName(square)
			: fallback ?? squareIndex.ToString();
}
