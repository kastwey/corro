using CorroServer.Controllers;
using CorroServer.Models;
using CorroServer.Services.Sounds;
using Microsoft.AspNetCore.Mvc;

namespace CorroServer.Tests;

/// <summary>
/// Coverage for the sound pack pipeline: the default provider (manifest parsing, caching,
/// graceful fallback and the safe file resolution) and the controller (event-to-URL manifest
/// plus the secured file endpoint).
/// </summary>
public class SoundsTests : IDisposable
{
	private readonly string _dir;

	public SoundsTests()
	{
		_dir = Path.Combine(Path.GetTempPath(), "corro-sounds-" + Guid.NewGuid().ToString("N"));
		Directory.CreateDirectory(_dir);
	}

	public void Dispose()
	{
		try { Directory.Delete(_dir, recursive: true); } catch { /* best effort */ }
	}

	private void WritePack(string json) => File.WriteAllText(Path.Combine(_dir, "pack.json"), json);
	private void WriteFile(string name, byte[] bytes) => File.WriteAllBytes(Path.Combine(_dir, name), bytes);
	private DefaultSoundPackProvider Provider() => new(_dir);

	// ===== DefaultSoundPackProvider =====

	[Fact]
	public void ResolveEvents_ReturnsDeclaredEvents()
	{
		WritePack("""{ "packId": "default", "events": { "dice.roll": "dice.mp3", "error": "err.ogg" } }""");

		var events = Provider().ResolveEvents(null);

		Assert.Equal(new[] { "dice.mp3" }, events["dice.roll"]);
		Assert.Equal(new[] { "err.ogg" }, events["error"]);
	}

	[Fact]
	public void ResolveEvents_ParsesFileArrays()
	{
		WritePack("""{ "packId": "default", "events": { "money.pay": ["pay1.ogg", "pay2.ogg", "pay3.ogg"] } }""");

		var events = Provider().ResolveEvents(null);

		Assert.Equal(new[] { "pay1.ogg", "pay2.ogg", "pay3.ogg" }, events["money.pay"]);
	}

	[Fact]
	public void DefaultPackId_ComesFromManifest()
	{
		WritePack("""{ "packId": "classic", "events": {} }""");

		Assert.Equal("classic", Provider().DefaultPackId);
	}

	[Fact]
	public void MissingManifest_FallsBackToEmptyPack()
	{
		// No pack.json written.
		var provider = Provider();

		Assert.Equal("default", provider.DefaultPackId);
		Assert.Empty(provider.ResolveEvents(null));
	}

	[Fact]
	public void InvalidManifest_FallsBackToEmptyPack()
	{
		WritePack("this is not json");

		Assert.Empty(Provider().ResolveEvents(null));
	}

	[Fact]
	public void TryGetSoundFile_DeclaredExistingFile_Succeeds()
	{
		WritePack("""{ "packId": "default", "events": { "dice.roll": "dice.mp3" } }""");
		WriteFile("dice.mp3", new byte[] { 1, 2, 3 });

		var ok = Provider().TryGetSoundFile("default", "dice.mp3", out var path, out var contentType);

		Assert.True(ok);
		Assert.Equal("audio/mpeg", contentType);
		Assert.Equal(Path.Combine(_dir, "dice.mp3"), path);
	}

	[Fact]
	public void TryGetSoundFile_FileDeclaredInsideArray_Succeeds()
	{
		WritePack("""{ "packId": "default", "events": { "money.pay": ["pay1.ogg", "pay2.ogg"] } }""");
		WriteFile("pay2.ogg", new byte[] { 9 });

		var ok = Provider().TryGetSoundFile("default", "pay2.ogg", out var path, out var contentType);

		Assert.True(ok);
		Assert.Equal("audio/ogg", contentType);
		Assert.Equal(Path.Combine(_dir, "pay2.ogg"), path);
	}

	[Fact]
	public void TryGetSoundFile_UndeclaredFile_Fails()
	{
		WritePack("""{ "packId": "default", "events": { "dice.roll": "dice.mp3" } }""");
		WriteFile("secret.mp3", new byte[] { 1 });

		// The file exists on disk but is not referenced by the pack: must not be served.
		Assert.False(Provider().TryGetSoundFile("default", "secret.mp3", out _, out _));
	}

	[Fact]
	public void TryGetSoundFile_PathTraversal_Fails()
	{
		WritePack("""{ "packId": "default", "events": { "dice.roll": "dice.mp3" } }""");

		Assert.False(Provider().TryGetSoundFile("default", "../pack.json", out _, out _));
		Assert.False(Provider().TryGetSoundFile("default", "../../secrets.txt", out _, out _));
	}

	[Fact]
	public void TryGetSoundFile_DisallowedExtension_Fails()
	{
		WritePack("""{ "packId": "default", "events": { "evil": "payload.exe" } }""");
		WriteFile("payload.exe", new byte[] { 1 });

		Assert.False(Provider().TryGetSoundFile("default", "payload.exe", out _, out _));
	}

	[Fact]
	public void TryGetSoundFile_DeclaredButMissingOnDisk_Fails()
	{
		WritePack("""{ "packId": "default", "events": { "dice.roll": "dice.mp3" } }""");
		// dice.mp3 not written to disk.

		Assert.False(Provider().TryGetSoundFile("default", "dice.mp3", out _, out _));
	}

	// ===== SoundsController =====

	[Fact]
	public void Manifest_MapsEventsToFileUrls()
	{
		WritePack("""{ "packId": "default", "events": { "dice.roll": "dice.mp3" } }""");
		var controller = new SoundsController(Provider());

		var result = controller.GetManifest(null);

		var ok = Assert.IsType<OkObjectResult>(result.Result);
		var manifest = Assert.IsType<SoundManifestResponse>(ok.Value);
		Assert.Equal("default", manifest.PackId);
		Assert.Equal(
			new[] { "/api/sounds/file/default/dice.mp3" },
			manifest.Events["dice.roll"]);
	}

	[Fact]
	public void Manifest_MapsArrayEventToMultipleUrls()
	{
		WritePack("""{ "packId": "default", "events": { "money.pay": ["pay1.ogg", "pay2.ogg"] } }""");
		var controller = new SoundsController(Provider());

		var result = controller.GetManifest(null);

		var ok = Assert.IsType<OkObjectResult>(result.Result);
		var manifest = Assert.IsType<SoundManifestResponse>(ok.Value);
		Assert.Equal(
			new[] { "/api/sounds/file/default/pay1.ogg", "/api/sounds/file/default/pay2.ogg" },
			manifest.Events["money.pay"]);
	}

	[Fact]
	public void GetSound_UndeclaredFile_ReturnsNotFound()
	{
		WritePack("""{ "packId": "default", "events": { "dice.roll": "dice.mp3" } }""");
		var controller = new SoundsController(Provider());

		Assert.IsType<NotFoundResult>(controller.GetSound("default", "nope.mp3"));
	}

	[Fact]
	public void GetSound_DeclaredExistingFile_ReturnsPhysicalFile()
	{
		WritePack("""{ "packId": "default", "events": { "dice.roll": "dice.mp3" } }""");
		WriteFile("dice.mp3", new byte[] { 1, 2, 3 });
		var controller = new SoundsController(Provider());

		var file = Assert.IsType<PhysicalFileResult>(controller.GetSound("default", "dice.mp3"));
		Assert.Equal("audio/mpeg", file.ContentType);
	}
}
