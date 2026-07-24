using CorroServer.Services;
using CorroServer.Services.Voice;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace CorroServer.Controllers;

/// <summary>
/// Public (anonymous) endpoints for client configuration
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class ConfigController : ControllerBase
{
	private readonly SiteBrandingOptions _siteBranding;
	private readonly bool _voiceAvailable;

	public ConfigController(
		IOptions<SiteBrandingOptions> siteBranding,
		ILiveKitVoiceService? voiceService = null)
	{
		_siteBranding = siteBranding.Value;
		_voiceAvailable = voiceService?.IsConfigured ?? false;
	}

	/// <summary>Get the public identity selected by this deployment.</summary>
	[HttpGet("branding")]
	public ActionResult<SiteBrandingOptions> GetBranding() => _siteBranding;

	/// <summary>
	/// The canonical board keymap (key → client command). Served from the server so it is the single
	/// source of truth; the client fetches it and the package validator derives reserved keys from it.
	/// </summary>
	[HttpGet("keymap")]
	public ContentResult GetKeymap() => Content(EngineKeymap.Json, "application/json");

	/// <summary>Whether this deployment offers voice chat. URLs and credentials are deliberately
	/// absent; an authenticated player receives the public URL only with a short-lived token.</summary>
	[HttpGet("voice")]
	public ActionResult<object> GetVoice() => new { Available = _voiceAvailable };

	/// <summary>
	/// Get available languages
	/// </summary>
	[HttpGet("languages")]
	public ActionResult<IEnumerable<object>> GetLanguages()
	{
		// List of supported languages
		var languages = new[]
		{
			new { code = "en", name = "English" },
			new { code = "es", name = "Spanish" }
		};

		return Ok(languages);
	}
}
