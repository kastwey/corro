using System.Text.Json;

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
		new ForbiddenFamily(),
		new CategoriesFamily(),
		new BluffFamily(),
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

	/// <summary>
	/// The number of teams a family requires UNDER the host's chosen house rules: its
	/// <see cref="IGameFamily.RequiredTeamCount"/>, unless the choice named by
	/// <see cref="IGameFamily.TeamsWaivedWhen"/> is selected, in which case none. Every place the
	/// lobby checks a table's shape (creation, a rule change while waiting, the start) asks this,
	/// so a family's team requirement and its waiver are read the same way everywhere.
	/// </summary>
	public static int? RequiredTeamsUnder(this IGameFamily family, IReadOnlyDictionary<string, JsonElement>? ruleValues)
		=> family.TeamsWaivedWhen is { } waiver && waiver.Holds(ruleValues)
			? null
			: family.RequiredTeamCount;
}
