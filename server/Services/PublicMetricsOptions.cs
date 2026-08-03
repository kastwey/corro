namespace CorroServer.Services;

/// <summary>
/// What this deployment is willing to say about itself in public.
///
/// A visitor arriving at an empty-looking lobby has no way to tell whether the place is dead or
/// whether they are simply early, and "is anyone else here?" is the question that decides whether
/// they bother creating a table. A count answers it.
///
/// It is off by default and every host decides for themselves, because the honest answer is not
/// always the useful one: a private server for one family gains nothing from advertising that two
/// tables are up, and a brand-new deployment does not want its first visitor greeted with a zero.
///
/// Nothing here identifies anybody. The count is a single integer over the whole process — not who
/// is playing, not what they are playing, not where they are.
/// </summary>
public sealed class PublicMetricsOptions
{
	public const string SectionName = "PublicMetrics";

	/// <summary>
	/// Show how busy this deployment is: how many tables have somebody at them, and how many
	/// people are connected. Both or neither, because they are one sentence and one decision — a
	/// host either publishes their activity or they do not, and the three other combinations are
	/// settings nobody asked for.
	///
	/// "Present" means a live connection throughout: a table whose players all dropped out stops
	/// counting the moment they do, and so do they. It measures people, not rows in a database.
	/// </summary>
	public bool ShowActivity { get; init; }
}
