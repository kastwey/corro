using System.Collections.Concurrent;
using CorroServer.Models;

namespace CorroServer.Services;

/// <summary>
/// In-memory <see cref="IGameRepository"/> used when no CosmosDB connection string is configured — the
/// persistence counterpart to <see cref="Corro.LocalFilePackageBlobStore"/>. Games live only for the
/// lifetime of the process (no durability, no TTL expiry), which is exactly what a clone-and-run or an
/// offline dev session wants: create/join/play works with zero Azure setup. Registered as a singleton so
/// games survive across requests. Production (a real connection string) wires <see cref="CosmosGameRepository"/>.
/// </summary>
public sealed class InMemoryGameRepository : IGameRepository
{
	// Keyed by the bare gameId (no "game-" document prefix), mirroring the Cosmos partition key.
	private readonly ConcurrentDictionary<string, GameDocument> _games = new();

	private static string Key(string gameId) => gameId.StartsWith("game-") ? gameId[5..] : gameId;

	public Task<GameDocument?> LoadGameAsync(string gameId)
		=> Task.FromResult(_games.TryGetValue(Key(gameId), out var doc) ? doc : null);

	public Task<GameDocument?> GetByInviteCodeAsync(string inviteCode)
		=> Task.FromResult(_games.Values.FirstOrDefault(g => g.InviteCode == inviteCode));

	public Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode)
		=> Task.FromResult(_games.Values.FirstOrDefault(
			g => g.Players.Any(p => p.RejoinCode == rejoinCode)));

	public Task<GameDocument> CreateGameAsync(GameDocument game)
	{
		_games[Key(game.GameId)] = game;
		return Task.FromResult(game);
	}

	public Task<GameDocument> UpdateGameAsync(GameDocument game)
	{
		var updated = game with { LastUpdated = DateTime.UtcNow };
		_games[Key(game.GameId)] = updated;
		return Task.FromResult(updated);
	}

	public Task<bool> DeleteGameAsync(string gameId)
		=> Task.FromResult(_games.TryRemove(Key(gameId), out _));
}
