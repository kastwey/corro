namespace CorroServer.Services.Corro.Families;

/// <summary>
/// The engine's player-colour palette, assigned in join order by families whose board has no
/// seat colours of its own (track pieces, journey cars). The client mirrors these hexes to
/// spoken colour WORDS ("your colour is #1e88e5" would be meaningless aloud), so a new entry
/// here needs its word on the client too.
/// </summary>
public static class EnginePalette
{
	private static readonly string[] Colors =
		{ "#e53935", "#1e88e5", "#fdd835", "#43a047", "#8e24aa", "#fb8c00", "#00acc1", "#6d4c41" };

	/// <summary>Colour IDS aligned with <see cref="Colors"/>: the client localizes them into
	/// the spoken colour word (game.color_*) — team names ("Equipo Rojo") are built from these.</summary>
	private static readonly string[] Names =
		{ "red", "blue", "yellow", "green", "purple", "orange", "cyan", "brown" };

	public static string ColorFor(int index) => Colors[index % Colors.Length];

	public static string NameFor(int index) => Names[index % Names.Length];
}
