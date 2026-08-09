using System.Collections.Concurrent;

namespace CorroServer.Services;

public sealed record RoundClockTickEventArgs(int SecondsRemaining);

/// <summary>One authoritative timed round per game, whichever family is playing it (the
/// forbidden clue turn, the categories writing round). It mirrors the auction clock: the
/// service samples a start timestamp held by live game state, emits silent visual ticks and
/// fires one expiry event; business rules stay in the command handler.</summary>
public interface IRoundClockService
{
	void Arm(string gameId, Func<DateTime?> startedAtUtc, Func<int> durationSeconds);
	void Cancel(string gameId);
	event Func<string, RoundClockTickEventArgs, Task>? OnTick;
	event Func<string, Task>? OnExpired;
}

public sealed class RoundClockService : IRoundClockService, IDisposable
{
	private const double TickMilliseconds = 250;

	private sealed class Window
	{
		public required System.Timers.Timer Timer { get; init; }
		public required Func<DateTime?> StartedAt { get; init; }
		public required Func<int> DurationSeconds { get; init; }
		public int LastSeconds = -1;
	}

	private readonly ConcurrentDictionary<string, Window> _windows = new();
	private readonly ILogger<RoundClockService>? _logger;

	public RoundClockService(ILogger<RoundClockService>? logger = null)
		=> _logger = logger;

	public event Func<string, RoundClockTickEventArgs, Task>? OnTick;
	public event Func<string, Task>? OnExpired;

	internal static AuthoritativeCountdown.Decision Evaluate(
		DateTime startedAtUtc,
		int durationSeconds,
		DateTime nowUtc)
		=> AuthoritativeCountdown.Evaluate(startedAtUtc, checked(durationSeconds * 1000), nowUtc);

	public void Arm(string gameId, Func<DateTime?> startedAtUtc, Func<int> durationSeconds)
	{
		Cancel(gameId);
		var timer = new System.Timers.Timer(TickMilliseconds) { AutoReset = true };
		var window = new Window
		{
			Timer = timer,
			StartedAt = startedAtUtc,
			DurationSeconds = durationSeconds,
		};
		timer.Elapsed += async (_, _) => await TickAsync(gameId, window);
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

	private async Task TickAsync(string gameId, Window window)
	{
		try
		{
			if (!_windows.TryGetValue(gameId, out var current) || !ReferenceEquals(current, window))
			{
				return;
			}
			var started = window.StartedAt();
			if (started is null)
			{
				Cancel(gameId);
				return;
			}

			var duration = window.DurationSeconds();
			var decision = Evaluate(started.Value, duration, DateTime.UtcNow);
			var seconds = decision.RemainingSeconds;
			if (Interlocked.Exchange(ref window.LastSeconds, seconds) != seconds && OnTick is not null)
			{
				await OnTick(gameId, new RoundClockTickEventArgs(seconds));
			}
			if (!decision.Expired)
			{
				return;
			}

			Cancel(gameId);
			if (OnExpired is not null)
			{
				await OnExpired(gameId);
			}
		}
		catch (Exception exception)
		{
			_logger?.LogError(exception, "RoundClockService: error ticking the round for {GameId}", gameId);
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
