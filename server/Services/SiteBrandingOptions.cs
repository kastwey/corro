namespace CorroServer.Services;

/// <summary>Public, deployment-owned identity shown around the Corro game engine.</summary>
public sealed class SiteBrandingOptions
{
	public const string SectionName = "SiteBranding";
	public const int MaxTitleLength = 80;
	public const int MaxTaglineLength = 160;
	public const int MaxAssetUrlLength = 2048;

	/// <summary>The host's name, used by page headings and browser titles.</summary>
	public string Title { get; init; } = "All Welcome";

	/// <summary>An optional sentence shown below the lobby heading.</summary>
	public string? Tagline { get; init; } = "Play together, play your way.";

	/// <summary>An optional same-site path or HTTPS URL for the lobby logo.</summary>
	public string? LogoUrl { get; init; }

	/// <summary>An optional dark-theme logo; <see cref="LogoUrl"/> is reused when omitted.</summary>
	public string? LogoDarkUrl { get; init; }

	/// <summary>An optional same-site path or HTTPS URL for the browser icon.</summary>
	public string? FaviconUrl { get; init; }

	/// <summary>An optional dark-theme browser icon; <see cref="FaviconUrl"/> is reused when omitted.</summary>
	public string? FaviconDarkUrl { get; init; }

	/// <summary>
	/// Asset URLs come from the trusted deployment configuration, but restricting absolute URLs to
	/// HTTPS prevents an accidental mixed-content deployment. Relative paths remain available for
	/// assets shipped with a self-hosted build.
	/// </summary>
	public static bool IsSupportedAssetUrl(string? value)
	{
		if (string.IsNullOrWhiteSpace(value))
		{
			return true;
		}
		if (value != value.Trim())
		{
			return false;
		}
		if (value.Length > MaxAssetUrlLength || value.Contains('\\') || value.StartsWith("//", StringComparison.Ordinal))
		{
			return false;
		}

		// Classify an explicit URI scheme before asking System.Uri to parse the value. On Unix,
		// System.Uri treats an origin-relative web path such as "/assets/logo.svg" as an absolute
		// file URI, while Windows treats the same text as relative. Web asset configuration must
		// have identical semantics on both hosts.
		var colon = value.IndexOf(':');
		var hasExplicitScheme = colon > 0 && Uri.CheckSchemeName(value[..colon]);
		if (hasExplicitScheme)
		{
			return Uri.TryCreate(value, UriKind.Absolute, out var absolute)
				&& absolute.Scheme == Uri.UriSchemeHttps;
		}

		return Uri.TryCreate(value, UriKind.Relative, out _);
	}
}