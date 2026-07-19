using System.Collections.Concurrent;

namespace CorroServer.Services;

/// <summary>
/// The exploding family's real-time Nope window, modelled on <see cref="AuctionTimerService"/>:
/// a played action does not resolve at once — it sits in a short suspense window (default 2s)
/// during which anyone holding a Nope may cancel it. When the window elapses the service fires
/// <see cref="OnWindowExpired"/> and the hub resolves the pending action (its effect if the Nope
/// count is even, a fizzle if odd).
///
/// Like the auction timer, the countdown is read from an AUTHORITATIVE timestamp the flow moves
/// forward the instant a Nope lands (PendingExplodingAction.WindowStartedAt) — never a private
/// copy — so a last-instant Nope restarts the window with no race against persistence. The
/// evaluation is a pure function (<see cref="Expired"/>) so the countdown logic is unit-tested
/// without real timers.
/// </summary>
public interface INopeWindowService
{
	/// <summary>Begin (or replace) the window for a game. <paramref name="windowStartedAtUtc"/> is
	/// read on every tick so the flow can restart the countdown by moving the timestamp forward
	/// (each Nope) or end it early by returning null (the action already resolved / was folded).</summary>
	void Arm(string gameId, Func<DateTime?> windowStartedAtUtc, int windowMillis);

	/// <summary>Stop the window for a game (the pending action resolved, or the game ended).</summary>
	void Cancel(string gameId);

	/// <summary>Fired once, on the tick where the window has elapsed with no fresh Nope.</summary>
	event Func<string, Task>? OnWindowExpired;
}

public sealed class NopeWindowService : INopeWindowService, IDisposable
{
	// Fine enough that a 2s window resolves within ~200ms of its true deadline, cheap enough to
	// run one per in-flight window.
	private const double TickMillis = 200;

	private sealed record Window(System.Timers.Timer Timer, Func<DateTime?> StartedAt, int WindowMillis);

	private readonly ConcurrentDictionary<string, Window> _windows = new();
	private readonly ILogger<NopeWindowService>? _logger;

	public NopeWindowService(ILogger<NopeWindowService>? logger = null) => _logger = logger;

	public event Func<string, Task>? OnWindowExpired;

	/// <summary>Has the window (started at <paramref name="startedAt"/>) elapsed by <paramref name="now"/>?
	/// Pure and side-effect free so the countdown can be unit-tested without real timers.</summary>
	internal static bool Expired(DateTime startedAt, int windowMillis, DateTime now)
		=> (now - startedAt).TotalMilliseconds >= windowMillis;

	/// <summary>Milliseconds still shown on the countdown (never negative) — for a client tick.</summary>
	internal static int RemainingMillis(DateTime startedAt, int windowMillis, DateTime now)
		=> Math.Max(0, windowMillis - (int)(now - startedAt).TotalMilliseconds);

	public void Arm(string gameId, Func<DateTime?> windowStartedAtUtc, int windowMillis)
	{
		Cancel(gameId);
		var timer = new System.Timers.Timer(TickMillis) { AutoReset = true };
		var window = new Window(timer, windowStartedAtUtc, windowMillis);
		timer.Elapsed += async (_, _) => await OnTick(gameId, window);
		_windows[gameId] = window;
		timer.Start();
	}

	public void Cancel(string gameId)
	{
		if (_windows.TryRemove(gameId, out var window))
		{
			window.Timer.Stop();
			window.Timer.Dispose();
		}
	}

	private async Task OnTick(string gameId, Window window)
	{
		try
		{
			var startedAt = window.StartedAt();
			if (startedAt is null)
			{
				Cancel(gameId); // the pending action was resolved or folded elsewhere
				return;
			}
			if (Expired(startedAt.Value, window.WindowMillis, DateTime.UtcNow))
			{
				Cancel(gameId);
				if (OnWindowExpired != null)
				{
					await OnWindowExpired(gameId);
				}
			}
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "NopeWindowService: error ticking window for {GameId}", gameId);
		}
	}

	public void Dispose()
	{
		foreach (var gameId in _windows.Keys.ToList())
		{
			Cancel(gameId);
		}
	}
}
