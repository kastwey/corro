namespace Corro.PackageSdk;

/// <summary>Author-supplied identity for a neutral starter package.</summary>
public sealed record PackageTemplateOptions
{
	public string? Id { get; init; }
	public string? NameEn { get; init; }
	public string? NameEs { get; init; }
	public string? Author { get; init; }
}

/// <summary>A starter package created and validated successfully.</summary>
public sealed record PackageTemplateResult
{
	public required string Path { get; init; }
	public required string Family { get; init; }
	public required string Id { get; init; }
	public required IReadOnlyDictionary<string, string> Names { get; init; }
	public required PackageValidationResult Validation { get; init; }
}

/// <summary>The interaction models for which this SDK ships neutral starter packages.</summary>
public static class PackageTemplateCatalog
{
	public static IReadOnlyList<string> SupportedFamilies { get; } = new[]
	{
		"property",
		"race",
		"track",
		"journey",
		"assembly",
		"draft",
		"shedding",
		"exploding",
		"trivia",
	};

	public static bool IsSupported(string? family)
		=> SupportedFamilies.Contains(family, StringComparer.OrdinalIgnoreCase);
}
