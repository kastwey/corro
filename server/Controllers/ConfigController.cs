using CorroServer.Services;
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

	public ConfigController(IOptions<SiteBrandingOptions> siteBranding)
	{
		_siteBranding = siteBranding.Value;
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
