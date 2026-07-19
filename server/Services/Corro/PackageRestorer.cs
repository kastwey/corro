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

		if (_store.GetDefinition(token) is { } existing)
		{
			return existing;
		}

		if (!string.IsNullOrEmpty(game.ShippedBoardId) && _shipped.ResolveDir(game.ShippedBoardId) is { } dir)
		{
			return await _store.StageFromDirectoryAsync(token, dir);
		}

		if (!string.IsNullOrEmpty(game.PackageBlobKey) && await _blob.GetAsync(game.PackageBlobKey) is { } zip)
		{
			await using (zip)
			{
				return await _store.StageAsync(token, zip);
			}
		}

		return null;
	}

	/// <summary>
	/// Release a finished game's package: delete its durable blob (no-op for a shipped board, whose
	/// key has none) and unstage it (sounds + temp folder + tracked origin).
	/// </summary>
	public async Task ReleaseAsync(string token)
	{
		await _blob.DeleteAsync(token);
		_store.Release(token);
	}
}
