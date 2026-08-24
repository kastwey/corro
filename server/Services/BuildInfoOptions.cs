using System.Text.RegularExpressions;

namespace CorroServer.Services;

/// <summary>
/// Which build of Corro this is, so a player can say WHEN the thing in front of them changed.
///
/// Corro ships continuously — there is no release train — so a semantic version would be a number
/// nobody could interpret. The stamp is a date and the ordinal of that day's update
/// (<c>20260823-001</c>), written by <c>tools/build-version.ps1</c> at publish time into a
/// <c>buildinfo.json</c> next to the application.
///
/// Absent, the deployment shows NO version at all: a clone somebody is running from source has
/// nothing true to say here, and inventing "development" would be a version number that means
/// "unknown". The same rule covers a stamp that arrives malformed — the lobby stays quiet rather
/// than showing whatever a mis-scripted build wrote.
/// </summary>
public sealed class BuildInfoOptions
{
	public const string SectionName = "Build";

	/// <summary>The UTC day of the commit and its ordinal within that day: <c>20260823-001</c>.
	/// A day that somehow needs a fourth digit grows rather than repeating a stamp.</summary>
	public string? Version { get; init; }

	/// <summary>The commit this was built from, in full. Optional: without it (or without a
	/// repository) the dialog states the version and offers no link.</summary>
	public string? Commit { get; init; }

	/// <summary>Where that commit can be read, as an https URL — <c>https://github.com/owner/repo</c>.
	/// Anything else is ignored: the link is opened in the player's browser.</summary>
	public string? RepositoryUrl { get; init; }

	/// <summary>When this build went live, as a UTC instant. The client formats it in the reader's
	/// own language and time zone, so it travels as machine text and never as a sentence.</summary>
	public string? DeployedAt { get; init; }

	private static readonly Regex VersionPattern = new(@"^\d{8}-\d{3,}$", RegexOptions.Compiled);
	private static readonly Regex CommitPattern = new("^[0-9a-fA-F]{7,40}$", RegexOptions.Compiled);

	/// <summary>Whether there is a version worth showing. Only the stamp itself decides: the commit,
	/// the repository and the date are extras that each drop out on their own if they are unusable.</summary>
	public bool IsConfigured => Version is not null && VersionPattern.IsMatch(Version);

	/// <summary>The address of the commit this was built from, or null when this deployment cannot
	/// point at one. Composed here rather than in the browser so a repository URL that is not a
	/// plain https address never reaches a link at all.</summary>
	public string? CommitUrl
		=> Commit is not null
			&& CommitPattern.IsMatch(Commit)
			&& Uri.TryCreate(RepositoryUrl?.TrimEnd('/'), UriKind.Absolute, out var repository)
			&& repository.Scheme == Uri.UriSchemeHttps
				? $"{repository.AbsoluteUri.TrimEnd('/')}/commit/{Commit}"
				: null;
}
