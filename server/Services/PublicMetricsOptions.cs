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
	/// Show how many tables currently have somebody in them. "In them" means a live connection,
	/// so a table whose players all dropped out stops counting the moment they do — it is a
	/// measure of people present, not of rows sitting in a database.
	/// </summary>
	public bool ShowActiveTables { get; init; }
}
