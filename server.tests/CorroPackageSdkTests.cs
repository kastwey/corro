using System.Text.Json;
using System.Text.Json.Nodes;
using Corro.PackageCli;
using Corro.PackageSdk;

namespace CorroServer.Tests;

/// <summary>
/// The authoring SDK and CLI must be the same gate as a server upload: real engine validation,
/// safe metadata, deterministic archives, clear exit codes and no leaked hidden-package secrets.
/// </summary>
public class CorroPackageSdkTests
{
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
		Assert.Contains("validate", help.Output);
		Assert.Contains("inspect", help.Output);
		Assert.Contains("pack", help.Output);

		var unknown = await RunCli("launch");
		Assert.Equal(CliApplication.InvalidArguments, unknown.ExitCode);
		Assert.Contains("Unknown command", unknown.Error);
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
