using CorroServer.Controllers;
using CorroServer.Services;
using Microsoft.Extensions.Options;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Which build the lobby says it is running.
///
/// Corro ships continuously, so the stamp is a date and that day's ordinal rather than a semantic
/// version. Two properties matter more than the string itself: a build that was never stamped says
/// NOTHING (a clone run from source has no honest answer, and "development" would be a version
/// number meaning "unknown"), and the commit link is only ever an https address — it is opened in
/// the player's browser, so a remote nobody can open must not reach a link.
/// </summary>
public class BuildInfoTests
{
	private static ConfigController Controller(BuildInfoOptions build)
		=> new(
			Options.Create(new SiteBrandingOptions { Title = "All Welcome" }),
			build: Options.Create(build));

	private static (bool Configured, string? Version, string? Commit, string? CommitUrl, string? DeployedAt)
		Reported(ConfigController controller)
	{
		var value = controller.GetVersion().Value!;
		var type = value.GetType();
		string? text(string name) => (string?)type.GetProperty(name)?.GetValue(value);
		return (
			(bool)type.GetProperty("Configured")!.GetValue(value)!,
			text("Version"), text("Commit"), text("CommitUrl"), text("DeployedAt"));
	}

	private static BuildInfoOptions Stamped(string version = "20260823-001") => new()
	{
		Version = version,
		Commit = "0123456789abcdef0123456789abcdef01234567",
		RepositoryUrl = "https://github.com/kastwey/corro",
		DeployedAt = "2026-08-23T14:32:10Z",
	};

	[Fact]
	public void A_stamped_build_reports_the_stamp_the_release_was_given()
	{
		Assert.Equal(
			(true,
				"20260823-001",
				"0123456789abcdef0123456789abcdef01234567",
				"https://github.com/kastwey/corro/commit/0123456789abcdef0123456789abcdef01234567",
				"2026-08-23T14:32:10Z"),
			Reported(Controller(Stamped())));
	}

	// A clone somebody is running from source: no stamp was ever written, so there is no version.
	[Fact]
	public void An_unstamped_build_says_nothing_rather_than_inventing_a_number()
	{
		Assert.False(Reported(Controller(new BuildInfoOptions())).Configured);
		Assert.False(new BuildInfoOptions().IsConfigured);

		// And a controller nobody handed the options to behaves the same way.
		var bare = new ConfigController(Options.Create(new SiteBrandingOptions { Title = "All Welcome" }));
		Assert.False(Reported(bare).Configured);
	}

	// The shape is the promise. Anything else is a mis-scripted build, and showing whatever it
	// wrote would be showing the reader a number that is not a version.
	[Theory]
	[InlineData("")]
	[InlineData("1.0.0")]
	[InlineData("20260823")]
	[InlineData("20260823-1")]
	[InlineData("2026-08-23-001")]
	[InlineData("main")]
	public void A_stamp_that_is_not_a_date_and_an_ordinal_is_not_shown(string version)
		=> Assert.False(Reported(Controller(Stamped(version))).Configured);

	// A day that needs more than 999 updates grows a digit rather than repeating a stamp.
	[Fact]
	public void A_very_busy_day_keeps_counting()
		=> Assert.Equal("20260823-1042", Reported(Controller(Stamped("20260823-1042"))).Version);

	[Theory]
	// Not something a browser can open, so no link is offered — the version still is.
	[InlineData("git@github.com:kastwey/corro.git", "0123456789abcdef0123456789abcdef01234567")]
	[InlineData("http://github.com/kastwey/corro", "0123456789abcdef0123456789abcdef01234567")]
	[InlineData("ssh://git@github.com/kastwey/corro", "0123456789abcdef0123456789abcdef01234567")]
	[InlineData("javascript:alert(1)", "0123456789abcdef0123456789abcdef01234567")]
	[InlineData("", "0123456789abcdef0123456789abcdef01234567")]
	// Nothing that could be a commit hash either.
	[InlineData("https://github.com/kastwey/corro", "")]
	[InlineData("https://github.com/kastwey/corro", "not-a-hash")]
	[InlineData("https://github.com/kastwey/corro", "abc")]
	public void A_commit_nobody_could_open_is_offered_as_no_link_at_all(string repository, string commit)
	{
		var reported = Reported(Controller(new BuildInfoOptions
		{
			Version = "20260823-001",
			Commit = commit,
			RepositoryUrl = repository,
		}));

		Assert.True(reported.Configured);
		Assert.Equal("20260823-001", reported.Version);
		Assert.Null(reported.CommitUrl);
	}

	// A host who wrote their repository with a trailing slash still gets one slash in the link.
	[Fact]
	public void The_commit_link_is_built_from_the_repository_however_it_was_written()
		=> Assert.Equal(
			"https://github.com/kastwey/corro/commit/0123456789abcdef0123456789abcdef01234567",
			new BuildInfoOptions
			{
				Version = "20260823-001",
				Commit = "0123456789abcdef0123456789abcdef01234567",
				RepositoryUrl = "https://github.com/kastwey/corro/",
			}.CommitUrl);

	// A short hash is a real way to record a commit, and GitHub resolves it.
	[Fact]
	public void A_short_commit_hash_is_still_a_commit()
		=> Assert.Equal(
			"https://github.com/kastwey/corro/commit/0123456",
			new BuildInfoOptions
			{
				Version = "20260823-001",
				Commit = "0123456",
				RepositoryUrl = "https://github.com/kastwey/corro",
			}.CommitUrl);
}
