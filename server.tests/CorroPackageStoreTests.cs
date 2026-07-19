using System.IO.Compression;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Services.Sounds;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The package store owns a game's uploaded .corro lifecycle: extract + load + register its sound
/// pack under the game id, then release everything (sounds + temp folder) when the game ends.
/// </summary>
public class CorroPackageStoreTests
{
	private static string TempDir() => Path.Combine(Path.GetTempPath(), "corro_store_" + Guid.NewGuid().ToString("N"));

	/// <summary>Assemble a complete package zip: the board fixture + a small sounds/ folder.</summary>
	private static string AssembleZip()
	{
		var fixture = CorroTestPaths.FixtureDir("corro-classic");
		var soundsSrc = CorroTestPaths.FixturePath("sounds-package");
		var pkgDir = TempDir();
		var zipPath = Path.Combine(Path.GetTempPath(), "corro_store_" + Guid.NewGuid().ToString("N") + ".zip");

		Directory.CreateDirectory(pkgDir);
		foreach (var file in new[] { "manifest.json", "board.json", "cards.json" })
		{
			File.Copy(Path.Combine(fixture, file), Path.Combine(pkgDir, file));
		}

		var sounds = Path.Combine(pkgDir, "sounds");
		Directory.CreateDirectory(sounds);
		foreach (var file in Directory.GetFiles(soundsSrc))
		{
			File.Copy(file, Path.Combine(sounds, Path.GetFileName(file)));
		}

		var i18n = Path.Combine(pkgDir, "i18n");
		Directory.CreateDirectory(i18n);
		File.WriteAllText(Path.Combine(i18n, "es.json"), "{\"groups\":{\"g1\":\"Sistema Cuñao\"}}");

		ZipFile.CreateFromDirectory(pkgDir, zipPath);
		CorroPackageLoader.DeleteExtracted(pkgDir);
		return zipPath;
	}

	[Fact]
	public async Task LoadForGame_loads_and_registers_sounds_then_Release_cleans_up()
	{
		var zipPath = AssembleZip();
		var sounds = new CompositeSoundPackProvider(new DefaultSoundPackProvider(CorroTestPaths.FixturePath("sounds-default")));
		var baseDir = TempDir();
		var store = new CorroPackageStore(sounds, baseDir);
		try
		{
			GameDefinition def;
			await using (var zip = File.OpenRead(zipPath))
			{
				def = await store.StageAsync("game-1", zip);
			}

			Assert.Equal("corro-classic", def.Manifest.Id);
			Assert.Equal(40, def.Board.Count);
			Assert.True(Directory.Exists(Path.Combine(baseDir, "game-1"))); // extracted per key
			Assert.Same(def, store.GetDefinition("game-1"));               // staged for later retrieval

			// Its sound pack is registered under the key, overlaying the default.
			Assert.Equal("blackhole.ogg", sounds.ResolveEvents("game-1")["holding.enter"].Single());

			store.Release("game-1");
			Assert.Null(store.GetDefinition("game-1"));

			// Sounds revert to the default and the temp folder is gone.
			Assert.Equal("default-holding.ogg", sounds.ResolveEvents("game-1")["holding.enter"].Single());
			Assert.False(Directory.Exists(Path.Combine(baseDir, "game-1")));
		}
		finally
		{
			CorroPackageLoader.DeleteExtracted(baseDir);
			if (File.Exists(zipPath))
			{
				File.Delete(zipPath);
			}
		}
	}

	[Fact]
	public async Task ReadI18n_returns_the_package_translation_file_and_guards_the_path()
	{
		var zipPath = AssembleZip();
		var sounds = new CompositeSoundPackProvider(new DefaultSoundPackProvider(CorroTestPaths.FixturePath("sounds-default")));
		var baseDir = TempDir();
		var store = new CorroPackageStore(sounds, baseDir);
		try
		{
			await using (var zip = File.OpenRead(zipPath))
			{
				await store.StageAsync("game-1", zip);
			}

			// The package's own i18n/es.json is returned verbatim.
			var es = store.ReadI18n("game-1", "es");
			Assert.NotNull(es);
			Assert.Contains("Sistema Cuñao", es!);

			Assert.Null(store.ReadI18n("game-1", "en"));       // package ships no en.json
			Assert.Null(store.ReadI18n("missing", "es"));      // no such game
			Assert.Null(store.ReadI18n("game-1", "../board")); // path traversal is rejected
		}
		finally
		{
			store.Release("game-1");
			CorroPackageLoader.DeleteExtracted(baseDir);
			if (File.Exists(zipPath))
			{
				File.Delete(zipPath);
			}
		}
	}
}
