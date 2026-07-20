using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CorroServer.Services.Corro;

namespace Corro.PackageSdk;

/// <summary>Creates neutral, executable starter packages from resources shipped in the SDK.</summary>
public sealed partial class PackageTemplateService
{
	private const string TemplatePrefix = "Corro.PackageSdk/Templates/";
	private const string SchemaPrefix = "Corro.PackageSdk/Schemas/";
	private readonly Assembly resources;
	private readonly PackageAuthoringService authoring;

	public PackageTemplateService()
		: this(typeof(PackageTemplateService).Assembly, new PackageAuthoringService())
	{
	}

	internal PackageTemplateService(Assembly resources, PackageAuthoringService authoring)
	{
		this.resources = resources;
		this.authoring = authoring;
	}

	/// <summary>
	/// Create and validate a starter package. The destination must not exist or must be empty; the
	/// SDK never overwrites a non-empty author directory.
	/// </summary>
	public async Task<PackageTemplateResult> CreateAsync(
		string family,
		string destinationDirectory,
		PackageTemplateOptions? options = null,
		CancellationToken cancellationToken = default)
	{
		if (!PackageTemplateCatalog.IsSupported(family))
		{
			throw new ArgumentException(
				$"Unknown game family '{family}'. Supported families: {string.Join(", ", PackageTemplateCatalog.SupportedFamilies)}.",
				nameof(family));
		}
		if (string.IsNullOrWhiteSpace(destinationDirectory))
		{
			throw new ArgumentException("A destination folder is required.", nameof(destinationDirectory));
		}

		var normalizedFamily = family.ToLowerInvariant();
		var destination = Path.GetFullPath(destinationDirectory);
		var destinationName = Path.GetFileName(destination.TrimEnd(
			Path.DirectorySeparatorChar,
			Path.AltDirectorySeparatorChar));
		if (destinationName.Length == 0)
		{
			throw new ArgumentException("The destination must name a package folder, not a file-system root.", nameof(destinationDirectory));
		}
		if (Directory.Exists(destination) && Directory.EnumerateFileSystemEntries(destination).Any())
		{
			throw new IOException($"Destination folder is not empty: {destination}");
		}
		if (File.Exists(destination))
		{
			throw new IOException($"Destination is an existing file: {destination}");
		}

		var identity = ResolveIdentity(destinationName, options ?? new PackageTemplateOptions());
		var parent = Path.GetDirectoryName(destination)
			?? throw new IOException($"Cannot determine the parent folder for '{destination}'.");
		Directory.CreateDirectory(parent);
		var staging = Path.Combine(parent, $".{destinationName}.corro-new-{Guid.NewGuid():N}");

		try
		{
			Directory.CreateDirectory(staging);
			await ExtractTreeAsync(TemplatePrefix + "_shared/", staging, cancellationToken);
			await ExtractTreeAsync(TemplatePrefix + normalizedFamily + "/", staging, cancellationToken);
			await ExtractSchemasAsync(staging, cancellationToken);
			await WriteEditorSettingsAsync(staging, normalizedFamily, cancellationToken);
			await ApplyIdentityAsync(staging, identity, cancellationToken);

			var validation = await authoring.ValidateAsync(staging, cancellationToken);
			if (!validation.IsValid)
			{
				throw new InvalidOperationException(
					$"The embedded '{normalizedFamily}' template is invalid: {string.Join("; ", validation.Problems)}");
			}

			if (Directory.Exists(destination))
			{
				// It was empty when checked above. Re-check immediately before replacing it so a
				// concurrent writer can never lose work.
				if (Directory.EnumerateFileSystemEntries(destination).Any())
				{
					throw new IOException($"Destination folder became non-empty: {destination}");
				}
				Directory.Delete(destination);
			}
			Directory.Move(staging, destination);

			// Return a result whose absolute path reflects the final location rather than the
			// private staging directory used for atomic generation.
			validation = validation with { InputPath = destination };
			return new PackageTemplateResult
			{
				Path = destination,
				Family = normalizedFamily,
				Id = identity.Id,
				Names = new Dictionary<string, string>
				{
					["en"] = identity.NameEn,
					["es"] = identity.NameEs,
				},
				Validation = validation,
			};
		}
		finally
		{
			CorroPackageLoader.DeleteExtracted(staging);
		}
	}

	private async Task ExtractTreeAsync(
		string prefix,
		string destination,
		CancellationToken cancellationToken)
	{
		var names = resources.GetManifestResourceNames()
			.Select(name => (Resource: name, Normalized: name.Replace('\\', '/')))
			.Where(item => item.Normalized.StartsWith(prefix, StringComparison.Ordinal))
			.OrderBy(item => item.Normalized, StringComparer.Ordinal)
			.ToArray();
		if (names.Length == 0)
		{
			throw new InvalidOperationException($"SDK resource tree is missing: {prefix}");
		}

		foreach (var resource in names)
		{
			var relative = resource.Normalized[prefix.Length..];
			await ExtractResourceAsync(resource.Resource, destination, relative, cancellationToken);
		}
	}

	private async Task ExtractSchemasAsync(string destination, CancellationToken cancellationToken)
	{
		var names = resources.GetManifestResourceNames()
			.Select(name => (Resource: name, Normalized: name.Replace('\\', '/')))
			.Where(item => item.Normalized.StartsWith(SchemaPrefix, StringComparison.Ordinal))
			.OrderBy(item => item.Normalized, StringComparer.Ordinal)
			.ToArray();
		if (names.Length == 0)
		{
			throw new InvalidOperationException("SDK contains no editor schemas.");
		}

		foreach (var resource in names)
		{
			var filename = resource.Normalized[SchemaPrefix.Length..];
			await ExtractResourceAsync(
				resource.Resource,
				destination,
				Path.Combine(".vscode", "schemas", filename),
				cancellationToken);
		}
	}

	private async Task ExtractResourceAsync(
		string resourceName,
		string destination,
		string relativePath,
		CancellationToken cancellationToken)
	{
		var safeRelative = relativePath.Replace('/', Path.DirectorySeparatorChar);
		var target = Path.GetFullPath(Path.Combine(destination, safeRelative));
		var root = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
		if (!target.StartsWith(root, StringComparison.Ordinal))
		{
			throw new InvalidOperationException($"Unsafe embedded template path: '{relativePath}'.");
		}

		Directory.CreateDirectory(Path.GetDirectoryName(target)!);
		await using var source = resources.GetManifestResourceStream(resourceName)
			?? throw new InvalidOperationException($"Cannot open SDK resource '{resourceName}'.");
		await using var output = new FileStream(
			target,
			FileMode.CreateNew,
			FileAccess.Write,
			FileShare.None,
			bufferSize: 16 * 1024,
			useAsync: true);
		await source.CopyToAsync(output, cancellationToken);
	}

	private static Task WriteEditorSettingsAsync(
		string destination,
		string family,
		CancellationToken cancellationToken)
	{
		var path = Path.Combine(destination, ".vscode", "settings.json");
		var schemas = new JsonArray();
		AddSchema(schemas, "/manifest.json", "./.vscode/schemas/manifest.schema.json");

		var boardDefinition = family switch
		{
			"property" => "propertyBoard",
			"race" => "raceBoard",
			"track" => "trackBoard",
			"trivia" => "triviaBoard",
			_ => null,
		};
		if (boardDefinition is not null)
		{
			AddSchema(
				schemas,
				"/board.json",
				$"./.vscode/schemas/board.schema.json#/$defs/{boardDefinition}");
		}

		var deckDefinition = family switch
		{
			"property" => "propertyDeck",
			"journey" => "journeyDeck",
			"assembly" => "assemblyDeck",
			"draft" => "draftDeck",
			"shedding" => "sheddingDeck",
			"exploding" => "explodingDeck",
			_ => null,
		};
		if (deckDefinition is not null)
		{
			AddSchema(
				schemas,
				"/cards.json",
				$"./.vscode/schemas/cards.schema.json#/$defs/{deckDefinition}");
		}

		if (family == "trivia")
		{
			AddSchema(schemas, "/questions.*.json", "./.vscode/schemas/questions.schema.json");
		}
		AddSchema(schemas, "/i18n/*.json", "./.vscode/schemas/i18n.schema.json");

		var settings = new JsonObject { ["json.schemas"] = schemas };
		return File.WriteAllTextAsync(
			path,
			settings.ToJsonString(new JsonSerializerOptions { WriteIndented = true }),
			Encoding.UTF8,
			cancellationToken);
	}

	private static void AddSchema(JsonArray schemas, string fileMatch, string url)
	{
		var matches = new JsonArray { fileMatch };
		schemas.Add(new JsonObject
		{
			["fileMatch"] = matches,
			["url"] = url,
		});
	}

	private static async Task ApplyIdentityAsync(
		string destination,
		TemplateIdentity identity,
		CancellationToken cancellationToken)
	{
		var manifestPath = Path.Combine(destination, "manifest.json");
		var manifest = JsonNode.Parse(await File.ReadAllTextAsync(manifestPath, cancellationToken))?.AsObject()
			?? throw new InvalidOperationException("Template manifest.json is not a JSON object.");
		manifest["id"] = identity.Id;
		manifest["author"] = identity.Author;
		manifest["name"] = new JsonObject
		{
			["en"] = identity.NameEn,
			["es"] = identity.NameEs,
		};
		await File.WriteAllTextAsync(
			manifestPath,
			manifest.ToJsonString(new JsonSerializerOptions { WriteIndented = true }),
			Encoding.UTF8,
			cancellationToken);

		await ReplaceFirstHeadingAsync(
			Path.Combine(destination, "help.en.md"), identity.NameEn, cancellationToken);
		await ReplaceFirstHeadingAsync(
			Path.Combine(destination, "help.es.md"), identity.NameEs, cancellationToken);
	}

	private static async Task ReplaceFirstHeadingAsync(
		string path,
		string heading,
		CancellationToken cancellationToken)
	{
		var text = await File.ReadAllTextAsync(path, cancellationToken);
		var newline = text.IndexOf('\n');
		var remainder = newline >= 0 ? text[newline..] : Environment.NewLine;
		await File.WriteAllTextAsync(path, "# " + heading + remainder, Encoding.UTF8, cancellationToken);
	}

	private static TemplateIdentity ResolveIdentity(string destinationName, PackageTemplateOptions options)
	{
		var id = options.Id is { Length: > 0 } explicitId ? explicitId : Slug(destinationName);
		if (!PackageIdPattern().IsMatch(id))
		{
			throw new ArgumentException(
				"Package id must be 3–64 lowercase characters, start and end with a letter or digit, " +
				"and contain only letters, digits, '-' or '_'.",
				nameof(options));
		}

		var defaultName = string.Join(" ", id.Split(['-', '_'], StringSplitOptions.RemoveEmptyEntries)
			.Select(word => CultureInfo.InvariantCulture.TextInfo.ToTitleCase(word)));
		var nameEn = ValidateText(options.NameEn ?? defaultName, "English name");
		var nameEs = ValidateText(options.NameEs ?? nameEn, "Spanish name");
		var author = ValidateText(options.Author ?? "Your name", "Author");
		return new TemplateIdentity(id, nameEn, nameEs, author);
	}

	private static string ValidateText(string value, string field)
	{
		var trimmed = value.Trim();
		if (trimmed.Length is < 1 or > 128 || trimmed.Any(char.IsControl))
		{
			throw new ArgumentException($"{field} must contain 1–128 printable characters.");
		}
		return trimmed;
	}

	private static string Slug(string value)
	{
		var normalized = value.Normalize(NormalizationForm.FormD);
		var withoutMarks = new string(normalized
			.Where(character => CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
			.ToArray());
		var slug = NonIdCharacters().Replace(withoutMarks.ToLowerInvariant(), "-").Trim('-');
		if (slug.Length > 64)
		{
			slug = slug[..64].TrimEnd('-');
		}
		if (slug.Length == 0)
		{
			return "new-game";
		}
		if (slug.Length < 3)
		{
			slug = "game-" + slug;
		}
		return slug;
	}

	[GeneratedRegex("^[a-z0-9](?:[a-z0-9_-]{1,62}[a-z0-9])$")]
	private static partial Regex PackageIdPattern();

	[GeneratedRegex("[^a-z0-9_-]+")]
	private static partial Regex NonIdCharacters();

	private sealed record TemplateIdentity(string Id, string NameEn, string NameEs, string Author);
}
