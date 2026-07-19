using CorroServer.Models;

namespace CorroServer.Services.Bots;

/// <summary>
/// One family's bot BRAIN: a pure decision function. It receives the bot's PROJECTED view
/// of the state — the same thing a human client sees, hidden information stripped — and
/// returns the bot's next command, or null when the bot has nothing to do right now.
///
/// Policies are pure on purpose: no I/O, no engine internals, no timing. Everything a
/// policy needs (deck catalog, the game's EFFECTIVE rules with the host's house-rule
/// choices applied) travels inside the state itself, so a bot automatically honours
/// whatever the package and the lobby configured. The engine never knows bots exist —
/// their commands enter through the same pipeline as a human's (see <see cref="BotDriver"/>).
/// </summary>
public interface IBotPolicy
{
	/// <summary>The gameType this policy plays ("journey", "track"…).</summary>
	string GameType { get; }

	/// <summary>The bot's next command over its projected <paramref name="view"/>, or null.</summary>
	GameCommand? Decide(GameState view, string botId);
}

/// <summary>
/// The bot-policy registry — the only place bot brains are enumerated, mirroring
/// <c>GameFamilies</c>: adding a family's bot means writing one policy class and
/// registering it here, not touching the driver or the lobby.
/// </summary>
public static class BotPolicies
{
	private static readonly IBotPolicy[] All =
	{
		new PropertyBotPolicy(),
		new JourneyBotPolicy(),
		new TrackBotPolicy(),
		new AssemblyBotPolicy(),
		new DraftBotPolicy(),
		new SheddingBotPolicy(),
		new ExplodingBotPolicy(),
	};

	/// <summary>The policy for a family, or null when that family has no bot yet.</summary>
	public static IBotPolicy? For(string? gameType)
		=> All.FirstOrDefault(p => p.GameType == gameType);

	/// <summary>Whether games of this family can seat bots (the lobby's AddBot guard).</summary>
	public static bool Supports(string? gameType) => For(gameType) != null;
}
