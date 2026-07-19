using CorroServer.Models.Corro;

namespace CorroServer.Services.Corro.Validation;

/// <summary>
/// Validates a loaded package's CONTENT (beyond the structural checks the loader already does) and
/// reports every problem found. Behind an interface so callers (the upload endpoint, a shipped-board
/// guard test, a future admin tool) depend on the abstraction rather than a concrete rule, and so new
/// rules can be added without touching those callers. Returns problems instead of throwing, so each
/// caller decides how to react (a 400, a failing test, a warning log).
/// </summary>
public interface IPackageValidator
{
	/// <summary>All validation problems for <paramref name="definition"/>; empty when it is valid.</summary>
	IReadOnlyList<string> Validate(GameDefinition definition);
}
