namespace Corro.PackageSdk;

/// <summary>The result of running the engine's structural, family and content validation.</summary>
public sealed record PackageValidationResult
{
	public required string InputPath { get; init; }
	public bool IsValid => Problems.Count == 0;
	public PackageSummary? Package { get; init; }
	public required IReadOnlyList<string> Problems { get; init; }
}

/// <summary>The result of validating and atomically packing a package folder.</summary>
public sealed record PackagePackResult
{
	public required PackageValidationResult Validation { get; init; }
	public bool Succeeded { get; init; }
	public string? OutputPath { get; init; }
	public long Bytes { get; init; }
	public string? Sha256 { get; init; }
}
