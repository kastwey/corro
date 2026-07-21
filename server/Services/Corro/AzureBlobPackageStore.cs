using Azure.Storage.Blobs;

namespace CorroServer.Services.Corro;

/// <summary>
/// Azure Blob Storage <see cref="IPackageBlobStore"/> for production: each uploaded .corro archive is
/// a single block blob in a container, so a package game survives a restart and restores on any
/// instance. Selected when a blob connection string is configured; otherwise the local filesystem impl
/// serves dev + tests. Cannot be exercised locally (no Azure), like the Cosmos client.
/// </summary>
public sealed class AzureBlobPackageStore : IPackageBlobStore
{
	private readonly BlobContainerClient _container;
	private readonly SemaphoreSlim _initLock = new(1, 1);
	private bool _containerReady;

	public AzureBlobPackageStore(string connectionString, string containerName = "corro-packages")
	{
		// The client is a lightweight handle — no network I/O here. Creating the container is deferred
		// to the first real operation (EnsureContainerAsync) so that constructing this store (e.g. while
		// resolving it through DI for an endpoint that never touches blobs) can never block or throw when
		// the storage account is unreachable.
		_container = new BlobContainerClient(connectionString, containerName);
	}

	/// <summary>Create the container once, on first use. Concurrent callers wait on a single attempt.</summary>
	private async Task EnsureContainerAsync(CancellationToken ct)
	{
		if (_containerReady)
		{
			return;
		}

		await _initLock.WaitAsync(ct);
		try
		{
			if (_containerReady)
			{
				return;
			}

			await _container.CreateIfNotExistsAsync(cancellationToken: ct);
			_containerReady = true;
		}
		finally { _initLock.Release(); }
	}

	public async Task PutAsync(string key, Stream zip, CancellationToken ct = default)
	{
		await EnsureContainerAsync(ct);
		await Blob(key).UploadAsync(zip, overwrite: true, ct);
	}

	public async Task<Stream?> GetAsync(string key, CancellationToken ct = default)
	{
		await EnsureContainerAsync(ct);
		var blob = Blob(key);
		if (!await blob.ExistsAsync(ct))
		{
			return null;
		}

		var download = await blob.DownloadStreamingAsync(cancellationToken: ct);
		return download.Value.Content;
	}

	public async Task DeleteAsync(string key, CancellationToken ct = default)
	{
		await EnsureContainerAsync(ct);
		await Blob(key).DeleteIfExistsAsync(cancellationToken: ct);
	}

	public async IAsyncEnumerable<PackageBlobInfo> ListAsync(
		[System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
	{
		await EnsureContainerAsync(ct);
		await foreach (var blob in _container.GetBlobsAsync(cancellationToken: ct))
		{
			if (!blob.Name.EndsWith(".corro", StringComparison.OrdinalIgnoreCase))
			{
				continue;
			}

			yield return new PackageBlobInfo(
				blob.Name[..^".corro".Length],
				blob.Properties.LastModified ?? DateTimeOffset.MinValue);
		}
	}

	private BlobClient Blob(string key) => _container.GetBlobClient(SafeName(key) + ".corro");

	/// <summary>Keep the key from forming an unexpected blob path; mirrors the local impl's naming.</summary>
	private static string SafeName(string key)
	{
		var safe = string.Concat(key.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_'));
		if (safe.Length == 0)
		{
			throw new ArgumentException("Blob key has no usable characters.", nameof(key));
		}

		return safe;
	}
}
