using CorroServer.Hubs;
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
	private readonly PrivacyOptions _privacy;
	private readonly PublicMetricsOptions _metrics;
	private readonly BuildInfoOptions _build;
	private readonly GameSessionRegistry? _sessions;
	private readonly IWebHostEnvironment? _environment;
	private readonly bool _voiceAvailable;

	/// <summary>Privacy and the environment are optional for the same reason the voice service is:
	/// a test that only asks about branding or the keymap should not have to hand over the world.
	/// Absent, the deployment simply has no notice — which is a real, supported state.</summary>
	public ConfigController(
		IOptions<SiteBrandingOptions> siteBranding,
		IOptions<PrivacyOptions>? privacy = null,
		IWebHostEnvironment? environment = null,
		ILiveKitVoiceService? voiceService = null,
		IOptions<PublicMetricsOptions>? metrics = null,
		GameSessionRegistry? sessions = null,
		IOptions<BuildInfoOptions>? build = null)
	{
		_siteBranding = siteBranding.Value;
		_privacy = privacy?.Value ?? new PrivacyOptions();
		_metrics = metrics?.Value ?? new PublicMetricsOptions();
		_build = build?.Value ?? new BuildInfoOptions();
		_sessions = sessions;
		_environment = environment;
		_voiceAvailable = voiceService?.IsConfigured ?? false;
	}

	/// <summary>Get the public identity selected by this deployment.</summary>
	[HttpGet("branding")]
	public ActionResult<SiteBrandingOptions> GetBranding() => _siteBranding;

	/// <summary>
	/// This deployment's privacy notice, with the controller's own details filled in.
	///
	/// The TEXT ships with the app because what Corro does with data is the same wherever it runs;
	/// the identity does not, because it is a fact about whoever is running this server. A
	/// deployment that has said nothing gets `configured: false` and the client offers no notice.
	/// That state exists for local development; a public deployment still processes table and
	/// connection data even when external sign-in is disabled.
	/// </summary>
	[HttpGet("privacy")]
	public async Task<ActionResult<object>> GetPrivacy([FromQuery] string language = "en")
	{
		if (!_privacy.IsConfigured)
		{
			return new { configured = false };
		}

		if (!string.IsNullOrWhiteSpace(_privacy.PolicyUrl))
		{
			// This host publishes their own; link to it rather than pretending ours is theirs.
			return new { configured = true, url = _privacy.PolicyUrl };
		}

		var text = await ReadPolicyAsync(language);
		if (text == null)
		{
			return new { configured = false };
		}

		return new
		{
			configured = true,
			controller = _privacy.ControllerName,
			jurisdiction = _privacy.Jurisdiction,
			contact = _privacy.Contact,
			markdown = text
				.Replace("{{controller}}", _privacy.ControllerName)
				.Replace("{{jurisdiction}}", _privacy.Jurisdiction)
				.Replace("{{contact}}", _privacy.Contact),
		};
	}

	/// <summary>The notice in the reader's language, falling back to English. The name is built
	/// from a whitelist rather than the query string, so no request can walk out of the folder.
	///
	/// Read from the CONTENT root, not wwwroot: the text is a template with {{placeholders}} that
	/// this method fills in, so serving it as a static file would show a reader the placeholders.
	/// (wwwroot is also wiped and re-mirrored from frontend/dist on every build.)</summary>
	private async Task<string?> ReadPolicyAsync(string language)
	{
		var lang = language == "es" ? "es" : "en";
		var path = Path.Combine(_environment?.ContentRootPath ?? ".", "Legal", $"privacy.{lang}.md");
		return System.IO.File.Exists(path) ? await System.IO.File.ReadAllTextAsync(path) : null;
	}

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
	/// What this deployment says about itself in public: how many tables have somebody at them and
	/// how many people are connected. A visitor cannot tell an empty lobby from a dead one, and
	/// that is the question that decides whether they bother creating a table.
	///
	/// The counts are ABSENT, not zero, when the host has not turned them on: a deployment that
	/// keeps quiet must not be readable as one with nobody in it. Nothing here identifies anybody —
	/// two integers over the whole process, no games, no names, no seats.
	/// </summary>
	[HttpGet("metrics")]
	public ActionResult<object> GetMetrics()
		=> _metrics.ShowActivity && _sessions is not null
			? new
			{
				ActiveTables = (int?)_sessions.CountActiveTables(),
				ConnectedPlayers = (int?)_sessions.CountConnectedPlayers(),
			}
			: new { ActiveTables = (int?)null, ConnectedPlayers = (int?)null };

	/// <summary>
	/// Which build of Corro this is: the date-and-ordinal stamp, when it went live, and where the
	/// commit behind it can be read.
	///
	/// Corro ships continuously, so the useful question is not "which version" but "when was this
	/// last updated" — which is what the stamp answers. A build that was never stamped (a clone run
	/// from source, a developer's own server) reports nothing and the lobby shows no version,
	/// because a made-up number would be worse than none.
	///
	/// The deployment time travels as a UTC instant rather than as a sentence: the client formats
	/// it in the reader's own language and time zone.
	/// </summary>
	[HttpGet("version")]
	public ActionResult<object> GetVersion()
		=> _build.IsConfigured
			? (object)new
			{
				Configured = true,
				_build.Version,
				_build.Commit,
				_build.CommitUrl,
				_build.DeployedAt,
			}
			: new { Configured = false };

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
