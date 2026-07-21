using CorroServer.Models;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using Microsoft.AspNetCore.Mvc;

namespace CorroServer.Controllers;

/// <summary>
/// Public endpoint for user-uploaded .corro boards (no accounts, so packages are transient).
/// The lobby uploads a package here in step 1; the response carries the board name and its rule
/// defaults for step 2, plus a token the lobby passes when creating the game. The staged package
/// (extracted folder + sound pack) is released when its game ends.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class PackagesController : ControllerBase
{
	private readonly CorroPackageStore _store;
	private readonly ShippedPackageProvider _shipped;
	private readonly IPackageBlobStore _blob;
	private readonly IPackageValidator _validator;
	private readonly ILogger<PackagesController>? _logger;

	public PackagesController(
		CorroPackageStore store,
		ShippedPackageProvider shipped,
		IPackageBlobStore blob,
		IPackageValidator validator,
		ILogger<PackagesController>? logger = null)
	{
		_store = store;
		_shipped = shipped;
		_blob = blob;
		_validator = validator;
		_logger = logger;
	}

	/// <summary>
	/// Upload a .corro package (zip) and stage it, returning a summary for the lobby. An upload is
	/// untrusted, so by default the staged board is content-validated (<see cref="IPackageValidator"/>)
	/// and rejected if it references an i18n key that resolves in no locale — pass validate=false to
	/// skip that (a trusted/draft upload; the board may then show raw keys).
	/// </summary>
	[HttpPost]
	[RequestSizeLimit(CorroPackageLoader.MaxUploadBytes)]
	public async Task<ActionResult<PackageUploadResponse>> Upload(IFormFile package, [FromQuery] bool validate = true)
	{
		if (package is null || package.Length == 0)
		{
			return BadRequest("No package uploaded.");
		}

		if (package.Length > CorroPackageLoader.MaxUploadBytes)
		{
			return BadRequest("Package is too large.");
		}

		var token = Guid.NewGuid().ToString("N");
		try
		{
			// Buffer once so we can both stage (extract+validate) and persist the same bytes durably.
			using var buffer = new MemoryStream();
			await package.CopyToAsync(buffer);

			buffer.Position = 0;
			var definition = await _store.StageAsync(token, buffer);

			// Content validation happens at this untrusted boundary (delegated to the validator service,
			// not inline rules): reject a board with problems before we persist it.
			if (validate && _validator.Validate(definition) is { Count: > 0 } problems)
			{
				_store.Release(token);
				return BadRequest("Invalid .corro package: " + string.Join("; ", problems));
			}

			// Persist the archive so the game can be restored after a restart, and record that this
			// staged token is an upload (re-staged from its blob, keyed by the token).
			buffer.Position = 0;
			await _blob.PutAsync(token, buffer);
			_store.SetOrigin(token, new PackageOrigin { BlobKey = token });

			return Ok(Summarize(token, definition));
		}
		catch (Exception ex)
		{
			// Any failure to read/validate a user-uploaded package is a bad request, not a 500.
			_store.Release(token); // discard a partial / invalid extraction
			_logger?.LogWarning(ex, "Rejected invalid uploaded package {PackageToken}", token);
			return BadRequest("Invalid .corro package.");
		}
	}

	/// <summary>
	/// The name of the request header carrying a player's unlock codes (comma-separated). The client
	/// stores the codes it has entered locally and replays them here so hidden boards it has unlocked
	/// stay visible; the server treats them as a filter, holding no per-player state of its own.
	/// </summary>
	private const string UnlockHeader = "X-Corro-Unlock";

	/// <summary>The approved boards shipped with the server (the lobby's board list) that the caller may
	/// see: the public ones, plus any hidden board unlocked by the codes in the request header.</summary>
	[HttpGet("shipped")]
	public ActionResult<IEnumerable<ShippedPackageSummary>> ListShipped()
		=> Ok(_shipped.List(UnlockCodes()));

	/// <summary>
	/// Stage a shipped board by id and return the same summary an upload does (a token + rules +
	/// tokens), so the lobby drives a built-in board through the exact same path as an uploaded one.
	/// </summary>
	[HttpPost("shipped/{id}")]
	public async Task<ActionResult<PackageUploadResponse>> StageShipped(string id)
	{
		// A hidden board can't be staged for a NEW game without a matching unlock code (a self-hosting
		// gate). 404, not 403: a locked board is indistinguishable from one that doesn't exist. The
		// restore path (re-staging a board an existing game already uses) goes straight through
		// ResolveDir and is never gated — joiners never need the code.
		if (!_shipped.CanAccess(id, UnlockCodes()))
		{
			return NotFound();
		}

		var sourceDir = _shipped.ResolveDir(id);
		if (sourceDir is null)
		{
			return NotFound();
		}

		var token = Guid.NewGuid().ToString("N");
		try
		{
			var definition = await _store.StageFromDirectoryAsync(token, sourceDir);
			_store.SetOrigin(token, new PackageOrigin { ShippedId = definition.Manifest.Id });
			return Ok(Summarize(token, definition));
		}
		catch (Exception ex)
		{
			_store.Release(token);
			_logger?.LogError(ex, "Failed to stage shipped package {PackageId}", id);
			return BadRequest("Invalid shipped package.");
		}
	}

	/// <summary>
	/// The unlock codes the caller presented in the request header, normalized the same way the manifest
	/// codes are (trimmed, lower-cased) so the comparison is forgiving. Empty when the header is absent —
	/// including in unit tests with no HttpContext, where only public boards are then visible.
	/// </summary>
	private IReadOnlySet<string> UnlockCodes()
	{
		var header = HttpContext?.Request.Headers[UnlockHeader].ToString();
		if (string.IsNullOrWhiteSpace(header))
		{
			return new HashSet<string>();
		}

		return header.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
			.Select(ShippedPackageProvider.Normalize)
			.ToHashSet();
	}

	private static PackageUploadResponse Summarize(string token, CorroServer.Models.Corro.GameDefinition definition)
		=> new()
		{
			Token = token,
			GameType = string.IsNullOrWhiteSpace(definition.Manifest.GameType) ? "property" : definition.Manifest.GameType,
			Name = new Dictionary<string, string>(definition.Manifest.Name),
			Settings = GameDefinitionAdapter.ToSettings(definition),
			RuleGroups = definition.Manifest.RuleGroups,
			HouseRules = definition.Manifest.HouseRules,
			Tokens = definition.Manifest.Tokens,
			MinPlayers = definition.Manifest.Players.Min,
			MaxPlayers = definition.Manifest.Players.Max,
			Seats = definition.RaceBoard?.Seats
				.Select(s => new LobbySeatInfo { Id = s.Id, Color = s.Color, NameKey = s.NameKey })
				.ToList() ?? new(),
			// The board's create-time notice key (if any). NOT the unlock code — that never leaves the server.
			Warning = definition.Manifest.Warning,
		};

	/// <summary>
	/// Serves a staged package's own translation file (<c>i18n/{lang}.json</c>) so the client can
	/// merge its keys over the app's at game start. 404 when the package has no such file.
	/// </summary>
	[HttpGet("{token}/i18n/{lang}")]
	public IActionResult GetI18n(string token, string lang)
	{
		var json = _store.ReadI18n(token, lang);
		return json is null ? NotFound() : Content(json, "application/json");
	}

	/// <summary>
	/// Serves a staged package's help document (<c>help.{lang}.md</c>) — the board's rules and how to
	/// play — so the client can render it in-game (F1 / the Help button). 404 when the package ships none.
	/// </summary>
	[HttpGet("{token}/help/{lang}")]
	public IActionResult GetHelp(string token, string lang)
	{
		var md = _store.ReadHelp(token, lang);
		return md is null ? NotFound() : Content(md, "text/markdown; charset=utf-8");
	}
}
