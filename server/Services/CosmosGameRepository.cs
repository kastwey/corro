using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using CorroServer.Models;
using Microsoft.Azure.Cosmos;

namespace CorroServer.Services;

public class CosmosGameRepository : IGameRepository
{
	private readonly CosmosClient _cosmosClient;
	private readonly Container _container;
	private readonly ILogger<CosmosGameRepository> _logger;

	public CosmosGameRepository(CosmosClient cosmosClient, ILogger<CosmosGameRepository> logger)
	{
		_cosmosClient = cosmosClient;
		_logger = logger;

		// Database and unified container configuration
		var database = _cosmosClient.GetDatabase("CorroGame");
		_container = database.GetContainer("Games"); // Single container for everything
	}

	public async Task<GameDocument?> LoadGameAsync(string gameId)
	{
		try
		{
			_logger.LogInformation("Loading game: {GameId}", gameId);

			// If the gameId already has the "game-" prefix, use it directly
			// If not, add it
			var documentId = gameId.StartsWith("game-") ? gameId : $"game-{gameId}";
			var partitionKeyValue = gameId.StartsWith("game-") ? gameId.Substring(5) : gameId;

			var sw = Stopwatch.StartNew();
			var response = await _container.ReadItemAsync<GameDocument>(
				id: documentId,
				partitionKey: new PartitionKey(partitionKeyValue)
			);

			_logger.LogInformation("Game loaded successfully: {GameId} in {ElapsedMs}ms, RUs consumed: {RequestCharge}",
				gameId, sw.ElapsedMilliseconds, response.RequestCharge);
			return response.Resource;
		}
		catch (CosmosException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
		{
			_logger.LogWarning("Game not found: {GameId}", gameId);
			return null;
		}
		catch (Exception ex)
		{
			_logger.LogError(ex, "Error loading game: {GameId}", gameId);
			throw;
		}
	}

	public async Task<GameDocument?> GetByInviteCodeAsync(string inviteCode)
	{
		try
		{
			_logger.LogInformation("Searching game by invite code: {InviteCode}", inviteCode);

			var query = new QueryDefinition(
				"SELECT * FROM c WHERE c.inviteCode = @inviteCode"
			).WithParameter("@inviteCode", inviteCode);

			var iterator = _container.GetItemQueryIterator<GameDocument>(query);

			while (iterator.HasMoreResults)
			{
				var response = await iterator.ReadNextAsync();
				var game = response.FirstOrDefault();
				if (game != null)
				{
					_logger.LogInformation("Game found by code: {GameId}", game.GameId);
					return game;
				}
			}

			_logger.LogWarning("No game found with code: {InviteCode}", inviteCode);
			return null;
		}
		catch (Exception ex)
		{
			_logger.LogError(ex, "Error searching game by code: {InviteCode}", inviteCode);
			throw;
		}
	}

	public async Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode)
	{
		try
		{
			// The code lives on ONE player inside ONE game: a rare, claim-time query, so a
			// cross-partition JOIN scan is fine (no index/lookup table to keep in sync).
			var query = new QueryDefinition(
				"SELECT VALUE c FROM c JOIN p IN c.players WHERE p.rejoinCode = @code"
			).WithParameter("@code", rejoinCode);

			var iterator = _container.GetItemQueryIterator<GameDocument>(query);
			while (iterator.HasMoreResults)
			{
				var response = await iterator.ReadNextAsync();
				var game = response.FirstOrDefault();
				if (game != null)
				{
					return game;
				}
			}
			return null;
		}
		catch (Exception ex)
		{
			_logger.LogError(ex, "Error searching game by rejoin code");
			throw;
		}
	}

	public async Task<GameDocument> CreateGameAsync(GameDocument game)
	{
		try
		{
			_logger.LogInformation("Creating new game: {GameId}", game.GameId);

			var response = await _container.CreateItemAsync(
				game,
				new PartitionKey(game.GameId)
			);

			_logger.LogInformation("Game created successfully: {GameId}, RUs consumed: {RequestCharge}",
				game.GameId, response.RequestCharge);

			return response.Resource;
		}
		catch (Exception ex)
		{
			_logger.LogError(ex, "Error creating game: {GameId}", game.GameId);
			throw;
		}
	}

	public async Task<GameDocument> UpdateGameAsync(GameDocument game)
	{
		try
		{
			_logger.LogInformation("Updating game: {GameId}", game.GameId);

			var updatedGame = game with { LastUpdated = DateTime.UtcNow };

			var sw = Stopwatch.StartNew();
			var response = await _container.UpsertItemAsync(
				updatedGame,
				new PartitionKey(game.GameId)
			);

			_logger.LogInformation("Game updated successfully: {GameId} in {ElapsedMs}ms, RUs consumed: {RequestCharge}",
				game.GameId, sw.ElapsedMilliseconds, response.RequestCharge);

			return response.Resource;
		}
		catch (Exception ex)
		{
			_logger.LogError(ex, "Error updating game: {GameId}", game.GameId);
			throw;
		}
	}

	public async Task<bool> DeleteGameAsync(string gameId)
	{
		try
		{
			_logger.LogInformation("Deleting game: {GameId}", gameId);

			await _container.DeleteItemAsync<GameDocument>(
				id: $"game-{gameId}",
				partitionKey: new PartitionKey(gameId)
			);

			_logger.LogInformation("Game deleted successfully: {GameId}", gameId);
			return true;
		}
		catch (CosmosException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
		{
			_logger.LogWarning("Game not found for deletion: {GameId}", gameId);
			return false;
		}
		catch (Exception ex)
		{
			_logger.LogError(ex, "Error deleting game: {GameId}", gameId);
			throw;
		}
	}

	public async IAsyncEnumerable<GameDocument> GetGamesLastUpdatedBeforeAsync(
		DateTime cutoffUtc,
		int maxCount,
		[EnumeratorCancellation] CancellationToken ct = default)
	{
		if (maxCount <= 0)
		{
			yield break;
		}

		// DateTime values are stored as sortable ISO-8601 JSON strings. Legacy documents without
		// lastUpdated fall back to createdAt so they cannot evade retention forever.
		var cutoff = cutoffUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
		var query = new QueryDefinition(
			"SELECT * FROM c WHERE "
			+ "(IS_DEFINED(c.lastUpdated) AND NOT IS_NULL(c.lastUpdated) AND c.lastUpdated < @cutoff) "
			+ "OR ((NOT IS_DEFINED(c.lastUpdated) OR IS_NULL(c.lastUpdated)) AND c.createdAt < @cutoff)")
			.WithParameter("@cutoff", cutoff);
		var iterator = _container.GetItemQueryIterator<GameDocument>(
			query,
			requestOptions: new QueryRequestOptions { MaxItemCount = Math.Min(maxCount, 100) });

		var yielded = 0;
		while (iterator.HasMoreResults && yielded < maxCount)
		{
			var response = await iterator.ReadNextAsync(ct);
			foreach (var game in response)
			{
				yield return game;
				yielded++;
				if (yielded >= maxCount)
				{
					yield break;
				}
			}
		}
	}

	public async Task<bool> HasPackageReferenceAsync(
		string? packageToken,
		string? packageBlobKey,
		CancellationToken ct = default)
	{
		var conditions = new List<string>();
		if (!string.IsNullOrEmpty(packageToken))
		{
			conditions.Add("c.packageToken = @packageToken");
		}
		if (!string.IsNullOrEmpty(packageBlobKey))
		{
			conditions.Add("c.packageBlobKey = @packageBlobKey");
		}
		if (conditions.Count == 0)
		{
			return false;
		}

		var query = new QueryDefinition(
			$"SELECT TOP 1 VALUE c.id FROM c WHERE {string.Join(" OR ", conditions)}");
		if (!string.IsNullOrEmpty(packageToken))
		{
			query.WithParameter("@packageToken", packageToken);
		}
		if (!string.IsNullOrEmpty(packageBlobKey))
		{
			query.WithParameter("@packageBlobKey", packageBlobKey);
		}

		var iterator = _container.GetItemQueryIterator<string>(query);
		while (iterator.HasMoreResults)
		{
			if ((await iterator.ReadNextAsync(ct)).Count > 0)
			{
				return true;
			}
		}
		return false;
	}

	public async Task<IReadOnlySet<string>> GetReferencedPackageBlobKeysAsync(CancellationToken ct = default)
	{
		var keys = new HashSet<string>(StringComparer.Ordinal);
		var query = new QueryDefinition(
			"SELECT VALUE c.packageBlobKey FROM c "
			+ "WHERE IS_DEFINED(c.packageBlobKey) AND NOT IS_NULL(c.packageBlobKey)");
		var iterator = _container.GetItemQueryIterator<string>(query);
		while (iterator.HasMoreResults)
		{
			foreach (var key in await iterator.ReadNextAsync(ct))
			{
				if (!string.IsNullOrEmpty(key))
				{
					keys.Add(key);
				}
			}
		}
		return keys;
	}

}
