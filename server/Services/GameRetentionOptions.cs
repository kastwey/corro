namespace CorroServer.Services;

/// <summary>Configures automatic removal of abandoned persisted games and uploaded packages.</summary>
public sealed class GameRetentionOptions
{
	public const string SectionName = "GameRetention";

	/// <summary>Whether the production persistence cleanup worker runs.</summary>
	public bool Enabled { get; init; } = true;

	/// <summary>A game is eligible only after this many complete days without a persisted update.</summary>
	public int InactivityDays { get; init; } = 30;

	/// <summary>UTC hour (0-23) for the daily sweep.</summary>
	public int RunAtUtcHour { get; init; } = 3;

	/// <summary>Catch up after a restart instead of waiting until the next scheduled hour.</summary>
	public bool RunOnStartup { get; init; } = true;

	/// <summary>Safety cap on game deletions attempted in one run.</summary>
	public int MaxGamesPerRun { get; init; } = 500;
}
