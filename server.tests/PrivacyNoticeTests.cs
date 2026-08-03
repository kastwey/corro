using CorroServer.Controllers;
using CorroServer.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The notice a configured deployment actually serves.
///
/// <see cref="PrivacyOptionsTests"/> pins WHO must be named; these pin that the naming reaches the
/// reader. The controller answers "no notice" for four different reasons — nobody configured one,
/// the host points elsewhere, the language is unknown, the text is missing — and only the first two
/// are supposed to happen. The third and fourth would leave a deployment that has filled in its
/// details silently offering no notice to the people whose data it processes.
///
/// This is why these read the REAL markdown out of server/Legal rather than a fixture: the files
/// are the deliverable, and a test that ships its own copy of them would pass with the folder empty.
/// </summary>
public class PrivacyNoticeTests
{
	private static readonly PrivacyOptions Configured = new()
	{
		ControllerName = "Juan José Montiel Pérez",
		Jurisdiction = "Dublín, Irlanda",
		Contact = "juanjo@example.test",
	};

	private static ConfigController Controller(PrivacyOptions privacy) =>
		new(
			Options.Create(new SiteBrandingOptions()),
			Options.Create(privacy),
			new ContentRootOnlyEnvironment(CorroTestPaths.ContentRoot()));

	/// <summary>The anonymous object the controller returns, read by property name.</summary>
	private static object? Field(object? body, string name) =>
		body?.GetType().GetProperty(name)?.GetValue(body);

	private static async Task<object?> NoticeAsync(string language, PrivacyOptions? privacy = null) =>
		(await Controller(privacy ?? Configured).GetPrivacy(language)).Value;

	[Theory]
	[InlineData("en")]
	[InlineData("es")]
	public async Task A_configured_deployment_serves_its_notice_in_both_languages(string language)
	{
		var notice = await NoticeAsync(language);

		Assert.Equal(true, Field(notice, "configured"));
		var markdown = Assert.IsType<string>(Field(notice, "markdown"));
		Assert.False(string.IsNullOrWhiteSpace(markdown), "a configured deployment must have text to show");
	}

	[Theory]
	[InlineData("en")]
	[InlineData("es")]
	public async Task The_controllers_own_details_are_substituted_into_the_text(string language)
	{
		// The whole point of the notice: the reader learns who holds their data and how to reach them.
		var markdown = (string)Field(await NoticeAsync(language), "markdown")!;

		Assert.Contains("Juan José Montiel Pérez", markdown);
		Assert.Contains("Dublín, Irlanda", markdown);
		Assert.Contains("juanjo@example.test", markdown);
	}

	[Theory]
	[InlineData("en")]
	[InlineData("es")]
	public async Task No_placeholder_survives_into_what_the_reader_sees(string language)
	{
		// A stray {{contact}} is a notice that names nobody while looking like it does. Catches a
		// placeholder added to the markdown that the substitution list was never told about.
		var markdown = (string)Field(await NoticeAsync(language), "markdown")!;

		Assert.DoesNotContain("{{", markdown);
	}

	[Theory]
	[InlineData("en")]
	[InlineData("es")]
	public async Task The_notice_names_every_cookie_Corro_sets(string language)
	{
		// The original notice said there were two and omitted the year-long language cookie entirely.
		var markdown = (string)Field(await NoticeAsync(language), "markdown")!;

		Assert.Contains("corro_language", markdown);
		Assert.Contains("corro.session", markdown);
		Assert.Contains("corro.external", markdown);
	}

	[Theory]
	[InlineData("en", "Erasing an account does **not** erase shared table records.")]
	[InlineData("es", "Borrar una cuenta **no** elimina los registros compartidos de las mesas.")]
	public async Task Account_erasure_does_not_promise_to_erase_shared_table_history(
		string language,
		string disclosure)
	{
		// Deleting the account document leaves names, actions and chat in the shared game document.
		var markdown = (string)Field(await NoticeAsync(language), "markdown")!;

		Assert.Contains(disclosure, markdown);
	}

	[Fact]
	public async Task An_unknown_language_still_gets_a_notice_rather_than_none()
	{
		// The fallback is English, not silence: "we have no translation" must never read as
		// "this deployment has no notice", which would also take sign-in down with it.
		var notice = await NoticeAsync("fr");

		Assert.Equal(true, Field(notice, "configured"));
		Assert.Contains("Juan José Montiel Pérez", (string)Field(notice, "markdown")!);
	}

	[Fact]
	public async Task The_language_is_never_used_to_walk_out_of_the_folder()
	{
		// The name is built from a whitelist, so a traversal attempt lands on the English text
		// rather than on appsettings.json.
		var notice = await NoticeAsync("../../appsettings");

		Assert.Equal(true, Field(notice, "configured"));
		Assert.Contains("Juan José Montiel Pérez", (string)Field(notice, "markdown")!);
	}

	[Theory]
	[InlineData("en")]
	[InlineData("es")]
	public void The_text_travels_with_the_build_rather_than_only_existing_in_the_repo(string language)
	{
		// THE bug this file exists for. The notice first lived in wwwroot, which is generated — the
		// frontend build wipes it and re-mirrors it from frontend/dist — so it was deleted on the
		// next build and production served "no notice" while every other test passed, because they
		// read the repo. This reads the BUILD OUTPUT, which is what a publish artifact is made of.
		var shipped = Path.Combine(AppContext.BaseDirectory, "Legal", $"privacy.{language}.md");

		Assert.True(File.Exists(shipped),
			$"{shipped} is missing: the notice is not being copied to the output, so a deployed "
			+ "server would report having no privacy notice and hide the footer link.");
	}

	[Fact]
	public async Task A_deployment_that_has_said_nothing_offers_no_notice()
	{
		Assert.Equal(false, Field(await NoticeAsync("en", new PrivacyOptions()), "configured"));
	}

	[Fact]
	public async Task A_host_with_their_own_policy_gets_a_link_instead_of_our_text()
	{
		var notice = await NoticeAsync("en", new PrivacyOptions
		{
			ControllerName = Configured.ControllerName,
			Jurisdiction = Configured.Jurisdiction,
			Contact = Configured.Contact,
			PolicyUrl = "https://example.test/privacy",
		});

		Assert.Equal(true, Field(notice, "configured"));
		Assert.Equal("https://example.test/privacy", Field(notice, "url"));
		Assert.Null(Field(notice, "markdown"));
	}

	[Fact]
	public async Task Missing_text_is_reported_as_no_notice_rather_than_an_empty_one()
	{
		// What a deployment looks like when the markdown fails to ship: honest, and the footer link
		// stays hidden. The bug this guards is the OTHER tests silently passing this way.
		var controller = new ConfigController(
			Options.Create(new SiteBrandingOptions()),
			Options.Create(Configured),
			new ContentRootOnlyEnvironment(Path.Combine(Path.GetTempPath(), "corro-no-legal-folder")));

		Assert.Equal(false, Field((await controller.GetPrivacy("en")).Value, "configured"));
	}

	/// <summary>An environment that answers ContentRootPath and nothing else, which is all the
	/// controller asks of it.</summary>
	private sealed class ContentRootOnlyEnvironment(string contentRoot) : IWebHostEnvironment
	{
		public string ContentRootPath { get; set; } = contentRoot;
		public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
		public string WebRootPath { get; set; } = contentRoot;
		public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
		public string EnvironmentName { get; set; } = "Test";
		public string ApplicationName { get; set; } = "CorroServer";
	}
}
