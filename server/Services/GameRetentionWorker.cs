using Microsoft.Extensions.Options;

namespace CorroServer.Services;

/// <summary>Runs the retention pass once after startup and then at a fixed UTC hour every day.</summary>
public sealed class GameRetentionWorker : BackgroundService
{
	private readonly GameRetentionCleanup _cleanup;
	private readonly GameRetentionOptions _options;
	private readonly ILogger<GameRetentionWorker> _logger;

	public GameRetentionWorker(
		GameRetentionCleanup cleanup,
		IOptions<GameRetentionOptions> options,
		ILogger<GameRetentionWorker> logger)
	{
		_cleanup = cleanup;
		_options = options.Value;
		_logger = logger;
	}

	protected override async Task ExecuteAsync(CancellationToken stoppingToken)
	{
		if (!_options.Enabled)
		{
			_logger.LogInformation("Game retention is disabled");
			return;
		}

		if (_options.RunOnStartup)
		{
			await RunSafelyAsync(stoppingToken);
		}

		while (!stoppingToken.IsCancellationRequested)
		{
			var delay = DelayUntilNextRun(DateTimeOffset.UtcNow, _options.RunAtUtcHour);
			_logger.LogDebug("Next game-retention run in {Delay}", delay);
			try
			{
				await Task.Delay(delay, stoppingToken);
			}
			catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
			{
				break;
			}

			await RunSafelyAsync(stoppingToken);
		}
	}

	private async Task RunSafelyAsync(CancellationToken ct)
	{
		try
		{
			await _cleanup.RunAsync(DateTimeOffset.UtcNow, ct);
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested)
		{
			// Normal host shutdown.
		}
		catch (Exception ex)
		{
			_logger.LogError(ex, "Game-retention run failed; the next daily run will retry");
		}
	}

	internal static TimeSpan DelayUntilNextRun(DateTimeOffset now, int utcHour)
	{
		var utcNow = now.ToUniversalTime();
		var next = new DateTimeOffset(
			utcNow.Year,
			utcNow.Month,
			utcNow.Day,
			utcHour,
			0,
			0,
			TimeSpan.Zero);
		if (next <= utcNow)
		{
			next = next.AddDays(1);
		}
		return next - utcNow;
	}
}
