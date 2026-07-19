using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;

namespace CorroServer.Services.Corro;

/// <summary>
/// Loads a .corro package (a folder, or later a zip) into a validated <see cref="GameDefinition"/>.
/// The package is the only place game content lives; the engine stays content-agnostic. Validation
/// fails fast with a clear message so a broken board never reaches the game loop.
/// </summary>
public sealed class CorroPackageLoader
{
	public const long MaxUploadBytes = 10L * 1024 * 1024;
	public const int MaxZipEntries = 2_048;
	public const long MaxEntryUncompressedBytes = 25L * 1024 * 1024;
	public const long MaxTotalUncompressedBytes = 50L * 1024 * 1024;

	/// <summary>Load and validate the package whose manifest/board/cards live in <paramref name="packageDir"/>.</summary>
	public async Task<GameDefinition> LoadAsync(string packageDir)
	{
		if (!Directory.Exists(packageDir))
		{
			throw new DirectoryNotFoundException($"Package folder not found: {packageDir}");
		}

		var manifest = await PackageJson.ReadAsync<Manifest>(packageDir, "manifest.json");
		manifest = manifest with { Tokens = ResolveTokenSvgs(manifest.Tokens, packageDir) };
		var i18n = await LoadI18nAsync(packageDir, manifest.Locales);

		// board.json's shape depends on the game family (an array of squares for "property", a
		// circuit for "race", a linear track for "track"…): the family reads its own topology.
		var definition = await GameFamilies.For(manifest.GameType).LoadDefinitionAsync(packageDir, manifest, i18n);
		Validate(definition);
		return definition;
	}

	/// <summary>
	/// Extract an uploaded .corro zip into <paramref name="destDir"/> (created if needed) and load
	/// it. Extraction is guarded against zip-slip (entries escaping the destination). The package
	/// files may sit at the zip root or one folder down.
	/// </summary>
	public async Task<GameDefinition> LoadFromZipAsync(Stream zipStream, string destDir)
	{
		try
		{
			Directory.CreateDirectory(destDir);
			ExtractSafely(zipStream, destDir);
			return await LoadAsync(FindPackageRoot(destDir));
		}
		catch
		{
			// Invalid and hostile packages must not leave a partially-extracted tree behind.
			DeleteExtracted(destDir);
			throw;
		}
	}

	/// <summary>Delete an extracted package folder when the game ends. Best-effort (swallows errors).</summary>
	public static void DeleteExtracted(string destDir)
	{
		try
		{
			if (Directory.Exists(destDir))
			{
				Directory.Delete(destDir, recursive: true);
			}
		}
		catch
		{
			// Best effort: a leftover temp folder is harmless and the OS reclaims it.
		}
	}

	private static void ExtractSafely(Stream zipStream, string destDir)
	{
		using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read, leaveOpen: true);
		if (archive.Entries.Count > MaxZipEntries)
		{
			throw new InvalidOperationException($"Package contains too many zip entries (maximum {MaxZipEntries}).");
		}

		long totalUncompressedBytes = 0;
		foreach (var entry in archive.Entries)
		{
			if (entry.Length > MaxEntryUncompressedBytes)
			{
				throw new InvalidOperationException(
					$"Zip entry '{entry.FullName}' is too large (maximum {MaxEntryUncompressedBytes} bytes).");
			}

			checked
			{
				totalUncompressedBytes += entry.Length;
			}
			if (totalUncompressedBytes > MaxTotalUncompressedBytes)
			{
				throw new InvalidOperationException(
					$"Package expands beyond the {MaxTotalUncompressedBytes}-byte limit.");
			}
		}

		var root = Path.GetFullPath(destDir);
		foreach (var entry in archive.Entries)
		{
			if (string.IsNullOrEmpty(entry.Name))
			{
				continue; // directory entry
			}

			var target = Path.GetFullPath(Path.Combine(destDir, entry.FullName));
			// Zip-slip guard: the resolved path must stay inside destDir.
			if (target != root && !target.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
			{
				throw new InvalidOperationException($"Unsafe zip entry path: '{entry.FullName}'.");
			}

			Directory.CreateDirectory(Path.GetDirectoryName(target)!);
			entry.ExtractToFile(target, overwrite: true);
		}
	}

	/// <summary>The folder holding manifest.json: destDir itself, or a single content subfolder.</summary>
	private static string FindPackageRoot(string destDir)
	{
		if (File.Exists(Path.Combine(destDir, "manifest.json")))
		{
			return destDir;
		}

		foreach (var sub in Directory.GetDirectories(destDir))
		{
			if (File.Exists(Path.Combine(sub, "manifest.json")))
			{
				return sub;
			}
		}

		throw new FileNotFoundException("Package is missing manifest.json (at the zip root or one folder down).");
	}

	/// <summary>
	/// Fill each token's icon path-data: the manifest keeps tokens lean (id + nameKey), so the art
	/// lives as files under tokens/&lt;id&gt;.svg. Only the geometry of &lt;path&gt; elements is taken and it
	/// is whitelisted to path chars, so an uploaded package can't inject markup. An inline `svg` on
	/// the token still wins if present (small icons / back-compat).
	/// </summary>
	private static List<TokenDef> ResolveTokenSvgs(List<TokenDef> tokens, string packageDir)
		=> tokens.Select(t =>
		{
			var raw = !string.IsNullOrEmpty(t.Svg) ? t.Svg : ReadTokenSvgFile(packageDir, t.Id);
			return t with { Svg = raw is null ? null : SanitizePathData(raw) };
		}).ToList();

	/// <summary>Read tokens/&lt;id&gt;.svg and return the concatenated path-data of its &lt;path&gt; elements, or null.</summary>
	private static string? ReadTokenSvgFile(string packageDir, string id)
	{
		var safeId = Regex.Replace(id, "[^A-Za-z0-9_-]", ""); // never let a token id escape the tokens folder
		var path = Path.Combine(packageDir, "tokens", safeId + ".svg");
		if (safeId.Length == 0 || !File.Exists(path))
		{
			return null;
		}

		var text = File.ReadAllText(path);
		var ds = Regex.Matches(text, "d\\s*=\\s*\"([^\"]*)\"").Select(m => m.Groups[1].Value)
			.Concat(Regex.Matches(text, "d\\s*=\\s*'([^']*)'").Select(m => m.Groups[1].Value));
		var joined = string.Join(" ", ds).Trim();
		return joined.Length == 0 ? null : joined;
	}

	/// <summary>Whitelist to SVG path-data characters — mirrors the client sanitizer.</summary>
	private static string SanitizePathData(string d) => Regex.Replace(d, "[^0-9A-Za-z.,\\-\\s]", "");

	/// <summary>
	/// Loads the package's own translations (i18n/{lang}.json), flattened to dotted keys, for each
	/// declared locale that ships a file. Used server-side to resolve square names; the same files
	/// are served to the client to merge for everything it resolves itself.
	/// </summary>
	private static async Task<Dictionary<string, Dictionary<string, string>>> LoadI18nAsync(string dir, List<string> locales)
	{
		var result = new Dictionary<string, Dictionary<string, string>>();
		foreach (var lang in locales)
		{
			var path = Path.Combine(dir, "i18n", lang + ".json");
			if (!File.Exists(path))
			{
				continue;
			}

			using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(path));
			var flat = new Dictionary<string, string>();
			Flatten(doc.RootElement, "", flat);
			result[lang] = flat;
		}
		return result;
	}

	/// <summary>Flattens nested JSON ({a:{b:"x"}}) into dotted keys ("a.b" -> "x").</summary>
	private static void Flatten(JsonElement element, string prefix, Dictionary<string, string> into)
	{
		if (element.ValueKind == JsonValueKind.Object)
		{
			foreach (var prop in element.EnumerateObject())
			{
				Flatten(prop.Value, prefix.Length == 0 ? prop.Name : $"{prefix}.{prop.Name}", into);
			}
		}
		else if (element.ValueKind == JsonValueKind.String)
		{
			into[prefix] = element.GetString() ?? string.Empty;
		}
	}

	/// <summary>Cross-checks the package: the shared manifest requirements, then the family's own
	/// structural rules (contiguous ring, coherent circuit/track, referenced groups/decks exist…).</summary>
	public static void Validate(GameDefinition d)
	{
		if (string.IsNullOrWhiteSpace(d.Manifest.Id))
		{
			throw new InvalidOperationException("manifest.id is required.");
		}

		GameFamilies.For(d.Manifest.GameType).ValidateDefinition(d);
	}
}
