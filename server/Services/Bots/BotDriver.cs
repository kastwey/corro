using System.Collections.Concurrent;
using CorroServer.Models;
using CorroServer.Services.Corro.Families;

namespace CorroServer.Services.Bots;

/// <summary>Tuning knobs for the driver. The E2E environment shortens the delay.</summary>
public sealed record BotOptions
{
	/// <summary>Pause before each bot action: humanizing, and it lets the announcement flow
	/// breathe — a screen-reader player follows a bot's turn like a human's. Live-play
	/// tuning: 1.2s felt rushed (the bot's lines stepped on the player's own turn still
	/// being read); 3.5s gives the reader room to finish before the bot "thinks".</summary>
	public TimeSpan ActionDelay { get; init; } = TimeSpan.FromMilliseconds(3500);
}

/// <summary>
/// Drives every BOT seat of a live game from OUTSIDE the engine. The separation contract:
/// the engine (GameService, rulebooks, handlers) has no idea bots exist — this class
/// observes the game's state-changed event and, when a bot owns the next decision, executes
/// its policy's command through <see cref="IGameService.ExecuteCommandAsync"/>, the exact
/// pipeline a human's command takes (same gates, same announcements, same persistence).
///
/// One action per pass: each executed command changes the state, the event fires again and
/// the NEXT decision (possibly another bot's — bot-versus-bot chains) is scheduled. A bot
/// decides over its own PROJECTED view, so hidden information stays hidden from the machine
/// exactly as from a human. A rejected command is logged and NOT retried: the state did not
/// change, so no new pass fires — no hot loops by construction.
/// </summary>
public sealed class BotDriver
{
	private sealed class Attachment
	{
		public required IGameService Service { get; init; }
		public required IReadOnlyList<string> Bots { get; init; }
		public required IBotPolicy Policy { get; init; }
		public Func<GameState, Task>? StateHandler { get; set; }
		public Func<IReadOnlyList<AnnouncementDispatch>, Task>? EventsHandler { get; set; }
		public int Scheduled; // 0/1 (Interlocked): at most one pending pass per game
	}

	private readonly ConcurrentDictionary<string, Attachment> _games = new();
	private readonly BotOptions _options;
	private readonly ILogger<BotDriver>? _logger;

	public BotDriver(BotOptions? options = null, ILogger<BotDriver>? logger = null)
	{
		_options = options ?? new BotOptions();
		_logger = logger;
	}

	/// <summary>
	/// Watch a live game (fresh start or restore). A no-op when the game has no bot seats
	/// or its family has no policy — attaching is always safe to call.
	/// </summary>
	public void Attach(string gameId, IGameService service)
	{
		var state = service.GameState;
		if (state == null || state.IsGameOver)
		{
			return;
		}

		var bots = state.Players.Where(p => p.IsBot).Select(p => p.Id).ToList();
		if (bots.Count == 0)
		{
			return;
		}

		var policy = BotPolicies.For(state.GameType);
		if (policy == null)
		{
			_logger?.LogWarning("Game {GameId} has bots but no policy for '{GameType}'", gameId, state.GameType);
			return;
		}

		var attachment = new Attachment { Service = service, Bots = bots, Policy = policy };
		if (!_games.TryAdd(gameId, attachment))
		{
			return; // already attached
		}
		// Two pulses, still zero engine knowledge: OnGameEvents flushes at the END of every
		// command (the reliable per-move heartbeat) and OnGameStateChanged covers the rest
		// (init/restore notifications).
		attachment.StateHandler = _ =>
		{
			Schedule(gameId, attachment);
			return Task.CompletedTask;
		};
		attachment.EventsHandler = _ =>
		{
			Schedule(gameId, attachment);
			return Task.CompletedTask;
		};
		service.OnGameStateChanged += attachment.StateHandler;
		service.OnGameEvents += attachment.EventsHandler;
		_logger?.LogInformation("BotDriver attached to {GameId}: {Count} bot(s), family {GameType}",
			gameId, bots.Count, state.GameType);
		// A bot may already own the first decision (it opens the game, or a restore landed
		// mid-bot-turn): evaluate once without waiting for a state change.
		Schedule(gameId, attachment);
	}

	/// <summary>Stop watching (game over or torn down).</summary>
	public void Detach(string gameId)
	{
		if (!_games.TryRemove(gameId, out var attachment))
		{
			return;
		}

		if (attachment.StateHandler != null)
		{
			attachment.Service.OnGameStateChanged -= attachment.StateHandler;
		}

		if (attachment.EventsHandler != null)
		{
			attachment.Service.OnGameEvents -= attachment.EventsHandler;
		}
	}

	private void Schedule(string gameId, Attachment attachment)
	{
		if (Interlocked.Exchange(ref attachment.Scheduled, 1) == 1)
		{
			return;
		}

		_ = Task.Run(async () =>
		{
			try
			{
				await Task.Delay(_options.ActionDelay);
				// Cleared BEFORE acting: a state change DURING the action schedules the next pass.
				Interlocked.Exchange(ref attachment.Scheduled, 0);
				await ActOnceAsync(gameId, attachment);
			}
			catch (Exception ex)
			{
				Interlocked.Exchange(ref attachment.Scheduled, 0);
				_logger?.LogError(ex, "Bot pass failed for game {GameId}", gameId);
			}
		});
	}

	private async Task ActOnceAsync(string gameId, Attachment attachment)
	{
		var state = attachment.Service.GameState;
		if (state == null)
		{
			return;
		}

		if (state.IsGameOver)
		{
			Detach(gameId);
			return;
		}

		var family = GameFamilies.For(state.GameType);
		foreach (var botId in attachment.Bots)
		{
			// The bot's own PROJECTED view: no peeking at hands or pile order.
			var view = family.ProjectFor(state, botId);
			var command = attachment.Policy.Decide(view, botId);
			if (command == null)
			{
				continue;
			}

			var response = await attachment.Service.ExecuteCommandAsync(command);
			if (response is ErrorResponse error)
			{
				_logger?.LogWarning("Bot {BotId} command {Type} rejected in {GameId}: {Code} — {Message}",
					botId, command.Type, gameId, error.Code, error.Message);
			}
			else
			{
				// The hub does this after every HUMAN command: broadcast the new state to
				// the clients and enqueue persistence. Without it the clients' announcement
				// gate waits forever for a state that never arrives — and the bot's move
				// would never be saved.
				await attachment.Service.NotifyStateChangedAsync();
			}
			return; // one action per pass; the resulting state change drives the next
		}
	}
}
