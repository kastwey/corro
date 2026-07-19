using CorroServer.Models;
using CorroServer.Services.Sounds;
using Microsoft.AspNetCore.Mvc;

namespace CorroServer.Controllers;

/// <summary>
/// Public (anonymous) endpoints that expose the sound pack to the client: a resolved
/// event-to-URL manifest and the audio files themselves. The client plays sounds by logical
/// event name; this controller owns the mapping to concrete files and the safe serving.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class SoundsController : ControllerBase
{
	private readonly ISoundPackProvider _provider;

	public SoundsController(ISoundPackProvider provider)
	{
		_provider = provider;
	}

	/// <summary>
	/// Returns the event-to-URL map for the requested pack (defaults to the bundled pack).
	/// </summary>
	[HttpGet("manifest")]
	public ActionResult<SoundManifestResponse> GetManifest([FromQuery(Name = "pack")] string? packId = null)
	{
		var effectivePackId = string.IsNullOrWhiteSpace(packId) ? _provider.DefaultPackId : packId;
		var events = _provider.ResolveEvents(packId);

		var urls = events.ToDictionary(
			pair => pair.Key,
			pair => (IReadOnlyList<string>)pair.Value
				.Select(file => $"/api/sounds/file/{Uri.EscapeDataString(effectivePackId)}/{Uri.EscapeDataString(file)}")
				.ToList());

		return Ok(new SoundManifestResponse
		{
			PackId = effectivePackId,
			Events = urls,
			Announcements = _provider.ResolveAnnouncements(packId),
		});
	}

	/// <summary>
	/// Streams a single audio file declared by a pack. Only files referenced by the pack
	/// manifest with an allowed audio extension are served; anything else is a 404.
	/// </summary>
	[HttpGet("file/{packId}/{file}")]
	public IActionResult GetSound(string packId, string file)
	{
		if (!_provider.TryGetSoundFile(packId, file, out var physicalPath, out var contentType))
		{
			return NotFound();
		}

		return PhysicalFile(physicalPath, contentType);
	}
}
