using System.IO.Compression;
using CorroServer.Services.Corro;
using CorroServer.Services.Sounds;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// End-to-end for a COMPLETE Corro .corro package: assemble the board fixture together with
/// a real game package's sounds into a single zip, then load it the way
/// an upload would — extract, validate, build the board, and register its sound pack — proving the
/// whole pipeline (board + rules + cards + sounds) works from one package. Game earcons live in
/// the PACKAGE (the engine ships only platform cues), so the audio is read from the
/// galactic-empire package at test time and not duplicated into this test.
/// </summary>
public class ClassicBoardPackageE2ETests
{
	/// <summary>
	 /// Locate a real game package's sound pack (galactic-empire, a property-trading board that
	/// ships holding/property/money earcons) to attach to the classic board fixture.
	/// </summary>
	private static string PackageSoundsDir()
	{
		var dir = AppContext.BaseDirectory;
		for (var i = 0; i < 8 && dir is not null; i++)
		{
				 var candidate = Path.Combine(dir, "server", "Packages", "galactic-empire", "assets", "sounds");
			if (File.Exists(Path.Combine(candidate, "pack.json")))
			{
				return candidate;
			}

			dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
		}
		 throw new DirectoryNotFoundException("Could not locate server/Packages/galactic-empire/assets/sounds.");
	}

	private static string TempDir() => Path.Combine(Path.GetTempPath(), "corro_e2e_" + Guid.NewGuid().ToString("N"));

	[Fact]
	public async Task A_complete_classic_package_with_sounds_loads_and_serves_end_to_end()
	{
		var fixture = CorroTestPaths.FixtureDir("corro-classic");
		var soundsSrc = PackageSoundsDir();
		var packageDir = TempDir();
		var extractDir = TempDir();
		var zipPath = Path.Combine(Path.GetTempPath(), "corro_e2e_" + Guid.NewGuid().ToString("N") + ".zip");
		try
		{
			// --- Assemble the complete package: manifest + board + cards + assets/sounds/ ------
			Directory.CreateDirectory(packageDir);
			foreach (var file in new[] { "manifest.json", "board.json", "cards.json" })
			{
				File.Copy(Path.Combine(fixture, file), Path.Combine(packageDir, file));
			}

			var packageSounds = Path.Combine(packageDir, "assets", "sounds");
			Directory.CreateDirectory(packageSounds);
			foreach (var file in Directory.GetFiles(soundsSrc)) // pack.json + the classic .ogg files
			{
				File.Copy(file, Path.Combine(packageSounds, Path.GetFileName(file)));
			}

			ZipFile.CreateFromDirectory(packageDir, zipPath);

			// --- Load it the way an upload would: extract + validate + build ------------------
			await using (var zip = File.OpenRead(zipPath))
			{
				var def = await new CorroPackageLoader().LoadFromZipAsync(zip, extractDir);
				Assert.Equal("corro-classic", def.Manifest.Id);
				Assert.Equal(40, GameDefinitionAdapter.ToSquares(def, "es").Count);
			}

			// --- The package's sounds register and serve, overlaying the default --------------
			var composite = new CompositeSoundPackProvider(new DefaultSoundPackProvider(soundsSrc));
			composite.RegisterPackage("game1", Path.Combine(extractDir, "assets", "sounds"));

			var events = composite.ResolveEvents("game1");
			Assert.True(events.ContainsKey("holding.enter"), "the package brings the holding sound");

			var holdingFile = events["holding.enter"].First();
			Assert.True(composite.TryGetSoundFile("game1", holdingFile, out var physicalPath, out var contentType));
			Assert.True(File.Exists(physicalPath));
			Assert.Contains(extractDir, physicalPath); // served from the package's own extracted folder
			Assert.Equal("audio/ogg", contentType);
		}
		finally
		{
			CorroPackageLoader.DeleteExtracted(packageDir);
			CorroPackageLoader.DeleteExtracted(extractDir);
			if (File.Exists(zipPath))
			{
				File.Delete(zipPath);
			}
		}
	}
}
