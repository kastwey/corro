namespace CorroServer.Services.Corro;

/// <summary>
/// Durable storage for uploaded .corro archives. An uploaded board's files (rent rules + sounds)
/// live only in the package, not in the game snapshot, so to restore a package game after a server
/// restart / on another instance we must keep the archive somewhere durable. Each upload is stored as
/// a SINGLE zip blob under a key; restore fetches it and re-stages it. Shipped boards don't use this
/// (they live on disk in server/Packages and are re-staged by id).
/// </summary>
public interface IPackageBlobStore
{
	/// <summary>Store (or replace) the package archive under <paramref name="key"/>.</summary>
	Task PutAsync(string key, Stream zip, CancellationToken ct = default);

	/// <summary>Open the stored archive for reading, or null if there is none under <paramref name="key"/>.</summary>
	Task<Stream?> GetAsync(string key, CancellationToken ct = default);

	/// <summary>Delete the archive under <paramref name="key"/> (no-op if absent).</summary>
	Task DeleteAsync(string key, CancellationToken ct = default);

	/// <summary>Enumerate stored package archives with their last modification time.</summary>
	IAsyncEnumerable<PackageBlobInfo> ListAsync(CancellationToken ct = default);
}

/// <summary>A durable uploaded package archive available for retention processing.</summary>
public sealed record PackageBlobInfo(string Key, DateTimeOffset LastModified);

/// <summary>
/// Filesystem-backed <see cref="IPackageBlobStore"/> for local development and tests (Azure Blob is
/// only wired in production, the same way Cosmos is). Each archive is a single .corro file under a
/// base folder, named from a sanitized key.
/// </summary>
public sealed class LocalFilePackageBlobStore : IPackageBlobStore
{
	private readonly string _dir;

	public LocalFilePackageBlobStore(string? dir = null)
		=> _dir = dir ?? Path.Combine(Path.GetTempPath(), "corro-blobs");

	public async Task PutAsync(string key, Stream zip, CancellationToken ct = default)
	{
		Directory.CreateDirectory(_dir);
		await using var file = File.Create(PathFor(key));
		await zip.CopyToAsync(file, ct);
	}

	public Task<Stream?> GetAsync(string key, CancellationToken ct = default)
	{
		var path = PathFor(key);
		Stream? stream = File.Exists(path) ? File.OpenRead(path) : null;
		return Task.FromResult(stream);
	}

	public Task DeleteAsync(string key, CancellationToken ct = default)
	{
		var path = PathFor(key);
		if (File.Exists(path))
		{
			File.Delete(path);
		}

		return Task.CompletedTask;
	}

	public async IAsyncEnumerable<PackageBlobInfo> ListAsync(
		[System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
	{
		if (!Directory.Exists(_dir))
		{
			yield break;
		}

		foreach (var path in Directory.EnumerateFiles(_dir, "*.corro", SearchOption.TopDirectoryOnly))
		{
			ct.ThrowIfCancellationRequested();
			var file = new FileInfo(path);
			yield return new PackageBlobInfo(
				Path.GetFileNameWithoutExtension(file.Name),
				file.LastWriteTimeUtc);
			await Task.Yield();
		}
	}

	private string PathFor(string key) => Path.Combine(_dir, SafeName(key) + ".corro");

	/// <summary>Keep the key from escaping the base folder when used as a file name.</summary>
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
