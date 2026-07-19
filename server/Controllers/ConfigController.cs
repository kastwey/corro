using System.Text.Json;
using CorroServer.Services;
using Microsoft.AspNetCore.Mvc;

namespace CorroServer.Controllers;

/// <summary>
/// Public (anonymous) endpoints for client configuration
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class ConfigController : ControllerBase
{
	private readonly ILogger<ConfigController> _logger;

	public ConfigController(ILogger<ConfigController> logger)
	{
		_logger = logger;
	}

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
			new { code = "es", name = "Español" }
		};

		return Ok(languages);
	}
}
