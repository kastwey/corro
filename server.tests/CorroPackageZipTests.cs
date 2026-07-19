using System.IO.Compression;
using CorroServer.Services.Corro;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Loading an uploaded .corro zip: extract to a temp folder (safely) and load+validate it, then
/// clean up. This is the package lifecycle for user-uploaded boards (no accounts): one temp folder
/// per game, deleted when the game ends.
/// </summary>
public class CorroPackageZipTests
{
	private static MemoryStream ZipOf(params (string name, string content)[] entries)
	{
		var ms = new MemoryStream();
		using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
		{
			foreach (var (name, content) in entries)
			{
				var e = zip.CreateEntry(name);
				using var w = new StreamWriter(e.Open());
				w.Write(content);
			}
		}
		ms.Position = 0;
		return ms;
	}

	private static MemoryStream ZipWithEntries(int count)
	{
		var ms = new MemoryStream();
		using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
		{
			for (var i = 0; i < count; i++)
			{
				zip.CreateEntry($"empty-{i}.txt");
			}
		}
		ms.Position = 0;
		return ms;
	}

	private static (string, string)[] ClassicBoardFiles(string prefix = "")
	{
		var dir = CorroTestPaths.FixtureDir("corro-classic");
		var files = new List<(string, string)>
		{
			(prefix + "manifest.json", File.ReadAllText(Path.Combine(dir, "manifest.json"))),
			(prefix + "board.json", File.ReadAllText(Path.Combine(dir, "board.json"))),
			(prefix + "cards.json", File.ReadAllText(Path.Combine(dir, "cards.json"))),
		};
		foreach (var svg in Directory.GetFiles(Path.Combine(dir, "tokens"), "*.svg"))
		{
			files.Add((prefix + "tokens/" + Path.GetFileName(svg), File.ReadAllText(svg)));
		}

		return files.ToArray();
	}

	private static string TempDir() => Path.Combine(Path.GetTempPath(), "corro_zip_test_" + Guid.NewGuid().ToString("N"));

	[Fact]
	public async Task LoadFromZip_extracts_and_loads_a_package_at_the_root_then_cleans_up()
	{
		var dest = TempDir();
		try
		{
			var def = await new CorroPackageLoader().LoadFromZipAsync(ZipOf(ClassicBoardFiles()), dest);
			Assert.Equal("corro-classic", def.Manifest.Id);
			Assert.Equal(40, def.Board.Count);
			Assert.True(File.Exists(Path.Combine(dest, "manifest.json")));
		}
		finally
		{
			CorroPackageLoader.DeleteExtracted(dest);
		}
		Assert.False(Directory.Exists(dest)); // cleanup removed the temp folder
	}

	[Fact]
	public async Task LoadFromZip_finds_the_package_in_a_subfolder()
	{
		var dest = TempDir();
		try
		{
			var def = await new CorroPackageLoader().LoadFromZipAsync(ZipOf(ClassicBoardFiles("corro-classic/")), dest);
			Assert.Equal("corro-classic", def.Manifest.Id);
			Assert.Equal(40, def.Board.Count);
		}
		finally
		{
			CorroPackageLoader.DeleteExtracted(dest);
		}
	}

	[Fact]
	public async Task LoadFromZip_rejects_a_zip_slip_entry()
	{
		var dest = TempDir();
		try
		{
			var zip = ZipOf(("../escaped.txt", "pwned"));
			await Assert.ThrowsAsync<InvalidOperationException>(
				() => new CorroPackageLoader().LoadFromZipAsync(zip, dest));
		}
		finally
		{
			CorroPackageLoader.DeleteExtracted(dest);
		}
		Assert.False(Directory.Exists(dest), "failed extraction must clean up its partial destination");
	}

	[Fact]
	public async Task LoadFromZip_rejects_too_many_entries_before_extraction()
	{
		var dest = TempDir();
		using var zip = ZipWithEntries(CorroPackageLoader.MaxZipEntries + 1);

		var error = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadFromZipAsync(zip, dest));

		Assert.Contains("too many zip entries", error.Message);
		Assert.False(Directory.Exists(dest));
	}

	[Fact]
	public async Task LoadFromZip_rejects_an_entry_over_the_uncompressed_size_limit()
	{
		var dest = TempDir();
		var oversized = new string('x', checked((int)CorroPackageLoader.MaxEntryUncompressedBytes + 1));
		using var zip = ZipOf(("oversized.txt", oversized));

		var error = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadFromZipAsync(zip, dest));

		Assert.Contains("is too large", error.Message);
		Assert.False(Directory.Exists(dest));
	}

	[Fact]
	public async Task LoadFromZip_rejects_excessive_total_uncompressed_size()
	{
		var dest = TempDir();
		var entry = new string('x', checked((int)CorroPackageLoader.MaxEntryUncompressedBytes));
		using var zip = ZipOf(
			("one.txt", entry),
			("two.txt", entry),
			("three.txt", "x"));

		var error = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadFromZipAsync(zip, dest));

		Assert.Contains("expands beyond", error.Message);
		Assert.False(Directory.Exists(dest));
	}

	[Fact]
	public async Task LoadFromZip_rejects_an_invalid_package()
	{
		var dest = TempDir();
		try
		{
			// A board referencing an undefined group fails validation (reusing LoadAsync's checks).
			var zip = ZipOf(
				("manifest.json", """{ "id": "t", "groups": [], "decks": [] }"""),
				("board.json", """[ { "id": 0, "type": "start" }, { "id": 1, "type": "property", "group": "ghost" } ]"""),
				("cards.json", "[]"));
			await Assert.ThrowsAsync<InvalidOperationException>(
				() => new CorroPackageLoader().LoadFromZipAsync(zip, dest));
		}
		finally
		{
			CorroPackageLoader.DeleteExtracted(dest);
		}
	}
}
