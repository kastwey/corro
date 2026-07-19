using System.IO.Compression;
using CorroServer.Models;
using CorroServer.Services.Corro;
using CorroServer.Services.Sounds;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// On restore, a package game's files (rent rules + sounds) aren't in the snapshot, so the restorer
/// re-stages the package under the game's existing token: a shipped board from server/Packages by id,
/// an uploaded board from its durable blob. It's idempotent and releases the blob on game over.
/// </summary>
public class PackageRestorerTests
{
	private static CorroPackageStore NewStore()
		=> new(
			new CompositeSoundPackProvider(new DefaultSoundPackProvider(CorroTestPaths.FixturePath("sounds-default"))),
			Path.Combine(Path.GetTempPath(), "corro_restore_" + Guid.NewGuid().ToString("N")));

	private static LocalFilePackageBlobStore NewBlob()
		=> new(Path.Combine(Path.GetTempPath(), "corro_restoreblob_" + Guid.NewGuid().ToString("N")));

	private static ShippedPackageProvider Shipped() => new(CorroTestPaths.PackagesRoot());

	private static GameDocument Doc(string? token, string? shippedId = null, string? blobKey = null)
		=> new()
		{
			Id = "game-x",
			GameId = "x",
			Status = GameStatus.Active,
			HostId = "h",
			InviteCode = "ABC",
			ShippedBoardId = shippedId,
			PackageBlobKey = blobKey,
			GameState = token is null ? null : new GameState { PackageToken = token },
		};

	private static MemoryStream ZipOfDir(string dir)
	{
		var ms = new MemoryStream();
		using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
		{
			foreach (var file in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
			{
				var rel = Path.GetRelativePath(dir, file).Replace('\\', '/');
				using var w = new StreamWriter(zip.CreateEntry(rel).Open());
				w.Write(File.ReadAllText(file));
			}
		}

		ms.Position = 0;
		return ms;
	}

	[Fact]
	public async Task ReStages_a_shipped_board_by_id_under_the_games_token()
	{
		var store = NewStore();
		var restorer = new PackageRestorer(store, Shipped(), NewBlob());

				var def = await restorer.ReStageAsync(Doc("tok-s", shippedId: "imperio-galactico"));

		Assert.NotNull(def);
		Assert.NotNull(store.GetDefinition("tok-s")); // staged under the token so sounds re-register
	}

	[Fact]
	public async Task ReStages_an_uploaded_board_from_its_blob()
	{
		var store = NewStore();
		var blob = NewBlob();
				await blob.PutAsync("tok-u", ZipOfDir(CorroTestPaths.PackageDir("imperio-galactico")));
		var restorer = new PackageRestorer(store, Shipped(), blob);

		var def = await restorer.ReStageAsync(Doc("tok-u", blobKey: "tok-u"));

		Assert.NotNull(def);
		Assert.NotNull(store.GetDefinition("tok-u"));
	}

	[Fact]
	public async Task ReStage_returns_null_when_it_is_not_a_package_game()
		=> Assert.Null(await new PackageRestorer(NewStore(), Shipped(), NewBlob()).ReStageAsync(Doc(token: null)));

	[Fact]
	public async Task ReStage_is_idempotent_when_the_package_is_still_staged()
	{
		var store = NewStore();
		var restorer = new PackageRestorer(store, Shipped(), NewBlob());
				await restorer.ReStageAsync(Doc("tok", shippedId: "imperio-galactico"));

		// A second call with NO source still returns the already-staged definition.
		Assert.NotNull(await restorer.ReStageAsync(Doc("tok")));
	}

	[Fact]
	public async Task Release_deletes_the_blob_and_unstages_the_package()
	{
		var store = NewStore();
		var blob = NewBlob();
			   await blob.PutAsync("tok", ZipOfDir(CorroTestPaths.PackageDir("imperio-galactico")));
		var restorer = new PackageRestorer(store, Shipped(), blob);
		await restorer.ReStageAsync(Doc("tok", blobKey: "tok"));

		await restorer.ReleaseAsync("tok");

		Assert.Null(store.GetDefinition("tok"));
		Assert.Null(await blob.GetAsync("tok"));
	}
}
