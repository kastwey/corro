using System.Runtime.CompilerServices;
using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Sounds;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace CorroServer.Tests;

public class GameRetentionCleanupTests
{
	private static readonly DateTimeOffset Now = new(2026, 7, 21, 12, 0, 0, TimeSpan.Zero);

	[Fact]
	public async Task Run_deletes_only_inactive_games_and_old_unreferenced_blobs()
	{
		var old = Doc("old", Now.AddDays(-31), packageKey: "old-package");
		var fresh = Doc("fresh", Now.AddDays(-29), packageKey: "fresh-package");
		var live = Doc("live", Now.AddDays(-60), packageKey: "live-package");
		var repo = new FakeRepository(old, fresh, live);
		var blobs = new FakeBlobStore(
			("old-package", Now.AddDays(-31)),
			("fresh-package", Now.AddDays(-31)),
			("live-package", Now.AddDays(-60)),
			("old-orphan", Now.AddDays(-31)),
			("fresh-orphan", Now.AddDays(-2)));
		var (cleanup, registry) = NewCleanup(repo, blobs);
		registry.MapLobbyConnection("live-connection", live.GameId);

		var result = await cleanup.RunAsync(Now);

		Assert.Null(await repo.LoadGameAsync(old.GameId));
		Assert.NotNull(await repo.LoadGameAsync(fresh.GameId));
		Assert.NotNull(await repo.LoadGameAsync(live.GameId));
		Assert.Contains("old-package", blobs.Deleted);
		Assert.Contains("old-orphan", blobs.Deleted);
		Assert.DoesNotContain("fresh-package", blobs.Deleted);
		Assert.DoesNotContain("live-package", blobs.Deleted);
		Assert.DoesNotContain("fresh-orphan", blobs.Deleted);
		Assert.Equal(1, result.DeletedGames);
		Assert.Equal(1, result.SkippedLiveGames);
		Assert.Equal(1, result.DeletedBlobs);
		Assert.Equal(0, result.Errors);
	}

	[Fact]
	public async Task Run_preserves_a_shared_blob_until_the_last_referencing_game_is_deleted()
	{
		var first = Doc("first", Now.AddDays(-40), packageKey: "shared");
		var second = Doc("second", Now.AddDays(-35), packageKey: "shared");
		var repo = new FakeRepository(first, second);
		var blobs = new FakeBlobStore(("shared", Now.AddDays(-40)));
		var (cleanup, _) = NewCleanup(repo, blobs);

		var result = await cleanup.RunAsync(Now);

		Assert.Equal(2, result.DeletedGames);
		Assert.Equal(new[] { "shared" }, blobs.Deleted);
	}

	[Fact]
	public async Task Run_keeps_a_game_updated_exactly_at_the_cutoff()
	{
		var cutoff = Doc("cutoff", Now.AddDays(-30));
		var repo = new FakeRepository(cutoff);
		var (cleanup, _) = NewCleanup(repo, new FakeBlobStore());

		var result = await cleanup.RunAsync(Now);

		Assert.NotNull(await repo.LoadGameAsync(cutoff.GameId));
		Assert.Equal(0, result.DeletedGames);
	}

	[Fact]
	public async Task Run_reloads_a_candidate_and_keeps_it_if_it_was_updated_after_the_scan()
	{
		var staleSnapshot = Doc("updated", Now.AddDays(-40));
		var current = staleSnapshot with { LastUpdated = Now.AddDays(-1).UtcDateTime };
		var repo = new FakeRepository(current) { CandidateSnapshot = new[] { staleSnapshot } };
		var (cleanup, _) = NewCleanup(repo, new FakeBlobStore());

		var result = await cleanup.RunAsync(Now);

		Assert.NotNull(await repo.LoadGameAsync(current.GameId));
		Assert.Equal(0, result.DeletedGames);
	}

	[Fact]
	public async Task Run_continues_after_one_game_fails_to_delete()
	{
		var failing = Doc("failing", Now.AddDays(-40));
		var succeeding = Doc("succeeding", Now.AddDays(-35));
		var repo = new FakeRepository(failing, succeeding);
		repo.ThrowOnDelete.Add(failing.GameId);
		var (cleanup, _) = NewCleanup(repo, new FakeBlobStore());

		var result = await cleanup.RunAsync(Now);

		Assert.NotNull(await repo.LoadGameAsync(failing.GameId));
		Assert.Null(await repo.LoadGameAsync(succeeding.GameId));
		Assert.Equal(1, result.DeletedGames);
		Assert.Equal(1, result.Errors);
	}

	[Fact]
	public async Task Run_continues_after_one_orphaned_blob_fails_to_delete()
	{
		var repo = new FakeRepository();
		var blobs = new FakeBlobStore(
			("failing-blob", Now.AddDays(-40)),
			("succeeding-blob", Now.AddDays(-35)));
		blobs.ThrowOnDelete.Add("failing-blob");
		var (cleanup, _) = NewCleanup(repo, blobs);

		var result = await cleanup.RunAsync(Now);

		Assert.DoesNotContain("failing-blob", blobs.Deleted);
		Assert.Contains("succeeding-blob", blobs.Deleted);
		Assert.Equal(1, result.DeletedBlobs);
		Assert.Equal(1, result.Errors);
	}

	[Theory]
	[InlineData("2026-07-21T02:30:00+00:00", 3, 30)]
	[InlineData("2026-07-21T03:00:00+00:00", 3, 1440)]
	[InlineData("2026-07-21T23:30:00+02:00", 22, 30)]
	public void Daily_schedule_targets_the_next_configured_UTC_hour(string nowText, int utcHour, int expectedMinutes)
	{
		var delay = GameRetentionWorker.DelayUntilNextRun(DateTimeOffset.Parse(nowText), utcHour);

		Assert.Equal(TimeSpan.FromMinutes(expectedMinutes), delay);
	}

	private static GameDocument Doc(string gameId, DateTimeOffset lastUpdated, string? packageKey = null)
		=> new()
		{
			Id = $"game-{gameId}",
			GameId = gameId,
			Status = GameStatus.Active,
			HostId = "host",
			InviteCode = "INV",
			Board = "test",
			CreatedAt = lastUpdated.UtcDateTime.AddDays(-1),
			LastUpdated = lastUpdated.UtcDateTime,
			PackageToken = packageKey,
			PackageBlobKey = packageKey,
		};

	private static (GameRetentionCleanup Cleanup, GameSessionRegistry Registry) NewCleanup(
		FakeRepository repository,
		FakeBlobStore blobs)
	{
		var packageStore = new CorroPackageStore(
			new CompositeSoundPackProvider(new DefaultSoundPackProvider()),
			Path.Combine(Path.GetTempPath(), "corro_retention_" + Guid.NewGuid().ToString("N")));
		var restorer = new PackageRestorer(
			packageStore,
			new ShippedPackageProvider(CorroTestPaths.PackagesRoot()),
			blobs);
		var registry = new GameSessionRegistry(
			new NoopHubContext(),
			repository,
			new NoopAuctionTimer(),
			restorer,
			NullLogger<GameSessionRegistry>.Instance);
		var cleanup = new GameRetentionCleanup(
			repository,
			registry,
			blobs,
			restorer,
			Options.Create(new GameRetentionOptions()),
			NullLogger<GameRetentionCleanup>.Instance);
		return (cleanup, registry);
	}

	private sealed class FakeRepository : IGameRepository
	{
		private readonly Dictionary<string, GameDocument> _games;
		public HashSet<string> ThrowOnDelete { get; } = new();
		public IReadOnlyList<GameDocument>? CandidateSnapshot { get; init; }

		public FakeRepository(params GameDocument[] games)
			=> _games = games.ToDictionary(game => game.GameId);

		public Task<GameDocument?> LoadGameAsync(string gameId)
			=> Task.FromResult(_games.TryGetValue(gameId, out var game) ? game : null);

		public Task<bool> DeleteGameAsync(string gameId)
		{
			if (ThrowOnDelete.Contains(gameId))
			{
				throw new InvalidOperationException("simulated delete failure");
			}
			return Task.FromResult(_games.Remove(gameId));
		}

		public async IAsyncEnumerable<GameDocument> GetGamesLastUpdatedBeforeAsync(
			DateTime cutoffUtc,
			int maxCount,
			[EnumeratorCancellation] CancellationToken ct = default)
		{
			foreach (var game in (CandidateSnapshot ?? _games.Values.ToList())
				.Where(game => game.LastUpdated < cutoffUtc)
				.OrderBy(game => game.LastUpdated)
				.Take(maxCount)
				.ToList())
			{
				ct.ThrowIfCancellationRequested();
				yield return game;
				await Task.Yield();
			}
		}

		public Task<bool> HasPackageReferenceAsync(
			string? packageToken,
			string? packageBlobKey,
			CancellationToken ct = default)
			=> Task.FromResult(_games.Values.Any(game =>
				(!string.IsNullOrEmpty(packageToken) && game.PackageToken == packageToken)
				|| (!string.IsNullOrEmpty(packageBlobKey) && game.PackageBlobKey == packageBlobKey)));

		public Task<IReadOnlySet<string>> GetReferencedPackageBlobKeysAsync(CancellationToken ct = default)
			=> Task.FromResult<IReadOnlySet<string>>(_games.Values
				.Select(game => game.PackageBlobKey)
				.Where(key => !string.IsNullOrEmpty(key))
				.Cast<string>()
				.ToHashSet(StringComparer.Ordinal));

		public Task<GameDocument?> GetByInviteCodeAsync(string inviteCode)
			=> Task.FromResult(_games.Values.FirstOrDefault(game => game.InviteCode == inviteCode));
		public Task<GameDocument?> GetByRejoinCodeAsync(string rejoinCode) => Task.FromResult<GameDocument?>(null);
		public Task<GameDocument> CreateGameAsync(GameDocument game)
		{
			_games[game.GameId] = game;
			return Task.FromResult(game);
		}
		public Task<GameDocument> UpdateGameAsync(GameDocument game)
		{
			_games[game.GameId] = game;
			return Task.FromResult(game);
		}
	}

	private sealed class FakeBlobStore : IPackageBlobStore
	{
		private readonly Dictionary<string, DateTimeOffset> _blobs;
		public List<string> Deleted { get; } = new();
		public HashSet<string> ThrowOnDelete { get; } = new();

		public FakeBlobStore(params (string Key, DateTimeOffset LastModified)[] blobs)
			=> _blobs = blobs.ToDictionary(blob => blob.Key, blob => blob.LastModified);

		public Task PutAsync(string key, Stream zip, CancellationToken ct = default)
		{
			_blobs[key] = DateTimeOffset.UtcNow;
			return Task.CompletedTask;
		}

		public Task<Stream?> GetAsync(string key, CancellationToken ct = default)
			=> Task.FromResult<Stream?>(_blobs.ContainsKey(key) ? new MemoryStream(new byte[] { 1 }) : null);

		public Task DeleteAsync(string key, CancellationToken ct = default)
		{
			if (ThrowOnDelete.Contains(key))
			{
				throw new InvalidOperationException("simulated blob delete failure");
			}
			if (_blobs.Remove(key))
			{
				Deleted.Add(key);
			}
			return Task.CompletedTask;
		}

		public async IAsyncEnumerable<PackageBlobInfo> ListAsync(
			[EnumeratorCancellation] CancellationToken ct = default)
		{
			foreach (var blob in _blobs.ToList())
			{
				ct.ThrowIfCancellationRequested();
				yield return new PackageBlobInfo(blob.Key, blob.Value);
				await Task.Yield();
			}
		}
	}

	private sealed class NoopAuctionTimer : IAuctionTimerService
	{
		public void StartTimers(string gameId, GameSettings settings, AuctionState auction) { }
		public void StopTimers(string gameId) { }
		public event Func<string, AuctionTimerTickEventArgs, Task>? OnTimerTick { add { } remove { } }
		public event Func<string, Task>? OnBidTimeout { add { } remove { } }
	}

	private sealed class NoopHubContext : IHubContext<GameHub>
	{
		public IHubClients Clients { get; } = new NoopClients();
		public IGroupManager Groups { get; } = new NoopGroups();

		private sealed class NoopClients : IHubClients
		{
			private static readonly IClientProxy Proxy = new NoopProxy();
			ISingleClientProxy IHubClients.Client(string connectionId) => (ISingleClientProxy)Proxy;
			IClientProxy IHubClients<IClientProxy>.All => Proxy;
			IClientProxy IHubClients<IClientProxy>.AllExcept(IReadOnlyList<string> excludedConnectionIds) => Proxy;
			IClientProxy IHubClients<IClientProxy>.Client(string connectionId) => Proxy;
			IClientProxy IHubClients<IClientProxy>.Clients(IReadOnlyList<string> connectionIds) => Proxy;
			IClientProxy IHubClients<IClientProxy>.Group(string groupName) => Proxy;
			IClientProxy IHubClients<IClientProxy>.GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => Proxy;
			IClientProxy IHubClients<IClientProxy>.Groups(IReadOnlyList<string> groupNames) => Proxy;
			IClientProxy IHubClients<IClientProxy>.User(string userId) => Proxy;
			IClientProxy IHubClients<IClientProxy>.Users(IReadOnlyList<string> userIds) => Proxy;
		}

		private sealed class NoopProxy : ISingleClientProxy
		{
			public Task SendCoreAsync(string method, object?[] args, CancellationToken ct = default) => Task.CompletedTask;
			public Task<T> InvokeCoreAsync<T>(string method, object?[] args, CancellationToken ct = default)
				=> throw new NotImplementedException();
		}

		private sealed class NoopGroups : IGroupManager
		{
			public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken ct = default)
				=> Task.CompletedTask;
			public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken ct = default)
				=> Task.CompletedTask;
		}
	}
}
