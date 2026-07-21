using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Services.Corro;
using Microsoft.Extensions.Options;

namespace CorroServer.Services;

/// <summary>
/// One idempotent retention pass. Games are re-read immediately before deletion and skipped while
/// this process has live activity. Old unreferenced package blobs are swept separately, which also
/// retries blobs left behind by a transient Storage failure or an upload that never created a game.
/// </summary>
public sealed class GameRetentionCleanup
{
	private readonly IGameRepository _repository;
	private readonly GameSessionRegistry _registry;
	private readonly IPackageBlobStore _blobs;
	private readonly PackageRestorer _restorer;
	private readonly GameRetentionOptions _options;
	private readonly ILogger<GameRetentionCleanup> _logger;

	public GameRetentionCleanup(
		IGameRepository repository,
		GameSessionRegistry registry,
		IPackageBlobStore blobs,
		PackageRestorer restorer,
		IOptions<GameRetentionOptions> options,
		ILogger<GameRetentionCleanup> logger)
	{
		_repository = repository;
		_registry = registry;
		_blobs = blobs;
		_restorer = restorer;
		_options = options.Value;
		_logger = logger;
	}

	public async Task<GameRetentionResult> RunAsync(DateTimeOffset now, CancellationToken ct = default)
	{
		var cutoffUtc = now.UtcDateTime.AddDays(-_options.InactivityDays);
		var deletedGames = 0;
		var skippedLiveGames = 0;
		var deletedBlobs = 0;
		var errors = 0;

		await foreach (var candidate in _repository.GetGamesLastUpdatedBeforeAsync(
			cutoffUtc,
			_options.MaxGamesPerRun,
			ct))
		{
			try
			{
				if (_registry.HasActivity(candidate.GameId))
				{
					skippedLiveGames++;
					continue;
				}

				// The query is only a candidate scan. Re-read so an update after that scan prevents
				// deletion; check process activity again to narrow the join/restore race as well.
				var current = await _repository.LoadGameAsync(candidate.GameId);
				if (current is null || LastActivity(current) >= cutoffUtc)
				{
					continue;
				}
				if (_registry.HasActivity(candidate.GameId))
				{
					skippedLiveGames++;
					continue;
				}

				if (await _registry.DeleteGameAsync(candidate.GameId, current))
				{
					deletedGames++;
				}
			}
			catch (OperationCanceledException) when (ct.IsCancellationRequested)
			{
				throw;
			}
			catch (Exception ex)
			{
				errors++;
				_logger.LogError(ex, "Retention failed to delete game {GameId}; continuing", candidate.GameId);
			}
		}

		try
		{
			var referencedKeys = await _repository.GetReferencedPackageBlobKeysAsync(ct);
			await foreach (var blob in _blobs.ListAsync(ct))
			{
				if (blob.LastModified >= cutoffUtc || referencedKeys.Contains(blob.Key))
				{
					continue;
				}

				try
				{
					// A game may have been created after the reference snapshot above. Re-check at the
					// destructive boundary, then clear both the blob and any stale in-process staging.
					if (await _repository.HasPackageReferenceAsync(packageToken: null, blob.Key, ct))
					{
						continue;
					}
					await _restorer.ReleaseOrphanBlobAsync(blob.Key, ct);
					deletedBlobs++;
				}
				catch (OperationCanceledException) when (ct.IsCancellationRequested)
				{
					throw;
				}
				catch (Exception ex)
				{
					errors++;
					_logger.LogError(ex, "Retention failed to delete orphaned package blob {BlobKey}; continuing", blob.Key);
				}
			}
		}
		catch (OperationCanceledException) when (ct.IsCancellationRequested)
		{
			throw;
		}
		catch (Exception ex)
		{
			errors++;
			_logger.LogError(ex, "Retention failed while enumerating package blob references");
		}

		var result = new GameRetentionResult(
			cutoffUtc,
			deletedGames,
			skippedLiveGames,
			deletedBlobs,
			errors);
		_logger.LogInformation(
			"Retention completed for cutoff {CutoffUtc}: {DeletedGames} games deleted, "
			+ "{SkippedLiveGames} live games skipped, {DeletedBlobs} orphaned package blobs deleted, {Errors} errors",
			result.CutoffUtc,
			result.DeletedGames,
			result.SkippedLiveGames,
			result.DeletedBlobs,
			result.Errors);
		return result;
	}

	private static DateTime LastActivity(GameDocument game)
		=> game.LastUpdated == default ? game.CreatedAt : game.LastUpdated;
}

public sealed record GameRetentionResult(
	DateTime CutoffUtc,
	int DeletedGames,
	int SkippedLiveGames,
	int DeletedBlobs,
	int Errors);
