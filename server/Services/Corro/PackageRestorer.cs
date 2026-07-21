using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Corro;

/// <summary>
/// Re-derives a package for a game being restored after a server restart / on another instance: the
/// game snapshot persists the board + decks + cards, but the package FILES (rent rules + sounds) do
/// not, so they must be re-staged. A shipped board is re-staged from server/Packages by id; an
/// uploaded board from its durable zip blob. Re-staging happens under the game's existing package
/// token, so the sound pack re-registers under the id the running client already requests.
/// </summary>
public sealed class PackageRestorer
{
	private readonly CorroPackageStore _store;
	private readonly ShippedPackageProvider _shipped;
	private readonly IPackageBlobStore _blob;

	public PackageRestorer(CorroPackageStore store, ShippedPackageProvider shipped, IPackageBlobStore blob)
	{
		_store = store;
		_shipped = shipped;
		_blob = blob;
	}

	/// <summary>
	/// Re-stage the package for a restored game under its existing token and return the definition, or
	/// null if it isn't a package game / the source can't be found. Idempotent: if the package is still
	/// staged in this process (e.g. an in-process re-hydration), the existing definition is returned.
	/// </summary>
	public async Task<GameDefinition?> ReStageAsync(GameDocument game)
	{
		var token = game.GameState?.PackageToken ?? game.PackageToken;
		if (string.IsNullOrEmpty(token))
		{
			return null;
		}

		GameDefinition? definition = _store.GetDefinition(token);
		if (definition is not null)
		{
			return definition;
		}

		if (!string.IsNullOrEmpty(game.ShippedBoardId) && _shipped.ResolveDir(game.ShippedBoardId) is { } dir)
		{
			definition = await _store.StageFromDirectoryAsync(token, dir);
		}
		else if (!string.IsNullOrEmpty(game.PackageBlobKey) && await _blob.GetAsync(game.PackageBlobKey) is { } zip)
		{
			await using (zip)
			{
				definition = await _store.StageAsync(token, zip);
			}
		}

		return definition;
	}

	/// <summary>
	/// Release a finished game's package: delete its durable blob when one is explicitly recorded,
	/// then unstage it (sounds + temp folder + tracked origin). The unstage runs even when Blob
	/// Storage is temporarily unavailable; the retention sweep can retry an orphaned blob later.
	/// </summary>
	public async Task ReleaseAsync(string? token, string? blobKey)
	{
		try
		{
			if (!string.IsNullOrEmpty(blobKey))
			{
				await _blob.DeleteAsync(blobKey);
			}
		}
		finally
		{
			if (!string.IsNullOrEmpty(token))
			{
				_store.Release(token);
			}
		}
	}

	/// <summary>Delete an orphaned durable upload and unstage every runtime token derived from it.</summary>
	public async Task ReleaseOrphanBlobAsync(string blobKey, CancellationToken ct = default)
	{
		try
		{
			await _blob.DeleteAsync(blobKey, ct);
		}
		finally
		{
			_store.ReleaseByBlobKey(blobKey);
		}
	}
}
