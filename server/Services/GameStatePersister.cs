using System.Diagnostics;
using CorroServer.Models;
using Microsoft.Extensions.Logging;

namespace CorroServer.Services;

/// <summary>
/// Background, coalescing persister for a SINGLE game's state.
///
/// Why it exists: persistence used to run on the awaited SignalR path (the Hub awaited the
/// Cosmos write before its command method returned). Because SignalR processes one
/// invocation per connection at a time, a slow upsert serialized the NEXT command — a player
/// who bought a property and immediately pressed "end turn" could wait seconds for the write
/// to finish. Callers now <see cref="Enqueue"/> the latest snapshot and return immediately;
/// a single background worker performs the write off the command path.
///
/// Coalescing (latest-wins): every write replaces the whole document, so if several snapshots
/// are enqueued while a write is in flight only the most RECENT is written next — the
/// intermediate ones are superseded and skipped. Writes for a game never overlap, so they
/// can't land out of order.
/// </summary>
public sealed class GameStatePersister
{
	private readonly string _gameId;
	private readonly Func<GameState, Task> _write;
	private readonly ILogger? _logger;

	private readonly object _gate = new();
	private GameState? _pending;
	private bool _running;
	private Task _worker = Task.CompletedTask;

	public GameStatePersister(string gameId, Func<GameState, Task> write, ILogger? logger = null)
	{
		_gameId = gameId;
		_write = write ?? throw new ArgumentNullException(nameof(write));
		_logger = logger;
	}

	/// <summary>
	/// Non-blocking. Records <paramref name="state"/> as the next snapshot to persist and
	/// starts the background worker if it isn't already running. Returns immediately.
	/// </summary>
	public void Enqueue(GameState state)
	{
		lock (_gate)
		{
			_pending = state;
			if (_running)
			{
				return; // the active worker will pick up this newer snapshot
			}

			_running = true;
			_worker = Task.Run(RunAsync);
		}
	}

	/// <summary>
	/// Completes once there is no pending or in-flight write, letting callers (game-over
	/// cleanup, shutdown, tests) wait for the last snapshot to be flushed.
	/// </summary>
	public Task WaitForIdleAsync()
	{
		lock (_gate)
		{
			return _worker;
		}
	}

	private async Task RunAsync()
	{
		while (true)
		{
			GameState next;
			lock (_gate)
			{
				if (_pending is null)
				{
					_running = false;
					return;
				}
				next = _pending;
				_pending = null;
			}

			var sw = Stopwatch.StartNew();
			try
			{
				await _write(next).ConfigureAwait(false);
				_logger?.LogDebug("Background persist for game {GameId} took {ElapsedMs}ms", _gameId, sw.ElapsedMilliseconds);
			}
			catch (Exception ex)
			{
				// A failed write must not kill the worker: log and move on to the next snapshot.
				_logger?.LogError(ex, "Background persist failed for game {GameId} after {ElapsedMs}ms", _gameId, sw.ElapsedMilliseconds);
			}
		}
	}
}
