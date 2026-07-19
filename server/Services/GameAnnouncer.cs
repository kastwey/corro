using CorroServer.Models;

namespace CorroServer.Services;

/// <summary>
/// Port for the spoken voice of the game. Rules and handlers announce through this
/// abstraction so they stay decoupled from SignalR (Dependency Inversion). It is
/// scoped per game, so the audience is always "within this game".
/// </summary>
public interface IGameAnnouncer
{
	/// <summary>Announce an i18n key + interpolation vars to every player in the game.</summary>
	Task ToAll(string key, Dictionary<string, object>? vars = null, AnnouncementPhase phase = AnnouncementPhase.Resolve);

	/// <summary>Announce only to the given player's connection(s).</summary>
	Task ToPlayer(string playerId, string key, Dictionary<string, object>? vars = null, AnnouncementPhase phase = AnnouncementPhase.Resolve);

	/// <summary>Announce to everyone in the game except the given player's connection(s).</summary>
	Task ToAllExcept(string playerId, string key, Dictionary<string, object>? vars = null, AnnouncementPhase phase = AnnouncementPhase.Resolve);
}

/// <summary>
/// Default <see cref="IGameAnnouncer"/> that publishes <see cref="AnnouncementDispatch"/>es
/// through a sink. In production the sink buffers each dispatch into the current command's
/// batch, which <c>GameService</c> flushes as one <c>OnGameEvents</c> stream; the Hub then
/// renders each player's personalized view and sends it. In tests the sink is captured.
/// </summary>
public sealed class GameAnnouncer : IGameAnnouncer
{
	private readonly Func<AnnouncementDispatch, Task> _publish;
	private readonly ILogger? _logger;

	public GameAnnouncer(Func<AnnouncementDispatch, Task> publish, ILogger? logger = null)
	{
		_publish = publish ?? throw new ArgumentNullException(nameof(publish));
		_logger = logger;
	}

	public Task ToAll(string key, Dictionary<string, object>? vars = null, AnnouncementPhase phase = AnnouncementPhase.Resolve)
		=> Publish(AnnouncementAudience.All, null, key, vars, phase);

	public Task ToPlayer(string playerId, string key, Dictionary<string, object>? vars = null, AnnouncementPhase phase = AnnouncementPhase.Resolve)
		=> Publish(AnnouncementAudience.Player, playerId, key, vars, phase);

	public Task ToAllExcept(string playerId, string key, Dictionary<string, object>? vars = null, AnnouncementPhase phase = AnnouncementPhase.Resolve)
		=> Publish(AnnouncementAudience.AllExcept, playerId, key, vars, phase);

	private Task Publish(AnnouncementAudience audience, string? playerId, string key, Dictionary<string, object>? vars, AnnouncementPhase phase)
	{
		var dispatch = new AnnouncementDispatch
		{
			Event = new AnnouncementEvent { Key = key, Vars = vars ?? new(), Phase = phase },
			Audience = audience,
			PlayerId = playerId
		};
		_logger?.LogDebug("Announce {Audience} {Player}: {Key}", audience, playerId, key);
		return _publish(dispatch);
	}
}

/// <summary>
/// Convenience layer that implements the "<c>actorId</c> means personalize" convention
/// in exactly one place. The acting player hears the first-person <c>&lt;key&gt;_self</c>
/// variant; everyone else hears the third-person <c>&lt;key&gt;</c>. The client falls
/// back to the base key when no <c>_self</c> translation exists.
/// </summary>
public static class GameAnnouncerExtensions
{
	public static Task Announce(this IGameAnnouncer announcer, string key, Dictionary<string, object>? vars, AnnouncementPhase phase = AnnouncementPhase.Resolve)
	{
		if (vars != null
			&& vars.TryGetValue("actorId", out var raw)
			&& raw is string actorId
			&& !string.IsNullOrEmpty(actorId))
		{
			return Task.WhenAll(
				announcer.ToPlayer(actorId, key + "_self", vars, phase),
				announcer.ToAllExcept(actorId, key, vars, phase));
		}

		return announcer.ToAll(key, vars, phase);
	}
}
