namespace CorroServer.Services.Voice;

/// <summary>
/// Private deployment configuration for the optional LiveKit voice relay. Only
/// <see cref="IsConfigured"/> is exposed publicly; credentials never leave the server.
/// </summary>
public sealed class LiveKitOptions
{
	public const string SectionName = "LiveKit";

	/// <summary>Browser endpoint, normally <c>wss://voice.example.org</c>.</summary>
	public string? Url { get; init; }

	/// <summary>Optional HTTP endpoint for Room Service. When omitted it is derived from
	/// <see cref="Url"/> by mapping wss→https and ws→http.</summary>
	public string? ApiUrl { get; init; }

	public string? ApiKey { get; init; }
	public string? ApiSecret { get; init; }

	/// <summary>Short-lived because self-hosted LiveKit does not revoke old tokens.</summary>
	public int TokenLifetimeMinutes { get; init; } = 5;

	public bool IsEmpty => string.IsNullOrWhiteSpace(Url)
		&& string.IsNullOrWhiteSpace(ApiUrl)
		&& string.IsNullOrWhiteSpace(ApiKey)
		&& string.IsNullOrWhiteSpace(ApiSecret);

	public bool IsConfigured => IsSupportedBrowserUrl(Url)
		&& IsSupportedApiUrl(EffectiveApiUrl)
		&& !string.IsNullOrWhiteSpace(ApiKey)
		&& !string.IsNullOrWhiteSpace(ApiSecret);

	public string? EffectiveApiUrl
	{
		get
		{
			if (!string.IsNullOrWhiteSpace(ApiUrl))
			{
				return ApiUrl.TrimEnd('/');
			}
			if (!Uri.TryCreate(Url, UriKind.Absolute, out var uri))
			{
				return null;
			}
			var builder = new UriBuilder(uri)
			{
				Scheme = uri.Scheme.Equals("wss", StringComparison.OrdinalIgnoreCase) ? "https" : "http",
				Port = uri.IsDefaultPort ? -1 : uri.Port,
			};
			return builder.Uri.ToString().TrimEnd('/');
		}
	}

	public static bool IsSupportedBrowserUrl(string? value)
	{
		if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
		{
			return false;
		}
		if (uri.Scheme.Equals("wss", StringComparison.OrdinalIgnoreCase))
		{
			return true;
		}
		return uri.Scheme.Equals("ws", StringComparison.OrdinalIgnoreCase) && uri.IsLoopback;
	}

	public static bool IsSupportedApiUrl(string? value)
	{
		if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
		{
			return false;
		}
		if (uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase))
		{
			return true;
		}
		return uri.Scheme.Equals("http", StringComparison.OrdinalIgnoreCase) && uri.IsLoopback;
	}
}