using System.Text.Json;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Corro;

/// <summary>A shipped package the lobby can offer: its id and its localized display name.</summary>
public sealed record ShippedPackageSummary
{
	public string Id { get; init; } = string.Empty;
	public Dictionary<string, string> Name { get; init; } = new();
}

/// <summary>
/// Discovers the approved board packages shipped with the server (server/Packages/, copied to the
/// build output). These are the engine's built-in boards expressed as packages — there is no separate
/// board infra. The lobby lists them and stages the chosen one through the same path as an upload.
///
/// Hidden packages — a self-hosting feature. A package may declare an "unlockCode" in its manifest.
/// When it does, this provider keeps it out of the public board list: it can't be listed or staged for
/// a NEW game until a player presents the matching code (accumulated in their browser and replayed).
/// One code reveals every hidden package that shares it. The listing/staging path (<see cref="List"/>,
/// <see cref="CanAccess"/>) enforces the gate; <see cref="ResolveDir"/> is deliberately NOT gated, so
/// the restore path (re-staging a board an existing game already uses) always works — a player who
/// joins a game with a hidden board plays it without ever needing the code.
///
/// This is a soft gate, not access control: anyone given the code — or who joins a game that already
/// uses the board — gets the board. That is by design.
/// </summary>
public sealed class ShippedPackageProvider
{
	private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
	private static readonly IReadOnlySet<string> NoCodes = new HashSet<string>();

	private readonly IReadOnlyList<string> _dirs;

	public ShippedPackageProvider(string? packagesDir = null, IEnumerable<string>? additionalPackagesDirs = null)
	{
		var primary = packagesDir ?? Path.Combine(AppContext.BaseDirectory, "Packages");
		_dirs = new[] { primary }
			.Concat(additionalPackagesDirs ?? Array.Empty<string>())
			.Where(path => !string.IsNullOrWhiteSpace(path))
			.Select(Path.GetFullPath)
			.Distinct(StringComparer.OrdinalIgnoreCase)
			.ToList();
	}

	/// <summary>The PUBLIC shipped packages (those without an unlock code), id + display name.</summary>
	public IReadOnlyList<ShippedPackageSummary> List() => List(NoCodes);

	/// <summary>
	/// The shipped packages visible to a player holding <paramref name="unlockedCodes"/> (already
	/// normalized): every public package, plus each hidden one whose unlock code is in that set.
	/// </summary>
	public IReadOnlyList<ShippedPackageSummary> List(IReadOnlySet<string> unlockedCodes)
		=> Discover().Where(p => IsVisible(p.UnlockCode, unlockedCodes))
			.Select(p => new ShippedPackageSummary { Id = p.Id, Name = p.Name })
			.OrderBy(p => p.Id, StringComparer.Ordinal).ToList();

	/// <summary>
	/// Whether a NEW game may be staged from shipped package <paramref name="id"/> given the codes the
	/// caller holds: true for a public package, or a hidden one whose code is unlocked; false for a
	/// locked hidden package OR an unknown id. Gates <c>StageShipped</c>; the restore path bypasses it.
	/// </summary>
	public bool CanAccess(string id, IReadOnlySet<string> unlockedCodes)
	{
		var package = Find(id);
		return package is not null && IsVisible(package.UnlockCode, unlockedCodes);
	}

	/// <summary>
	/// The on-disk folder for a shipped package <paramref name="id"/>, or null if there is no such
	/// approved package. Matched by the manifest id discovered on disk (never by treating the id as a
	/// raw path segment), so it can't be turned into a path-traversal and is independent of folder naming.
	/// </summary>
	public string? ResolveDir(string id)
		=> Find(id)?.Dir;

	/// <summary>
	/// Whether a package with unlock code <paramref name="unlockCode"/> is visible given the codes the
	/// caller holds: public (no code) is always visible; a hidden one only if its normalized code is in
	/// <paramref name="unlockedCodes"/> (which the caller has already normalized the same way).
	/// </summary>
	private static bool IsVisible(string? unlockCode, IReadOnlySet<string> unlockedCodes)
		=> string.IsNullOrWhiteSpace(unlockCode) || unlockedCodes.Contains(Normalize(unlockCode));

	/// <summary>Canonical form of an unlock code so entry is forgiving (trimmed, case-insensitive).</summary>
	public static string Normalize(string code) => code.Trim().ToLowerInvariant();

	/// <summary>Scan the configured package roots: each subfolder with a valid manifest becomes one
	/// package. The primary shipped root wins a duplicate id, so an E2E fixture can never shadow a
	/// real game accidentally.</summary>
	private DiscoveredPackage? Find(string id)
		=> Discover().FirstOrDefault(package => package.Id == id);

	private IEnumerable<DiscoveredPackage> Discover()
	{
		var seenIds = new HashSet<string>(StringComparer.Ordinal);
		foreach (var root in _dirs)
		{
			if (!Directory.Exists(root))
			{
				continue;
			}

			foreach (var sub in Directory.GetDirectories(root))
			{
				var manifestPath = Path.Combine(sub, "manifest.json");
				if (!File.Exists(manifestPath))
				{
					continue;
				}

				ManifestHead? m = null;
				try { m = JsonSerializer.Deserialize<ManifestHead>(File.ReadAllText(manifestPath), JsonOptions); }
				catch { /* A malformed manifest just hides that package; it never breaks the lobby. */ }

				if (m is { Id.Length: > 0 } && seenIds.Add(m.Id))
				{
					yield return new DiscoveredPackage(
						m.Id,
						m.Name ?? new(),
						sub,
						m.UnlockCode);
				}
			}
		}
	}

	/// <summary>Minimal manifest shape for listing (id + name + the optional hidden-package unlock code).</summary>
	private sealed record ManifestHead
	{
		public string Id { get; init; } = string.Empty;
		public Dictionary<string, string>? Name { get; init; }
		/// <summary>The hidden-package gate code; null/absent means the package is public.</summary>
		public string? UnlockCode { get; init; }
	}

	private sealed record DiscoveredPackage(
		string Id,
		Dictionary<string, string> Name,
		string Dir,
		string? UnlockCode);
}
