using System.IO.Compression;
using CorroServer.Models;
using CorroServer.Services.Corro;
using CorroServer.Services.Sounds;

namespace CorroServer.Tests;

/// <summary>
/// The full uploaded-package restore path, end to end across BOTH live emulators — the one flow that
/// the per-layer tests only cover in pieces: a package's zip lands in the Azurite blob, the game is
/// persisted to the Cosmos emulator, then (simulating a restart — a fresh package store with nothing
/// staged) the game is loaded back from Cosmos and the restorer re-stages the package from its blob.
/// Gated by <see cref="EmulatorsFactAttribute"/>, so it runs locally with both emulators up (tools/dev.ps1)
/// and is skipped — never failed — in CI.
/// </summary>
public class PackageRestoreEndToEndIntegrationTests
{
	private static CorroPackageStore FreshStore() // a fresh store == a just-restarted server (nothing staged)
		=> new(
			new CompositeSoundPackProvider(new DefaultSoundPackProvider(CorroTestPaths.FixturePath("sounds-default"))),
			Path.Combine(Path.GetTempPath(), "corro_e2e_" + Guid.NewGuid().ToString("N")));

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

	[EmulatorsFact]
	public async Task Uploaded_package_game_survives_a_restart_restoring_from_the_blob_and_Cosmos()
	{
		var blob = new AzureBlobPackageStore(Emulators.BlobConnectionString, "corro-e2e-" + Guid.NewGuid().ToString("N"));
		var repo = await Emulators.NewCosmosRepositoryAsync();
		var token = "e2e-" + Guid.NewGuid().ToString("N")[..12];
		var gameId = "e2e-" + Guid.NewGuid().ToString("N")[..8];

		try
		{
			// 1. Upload: the package's zip is stored durably in the blob (what an /api/packages upload does).
					 await blob.PutAsync(token, ZipOfDir(CorroTestPaths.PackageDir("imperio-galactico")));

			// 2. Persist the game to Cosmos, referencing the package by its durable blob key + token.
			await repo.CreateGameAsync(new GameDocument
			{
				Id = $"game-{gameId}",
				GameId = gameId,
				Status = GameStatus.Active,
				HostId = "h",
				InviteCode = "ABC",
					 Board = "imperio-galactico",
				PackageToken = token,
				PackageBlobKey = token,
			});

			// 3. Restart: nothing is staged in this fresh store; read the game back from Cosmos.
			var store = FreshStore();
			var reloaded = await repo.LoadGameAsync(gameId);
			Assert.NotNull(reloaded);
			Assert.Null(store.GetDefinition(token)); // not staged yet — must be re-derived

			// 4. Restore: the restorer re-stages the package from its blob under the game's token.
			var def = await new PackageRestorer(store, new ShippedPackageProvider(CorroTestPaths.PackagesRoot()), blob)
				.ReStageAsync(reloaded!);

			Assert.NotNull(def);
					 Assert.Equal("imperio-galactico", def!.Manifest.Id);
			Assert.NotEmpty(def.Board);
			Assert.Equal("créditos", def.I18n["es"]["currency.name"]); // the package's own i18n came back through the blob
			Assert.NotNull(store.GetDefinition(token));                // staged under the token, so its sounds re-register

			// 5. Game over: releasing deletes the blob and unstages the package.
			await new PackageRestorer(store, new ShippedPackageProvider(CorroTestPaths.PackagesRoot()), blob).ReleaseAsync(token);
			Assert.Null(await blob.GetAsync(token));
		}
		finally
		{
			await repo.DeleteGameAsync(gameId);
			await blob.DeleteAsync(token);
		}
	}
}
