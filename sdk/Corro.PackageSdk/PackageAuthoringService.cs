using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;

namespace Corro.PackageSdk;

/// <summary>
/// Author-facing package operations backed by the same loader, family validators and content
/// validator used by the running Corro server.
/// </summary>
public sealed class PackageAuthoringService
{
	private readonly CorroPackageLoader loader;
	private readonly IPackageValidator validator;

	public PackageAuthoringService()
		: this(new CorroPackageLoader(), new PackageValidator())
	{
	}

	internal PackageAuthoringService(CorroPackageLoader loader, IPackageValidator validator)
	{
		this.loader = loader;
		this.validator = validator;
	}

	/// <summary>Validate a package folder or <c>.corro</c> archive.</summary>
	public async Task<PackageValidationResult> ValidateAsync(
		string inputPath,
		CancellationToken cancellationToken = default)
	{
		var path = ResolveExistingInput(inputPath);
		cancellationToken.ThrowIfCancellationRequested();

		try
		{
			if (File.Exists(path) && new FileInfo(path).Length > CorroPackageLoader.MaxUploadBytes)
			{
				return new PackageValidationResult
				{
					InputPath = path,
					Problems = new[]
					{
						$"Archive is larger than the {CorroPackageLoader.MaxUploadBytes}-byte upload limit.",
					},
				};
			}

			var definition = await LoadAsync(path);
			cancellationToken.ThrowIfCancellationRequested();
			return Result(path, definition, validator.Validate(definition));
		}
		catch (Exception error) when (IsInvalidPackage(error))
		{
			return new PackageValidationResult
			{
				InputPath = path,
				Problems = new[] { UsefulMessage(error) },
			};
		}
	}

	/// <summary>
	/// Validate a package folder, create a reproducible archive, reload that archive through the
	/// production zip path, and atomically place it at <paramref name="outputPath"/>.
	/// </summary>
	public async Task<PackagePackResult> PackAsync(
		string sourceDirectory,
		string? outputPath = null,
		CancellationToken cancellationToken = default)
	{
		if (string.IsNullOrWhiteSpace(sourceDirectory))
		{
			throw new ArgumentException("A package folder is required.", nameof(sourceDirectory));
		}

		var source = Path.GetFullPath(sourceDirectory);
		if (!Directory.Exists(source))
		{
			if (File.Exists(source))
			{
				throw new ArgumentException("The pack command requires a package folder, not an archive.", nameof(sourceDirectory));
			}
			throw new DirectoryNotFoundException($"Package folder not found: {source}");
		}

		var validation = await ValidateAsync(source, cancellationToken);
		if (!validation.IsValid || validation.Package is null)
		{
			return new PackagePackResult { Validation = validation, Succeeded = false };
		}

		var output = ResolveOutput(outputPath, validation.Package.Id);
		if (IsWithin(source, output))
		{
			throw new ArgumentException(
				"The output archive must be outside the package folder, otherwise it would package itself.",
				nameof(outputPath));
		}

		var outputDirectory = Path.GetDirectoryName(output)
			?? throw new IOException($"Cannot determine output folder for '{output}'.");
		Directory.CreateDirectory(outputDirectory);
		var candidate = Path.Combine(outputDirectory, $".{Path.GetFileName(output)}.{Guid.NewGuid():N}.candidate");

		try
		{
			var packed = await PackageArchive.CreateAsync(source, candidate, cancellationToken);
			// Prove that the bytes authors receive take the exact same secure extraction and
			// validation path as an uploaded package before replacing an existing artifact.
			var roundTrip = await ValidateAsync(candidate, cancellationToken);
			if (!roundTrip.IsValid)
			{
				return new PackagePackResult { Validation = roundTrip, Succeeded = false };
			}

			File.Move(candidate, output, overwrite: true);
			return new PackagePackResult
			{
				Validation = validation,
				Succeeded = true,
				OutputPath = output,
				Bytes = packed.Bytes,
				Sha256 = packed.Sha256,
			};
		}
		finally
		{
			if (File.Exists(candidate))
			{
				File.Delete(candidate);
			}
		}
	}

	private async Task<GameDefinition> LoadAsync(string path)
	{
		if (Directory.Exists(path))
		{
			return await loader.LoadAsync(path);
		}

		var temporary = Path.Combine(Path.GetTempPath(), "corro-sdk-" + Guid.NewGuid().ToString("N"));
		try
		{
			await using var archive = File.OpenRead(path);
			return await loader.LoadFromZipAsync(archive, temporary);
		}
		finally
		{
			CorroPackageLoader.DeleteExtracted(temporary);
		}
	}

	private static PackageValidationResult Result(
		string path,
		GameDefinition definition,
		IReadOnlyList<string> problems)
		=> new()
		{
			InputPath = path,
			Package = PackageSummary.From(definition),
			Problems = problems.ToArray(),
		};

	private static string ResolveExistingInput(string inputPath)
	{
		if (string.IsNullOrWhiteSpace(inputPath))
		{
			throw new ArgumentException("A package folder or .corro archive is required.", nameof(inputPath));
		}

		var path = Path.GetFullPath(inputPath);
		if (!Directory.Exists(path) && !File.Exists(path))
		{
			throw new FileNotFoundException($"Package path not found: {path}", path);
		}
		return path;
	}

	private static string ResolveOutput(string? outputPath, string packageId)
	{
		var safeId = Regex.Replace(packageId, "[^A-Za-z0-9._-]", "-").Trim('-', '.');
		if (safeId.Length == 0)
		{
			safeId = "package";
		}

		var output = string.IsNullOrWhiteSpace(outputPath)
			? Path.Combine(Environment.CurrentDirectory, safeId + ".corro")
			: outputPath;
		return Path.GetFullPath(output);
	}

	private static bool IsWithin(string directory, string path)
	{
		var relative = Path.GetRelativePath(Path.GetFullPath(directory), Path.GetFullPath(path));
		return relative != ".."
			&& !relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal)
			&& !Path.IsPathRooted(relative);
	}

	private static bool IsInvalidPackage(Exception error)
		=> error is InvalidDataException
			or InvalidOperationException
			or JsonException
			or FileNotFoundException
			or DirectoryNotFoundException
			or OverflowException
			or NotSupportedException;

	private static string UsefulMessage(Exception error)
	{
		if (error is JsonException json)
		{
			var location = json.LineNumber is { } line
				? $" (line {line + 1}, byte {json.BytePositionInLine + 1})"
				: string.Empty;
			return "Invalid JSON" + location + ": " + json.Message.Split(" Path: ", 2)[0];
		}

		return error.Message;
	}
}
