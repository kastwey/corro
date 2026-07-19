namespace CorroServer.Services.Corro.Families;

/// <summary>
/// The game families this engine implements, in the order they are announced to package
/// authors. Every family dispatch (load, validate, start, restore, roll) goes through
/// <see cref="For"/>, so a new family only registers here.
/// </summary>
public static class GameFamilies
{
	private static readonly IGameFamily[] All =
	{
		new PropertyFamily(),
		new RaceFamily(),
		new TrackFamily(),
		new JourneyFamily(),
		new AssemblyFamily(),
		new DraftFamily(),
		new SheddingFamily(),
		new ExplodingFamily(),
		new TriviaFamily(),
	};

	private static readonly Dictionary<string, IGameFamily> ByType =
		All.ToDictionary(f => f.GameType, StringComparer.OrdinalIgnoreCase);

	/// <summary>Family names for "supported: …" messages, in registration order.</summary>
	public static IReadOnlyList<string> SupportedTypes { get; } = All.Select(f => f.GameType).ToList();

	/// <summary>True when a manifest gameType names a family this engine implements.</summary>
	public static bool IsSupported(string gameType) => ByType.ContainsKey(gameType);

	/// <summary>
	/// The family for a manifest/state gameType. A missing or unknown type falls back to
	/// "property" (the loader's historical default); the package content validator still
	/// reports the unsupported type, with a clearer message than a board-shape error.
	/// </summary>
	public static IGameFamily For(string? gameType)
		=> !string.IsNullOrWhiteSpace(gameType) && ByType.TryGetValue(gameType, out var family)
			? family
			: ByType["property"];
}
