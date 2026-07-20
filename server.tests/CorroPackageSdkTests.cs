using System.Text.Json;
using System.Text.Json.Nodes;
using System.IO.Compression;
using Corro.PackageCli;
using Corro.PackageSdk;

namespace CorroServer.Tests;

/// <summary>
/// The authoring SDK and CLI must be the same gate as a server upload: real engine validation,
/// safe metadata, deterministic archives, clear exit codes and no leaked hidden-package secrets.
/// </summary>
public class CorroPackageSdkTests
{
	public static IEnumerable<object[]> TemplateFamilies()
		=> PackageTemplateCatalog.SupportedFamilies.Select(family => new object[] { family });

	[Fact]
	public async Task Validate_accepts_a_real_package_folder_in_text_and_json_modes()
	{
		var path = CorroTestPaths.FixtureDir("corro-classic");

		var text = await RunCli("validate", path);
		Assert.Equal(CliApplication.Success, text.ExitCode);
		Assert.Contains("VALID", text.Output);
		Assert.Contains("corro-classic", text.Output);
		Assert.Empty(text.Error);

		var json = await RunCli("validate", path, "--json");
		Assert.Equal(CliApplication.Success, json.ExitCode);
		using var document = JsonDocument.Parse(json.Output);
		Assert.True(document.RootElement.GetProperty("valid").GetBoolean());
		Assert.Equal("property", document.RootElement.GetProperty("package").GetProperty("gameType").GetString());
	}

	[Fact]
	public async Task Inspect_reports_hidden_state_without_leaking_the_unlock_code()
	{
		using var package = CopyFixture();
		var manifestPath = Path.Combine(package.Path, "manifest.json");
		var manifest = JsonNode.Parse(await File.ReadAllTextAsync(manifestPath))!.AsObject();
		manifest["unlockCode"] = "do-not-print-this-secret";
		await File.WriteAllTextAsync(manifestPath, manifest.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));

		var result = await RunCli("inspect", package.Path, "--json");

		Assert.Equal(CliApplication.Success, result.ExitCode);
		Assert.DoesNotContain("do-not-print-this-secret", result.Output);
		using var document = JsonDocument.Parse(result.Output);
		Assert.True(document.RootElement.GetProperty("package").GetProperty("hidden").GetBoolean());
		Assert.Equal(40, document.RootElement.GetProperty("package").GetProperty("content").GetProperty("squares").GetInt32());
	}

	[Fact]
	public async Task Invalid_json_is_a_validation_failure_with_a_useful_location()
	{
		using var package = CopyFixture();
		await File.WriteAllTextAsync(Path.Combine(package.Path, "manifest.json"), "{\n  invalid\n}");

		var result = await RunCli("validate", package.Path);

		Assert.Equal(CliApplication.InvalidPackage, result.ExitCode);
		Assert.Contains("INVALID", result.Output);
		Assert.Contains("Invalid JSON", result.Output);
		Assert.Contains("line", result.Output);
	}

	[Fact]
	public async Task Missing_input_and_bad_arguments_have_distinct_exit_codes()
	{
		var missing = await RunCli("validate", Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".corro"));
		Assert.Equal(CliApplication.InputOutputError, missing.ExitCode);
		Assert.Contains("not found", missing.Error, StringComparison.OrdinalIgnoreCase);

		var badOption = await RunCli("inspect", CorroTestPaths.FixtureDir("corro-classic"), "--output", "x");
		Assert.Equal(CliApplication.InvalidArguments, badOption.ExitCode);
		Assert.Contains("only valid with the pack command", badOption.Error);
	}

	[Fact]
	public async Task Validate_rejects_an_archive_over_the_server_upload_limit_before_extraction()
	{
		using var temp = new TemporaryDirectory();
		var archive = Path.Combine(temp.Path, "oversized.corro");
		await using (var stream = File.Create(archive))
		{
			stream.SetLength(CorroServer.Services.Corro.CorroPackageLoader.MaxUploadBytes + 1);
		}

		var result = await new PackageAuthoringService().ValidateAsync(archive);

		Assert.False(result.IsValid);
		Assert.Contains(result.Problems, problem => problem.Contains("upload limit"));
	}

	[Fact]
	public async Task Pack_creates_an_uploadable_archive_and_JSON_result()
	{
		using var temp = new TemporaryDirectory();
		var output = Path.Combine(temp.Path, "classic.corro");

		var packed = await RunCli("pack", CorroTestPaths.FixtureDir("corro-classic"), "--output", output, "--json");

		Assert.Equal(CliApplication.Success, packed.ExitCode);
		Assert.True(File.Exists(output));
		using (var document = JsonDocument.Parse(packed.Output))
		{
			Assert.True(document.RootElement.GetProperty("success").GetBoolean());
			Assert.Equal(64, document.RootElement.GetProperty("sha256").GetString()!.Length);
			Assert.True(document.RootElement.GetProperty("bytes").GetInt64() > 0);
		}

		var reloaded = await new PackageAuthoringService().ValidateAsync(output);
		Assert.True(reloaded.IsValid, string.Join(Environment.NewLine, reloaded.Problems));
		Assert.Equal("corro-classic", reloaded.Package!.Id);
	}

	[Fact]
	public async Task Packing_the_same_tree_twice_is_byte_for_byte_deterministic()
	{
		using var temp = new TemporaryDirectory();
		var first = Path.Combine(temp.Path, "first.corro");
		var second = Path.Combine(temp.Path, "second.corro");
		var sdk = new PackageAuthoringService();

		var a = await sdk.PackAsync(CorroTestPaths.FixtureDir("corro-classic"), first);
		var b = await sdk.PackAsync(CorroTestPaths.FixtureDir("corro-classic"), second);

		Assert.True(a.Succeeded);
		Assert.True(b.Succeeded);
		Assert.Equal(a.Sha256, b.Sha256);
		Assert.Equal(await File.ReadAllBytesAsync(first), await File.ReadAllBytesAsync(second));
	}

	[Fact]
	public async Task Pack_refuses_content_errors_without_replacing_an_existing_artifact()
	{
		using var package = CopyFixture();
		using var outputDir = new TemporaryDirectory();
		var output = Path.Combine(outputDir.Path, "existing.corro");
		await File.WriteAllTextAsync(output, "keep me");
		File.Delete(Path.Combine(package.Path, "tokens", "disc.svg"));

		var result = await new PackageAuthoringService().PackAsync(package.Path, output);

		Assert.False(result.Succeeded);
		Assert.Contains(result.Validation.Problems, problem => problem.Contains("token 'disc' has no icon"));
		Assert.Equal("keep me", await File.ReadAllTextAsync(output));
	}

	[Fact]
	public async Task Pack_rejects_an_output_inside_the_source_tree()
	{
		using var package = CopyFixture();
		var output = Path.Combine(package.Path, "self.corro");

		var result = await RunCli("pack", package.Path, "--output", output);

		Assert.Equal(CliApplication.InvalidArguments, result.ExitCode);
		Assert.Contains("outside the package folder", result.Error);
		Assert.False(File.Exists(output));
	}

	[Fact]
	public async Task Every_physical_server_package_passes_the_authoring_SDK()
	{
		var sdk = new PackageAuthoringService();
		var failures = new List<string>();
		foreach (var directory in Directory.GetDirectories(CorroTestPaths.PackagesRoot()).Order(StringComparer.Ordinal))
		{
			if (!File.Exists(Path.Combine(directory, "manifest.json")))
			{
				continue;
			}

			var result = await sdk.ValidateAsync(directory);
			if (!result.IsValid)
			{
				failures.Add($"{Path.GetFileName(directory)}: {string.Join("; ", result.Problems)}");
			}
		}

		Assert.Empty(failures);
	}

	[Fact]
	public async Task Help_and_unknown_commands_are_handled_without_throwing()
	{
		var help = await RunCli();
		Assert.Equal(CliApplication.Success, help.ExitCode);
		Assert.Contains("new", help.Output);
		Assert.Contains("validate", help.Output);
		Assert.Contains("inspect", help.Output);
		Assert.Contains("pack", help.Output);

		var unknown = await RunCli("launch");
		Assert.Equal(CliApplication.InvalidArguments, unknown.ExitCode);
		Assert.Contains("Unknown command", unknown.Error);
	}

	[Theory]
	[MemberData(nameof(TemplateFamilies))]
	public async Task Every_neutral_template_creates_validates_and_packs(string family)
	{
		using var root = new TemporaryDirectory();
		var destination = Path.Combine(root.Path, family);
		var template = await new PackageTemplateService().CreateAsync(
			family,
			destination,
			new PackageTemplateOptions
			{
				Id = $"test-{family}",
				NameEn = $"Test {family}",
				NameEs = $"Prueba {family}",
				Author = "Template tests",
			});

		Assert.True(template.Validation.IsValid);
		Assert.Equal(family, template.Family);
		Assert.Equal(destination, template.Path);
		Assert.Equal(destination, template.Validation.InputPath);

		using (var manifest = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(destination, "manifest.json"))))
		{
			Assert.Equal($"test-{family}", manifest.RootElement.GetProperty("id").GetString());
			Assert.Equal(family, manifest.RootElement.GetProperty("gameType").GetString());
			Assert.Equal($"Test {family}", manifest.RootElement.GetProperty("name").GetProperty("en").GetString());
			Assert.Equal("Template tests", manifest.RootElement.GetProperty("author").GetString());
		}

		var helpEn = await File.ReadAllTextAsync(Path.Combine(destination, "help.en.md"));
		Assert.StartsWith($"# Test {family}", helpEn);
		Assert.DoesNotContain("Customize this guide", helpEn);
		var helpEs = await File.ReadAllTextAsync(Path.Combine(destination, "help.es.md"));
		Assert.StartsWith($"# Prueba {family}", helpEs);
		foreach (var shortcut in new[] { "**F1**", "**Ctrl+F1**", "**Ctrl+Shift+F1**", "**F6**", "**Ctrl+Shift+R**" })
		{
			Assert.Contains(shortcut, helpEn);
			Assert.Contains(shortcut, helpEs);
		}
		if (family is "journey" or "assembly" or "draft" or "shedding" or "exploding")
		{
			Assert.Contains("**Shift+F1**", helpEn);
			Assert.Contains("**Shift+F1**", helpEs);
		}
		Assert.True(File.Exists(Path.Combine(destination, "README.md")));
		var settingsPath = Path.Combine(destination, ".vscode", "settings.json");
		Assert.True(File.Exists(settingsPath));
		var settings = await File.ReadAllTextAsync(settingsPath);
		if (family is "property" or "race" or "track" or "trivia")
		{
			Assert.Contains($"{family}Board", settings);
		}
		if (family is "property" or "journey" or "assembly" or "draft" or "shedding" or "exploding")
		{
			Assert.Contains($"{family}Deck", settings);
		}

		var schemaDirectory = Path.Combine(destination, ".vscode", "schemas");
		var schemaFiles = Directory.GetFiles(schemaDirectory, "*.json");
		Assert.Equal(5, schemaFiles.Length);
		foreach (var schema in schemaFiles)
		{
			using var parsed = JsonDocument.Parse(await File.ReadAllTextAsync(schema));
			Assert.Equal(JsonValueKind.Object, parsed.RootElement.ValueKind);
		}

		var definition = await new CorroServer.Services.Corro.CorroPackageLoader().LoadAsync(destination);
		var players = definition.Manifest.Tokens.Take(2).Select((token, index) => new CorroServer.Models.Player
		{
			Id = "player-" + index,
			Name = "Player " + (index + 1),
			Token = token.Id,
		}).ToList();
		var started = CorroServer.Services.Corro.Families.GameFamilies.For(family).CreateGame(
			new CorroServer.Services.Corro.Families.FamilyStartContext
			{
				Definition = definition,
				Players = players,
				Lang = "en",
			});
		Assert.Equal(2, started.State.Players.Count);

		var archivePath = Path.Combine(root.Path, family + ".corro");
		var packed = await new PackageAuthoringService().PackAsync(destination, archivePath);
		Assert.True(packed.Succeeded, string.Join(Environment.NewLine, packed.Validation.Problems));
		using (var archive = ZipFile.OpenRead(archivePath))
		{
			Assert.DoesNotContain(archive.Entries, entry => entry.FullName.StartsWith(".vscode/", StringComparison.OrdinalIgnoreCase));
			Assert.Contains(archive.Entries, entry => entry.FullName == "manifest.json");
		}

		var roundTrip = await new PackageAuthoringService().ValidateAsync(archivePath);
		Assert.True(roundTrip.IsValid, string.Join(Environment.NewLine, roundTrip.Problems));
	}

	[Fact]
	public async Task New_command_supports_JSON_and_derives_a_safe_default_identity()
	{
		using var root = new TemporaryDirectory();
		var destination = Path.Combine(root.Path, "Mi Juego Ágil");
		Directory.CreateDirectory(destination);

		var result = await RunCli(
			"new", "track", destination,
			"--name-en", "Agile Track",
			"--name-es", "Pista ágil",
			"--author", "Ada",
			"--json");

		Assert.Equal(CliApplication.Success, result.ExitCode);
		Assert.Empty(result.Error);
		using var output = JsonDocument.Parse(result.Output);
		Assert.True(output.RootElement.GetProperty("success").GetBoolean());
		Assert.Equal("mi-juego-agil", output.RootElement.GetProperty("id").GetString());
		using var manifest = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(destination, "manifest.json")));
		Assert.Equal("Ada", manifest.RootElement.GetProperty("author").GetString());

		var punctuationDestination = Path.Combine(root.Path, "!!!");
		var punctuation = await RunCli("new", "track", punctuationDestination, "--json");
		Assert.Equal(CliApplication.Success, punctuation.ExitCode);
		using var punctuationOutput = JsonDocument.Parse(punctuation.Output);
		Assert.Equal("new-game", punctuationOutput.RootElement.GetProperty("id").GetString());
	}

	[Fact]
	public async Task New_command_rejects_unknown_families_invalid_ids_and_nonempty_destinations()
	{
		using var root = new TemporaryDirectory();
		var unknown = await RunCli("new", "unknown", Path.Combine(root.Path, "unknown"));
		Assert.Equal(CliApplication.InvalidArguments, unknown.ExitCode);
		Assert.Contains("Unknown game family", unknown.Error);

		var invalidId = await RunCli(
			"new", "track", Path.Combine(root.Path, "invalid"), "--id", "Not valid!");
		Assert.Equal(CliApplication.InvalidArguments, invalidId.ExitCode);
		Assert.Contains("Package id", invalidId.Error);

		var occupied = Path.Combine(root.Path, "occupied");
		Directory.CreateDirectory(occupied);
		await File.WriteAllTextAsync(Path.Combine(occupied, "keep.txt"), "keep me");
		var nonempty = await RunCli("new", "track", occupied);
		Assert.Equal(CliApplication.InputOutputError, nonempty.ExitCode);
		Assert.Equal("keep me", await File.ReadAllTextAsync(Path.Combine(occupied, "keep.txt")));
		Assert.False(File.Exists(Path.Combine(occupied, "manifest.json")));
	}

	private static async Task<CliResult> RunCli(params string[] arguments)
	{
		using var output = new StringWriter();
		using var error = new StringWriter();
		var exitCode = await CliApplication.RunAsync(arguments, output, error);
		return new CliResult(exitCode, output.ToString(), error.ToString());
	}

	private static TemporaryDirectory CopyFixture()
	{
		var target = new TemporaryDirectory();
		CopyDirectory(CorroTestPaths.FixtureDir("corro-classic"), target.Path);
		return target;
	}

	private static void CopyDirectory(string source, string destination)
	{
		Directory.CreateDirectory(destination);
		foreach (var directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
		{
			Directory.CreateDirectory(Path.Combine(destination, Path.GetRelativePath(source, directory)));
		}
		foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
		{
			var target = Path.Combine(destination, Path.GetRelativePath(source, file));
			Directory.CreateDirectory(Path.GetDirectoryName(target)!);
			File.Copy(file, target);
		}
	}

	private sealed record CliResult(int ExitCode, string Output, string Error);

	private sealed class TemporaryDirectory : IDisposable
	{
		public string Path { get; } = System.IO.Path.Combine(
			System.IO.Path.GetTempPath(),
			"corro-sdk-test-" + Guid.NewGuid().ToString("N"));

		public TemporaryDirectory()
		{
			Directory.CreateDirectory(Path);
		}

		public void Dispose()
		{
			CorroServer.Services.Corro.CorroPackageLoader.DeleteExtracted(Path);
		}
	}
}
