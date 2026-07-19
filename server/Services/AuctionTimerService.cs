using System.Collections.Concurrent;
using CorroServer.Models;

namespace CorroServer.Services;

/// <summary>
/// Service to manage auction timers independently of SignalR Hub.
/// Fires events when timers tick or expire, allowing the Hub to handle notifications.
/// </summary>
public interface IAuctionTimerService
{
	/// <summary>
	/// Start timers for an auction
	/// </summary>
	void StartTimers(string gameId, GameSettings settings, AuctionState auction);

	/// <summary>
	/// Stop all timers for a game
	/// </summary>
	void StopTimers(string gameId);

	/// <summary>
	/// Event fired every second with timer status
	/// </summary>
	event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick;

	/// <summary>
	/// Event fired when bid timeout expires
	/// </summary>
	event Func<string, Task>? OnBidTimeout;
}

public class AuctionTimerTickEventArgs
{
	public int SquareIndex { get; set; }
	public int SecondsRemaining { get; set; }
	public int CurrentBid { get; set; }
	public string? HighestBidderId { get; set; }
	public string? HighestBidderName { get; set; }
}

public class AuctionTimerService : IAuctionTimerService, IDisposable
{
	private readonly ConcurrentDictionary<string, System.Timers.Timer> _bidTimers = new();
	private readonly ConcurrentDictionary<string, int> _bidTimeoutSeconds = new();
	private readonly ConcurrentDictionary<string, AuctionState> _auctionStates = new();
	private readonly ILogger<AuctionTimerService>? _logger;

	public AuctionTimerService(ILogger<AuctionTimerService>? logger = null)
	{
		_logger = logger;
	}

	public event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick;
	public event Func<string, Task>? OnBidTimeout;

	public void StartTimers(string gameId, GameSettings settings, AuctionState auction)
	{
		StopTimers(gameId);

		_bidTimeoutSeconds[gameId] = settings.AuctionBidTimeoutSeconds;
		_auctionStates[gameId] = auction;

		// Bid timeout timer (ticks every second). The auction has no global duration cap:
		// it ends only when a bid window elapses with no new bid (or everyone passes).
		var bidTimer = new System.Timers.Timer(1000);
		bidTimer.Elapsed += async (s, e) => await OnBidTimerElapsed(gameId);
		bidTimer.AutoReset = true;
		_bidTimers[gameId] = bidTimer;
		bidTimer.Start();

		_logger?.LogDebug("AuctionTimerService: Timers started for game {GameId}", gameId);
	}

	public void StopTimers(string gameId)
	{
		if (_bidTimers.TryRemove(gameId, out var bidTimer))
		{
			bidTimer.Stop();
			bidTimer.Dispose();
		}
		_bidTimeoutSeconds.TryRemove(gameId, out _);
		_auctionStates.TryRemove(gameId, out _);

		_logger?.LogDebug("AuctionTimerService: Timers stopped for game {GameId}", gameId);
	}

	/// <summary>
	/// Seconds left in the current bid window (never negative). Pure and side-effect free so
	/// the countdown logic can be unit-tested without real timers. The auction has no global
	/// duration cap: it ends only when a bid window elapses with no new bid (or everyone passes).
	/// </summary>
	internal static int ComputeRemainingSeconds(int bidTimeoutSeconds, double bidElapsedSeconds)
	{
		return Math.Max(0, bidTimeoutSeconds - (int)bidElapsedSeconds);
	}

	/// <summary>The outcome of evaluating one bid-timer tick.</summary>
	internal readonly record struct BidTickDecision(int RemainingSeconds, bool Expired);

	/// <summary>
	/// Pure evaluation of a single bid-timer tick from the authoritative phase start. Returns
	/// the seconds still shown on the countdown and whether the bid window has elapsed. Because
	/// the phase start is the shared <see cref="AuctionState.CurrentPhaseStartedAt"/> — updated
	/// the instant a bid is accepted — a last-second bid that moves it close to <paramref name="now"/>
	/// makes <c>Expired</c> false again, so the countdown restarts with no race against the
	/// (slower) command-persistence step that used to reset a separate copy.
	/// </summary>
	internal static BidTickDecision EvaluateBidTick(int bidTimeoutSeconds, DateTime phaseStartedAt, DateTime now)
	{
		var elapsedSeconds = (now - phaseStartedAt).TotalSeconds;
		return new BidTickDecision(
			ComputeRemainingSeconds(bidTimeoutSeconds, elapsedSeconds),
			elapsedSeconds >= bidTimeoutSeconds);
	}

	private async Task OnBidTimerElapsed(string gameId)
	{
		try
		{
			if (!_bidTimeoutSeconds.TryGetValue(gameId, out var bidTimeout) ||
				!_auctionStates.TryGetValue(gameId, out var auction))
			{
				return;
			}

			// The authoritative phase start lives on the shared AuctionState: the rulebook
			// moves it forward synchronously the instant a bid is accepted (inside the per-game
			// command lock, before the slow persistence step). Reading it here — instead of a
			// separate copy reset by the Hub only after the whole bid pipeline finished — means a
			// last-second bid restarts the countdown immediately, with no race against
			// persistence latency.
			var decision = EvaluateBidTick(bidTimeout, auction.CurrentPhaseStartedAt, DateTime.UtcNow);

			// Fire timer tick event
			if (OnTimerTick != null)
			{
				var args = new AuctionTimerTickEventArgs
				{
					SquareIndex = auction.SquareIndex,
					SecondsRemaining = decision.RemainingSeconds,
					CurrentBid = auction.CurrentBid,
					HighestBidderId = auction.HighestBidderId,
					HighestBidderName = auction.HighestBidderName
				};
				await OnTimerTick(gameId, args);
			}

			// Check if timeout exceeded
			if (decision.Expired)
			{
				_logger?.LogDebug("AuctionTimerService: Bid timeout for game {GameId}", gameId);
				StopTimers(gameId);
				if (OnBidTimeout != null)
				{
					await OnBidTimeout(gameId);
				}
			}
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "AuctionTimerService: Error in bid timer for {GameId}", gameId);
		}
	}

	public void Dispose()
	{
		foreach (var gameId in _bidTimers.Keys.ToList())
		{
			StopTimers(gameId);
		}
	}
}
