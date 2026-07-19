using System.Collections.Concurrent;
using CorroServer.Models.Corro;
using CorroServer.Services.Sounds;

namespace CorroServer.Services.Corro;

/// <summary>
/// Owns the lifecycle of an uploaded .corro package for a game (no accounts, so packages are
/// transient): extract the zip into a per-game temp folder, load+validate it, and register its
/// sound pack under the game id — then release everything (sounds + folder) when the game ends.
/// One instance is shared across the app; the HTTP upload and the Hub's game-over cleanup use it.
/// </summary>
public sealed class CorroPackageStore
{
	private readonly CompositeSoundPackProvider _sounds;
	private readonly string _baseDir;
	private readonly ConcurrentDictionary<string, string> _dirs = new();
	private readonly ConcurrentDictionary<string, GameDefinition> _definitions = new();
	private readonly ConcurrentDictionary<string, PackageOrigin> _origins = new();

	public CorroPackageStore(CompositeSoundPackProvider sounds, string? baseDir = null)
	{
		_sounds = sounds;
		_baseDir = baseDir ?? Path.Combine(Path.GetTempPath(), "corro-packages");
	}

	/// <summary>
	/// Stage an uploaded package under <paramref name="key"/> (an upload token, later the game's
	/// pack id): extract+validate the zip, keep the definition, and register its sound pack (under
	/// the same key) if it has one. Replaces any previous package staged under that key. The
	/// definition is retrieved with <see cref="GetDefinition"/> when the game is created.
	/// </summary>
	public async Task<GameDefinition> StageAsync(string key, Stream zip)
	{
		var dir = Path.Combine(_baseDir, SafeName(key));
		CorroPackageLoader.DeleteExtracted(dir); // clear any stale extraction for this key

		var definition = await new CorroPackageLoader().LoadFromZipAsync(zip, dir);
		_dirs[key] = dir;
		_definitions[key] = definition;

		var soundsDir = Path.Combine(dir, "sounds");
		if (Directory.Exists(soundsDir))
		{
			_sounds.RegisterPackage(key, soundsDir);
		}

		return definition;
	}

	/// <summary>
	/// Stage a shipped package that lives on disk as a folder (<paramref name="sourceDir"/>): copy it
	/// into a per-game temp folder, then load+register it exactly like an upload. The copy (not the
	/// shipped source) is what <see cref="Release"/> later deletes, so the source is never touched.
	/// </summary>
	public async Task<GameDefinition> StageFromDirectoryAsync(string key, string sourceDir)
	{
		var dir = Path.Combine(_baseDir, SafeName(key));
		CorroPackageLoader.DeleteExtracted(dir); // clear any stale copy for this key
		CopyDirectory(sourceDir, dir);

		var definition = await new CorroPackageLoader().LoadAsync(dir);
		_dirs[key] = dir;
		_definitions[key] = definition;

		var soundsDir = Path.Combine(dir, "sounds");
		if (Directory.Exists(soundsDir))
		{
			_sounds.RegisterPackage(key, soundsDir);
		}

		return definition;
	}

	private static void CopyDirectory(string source, string dest)
	{
		Directory.CreateDirectory(dest);
		foreach (var dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
		{
			Directory.CreateDirectory(dir.Replace(source, dest));
		}

		foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
		{
			File.Copy(file, file.Replace(source, dest), overwrite: true);
		}
	}

	/// <summary>The definition staged under <paramref name="key"/>, or null if none/expired.</summary>
	public GameDefinition? GetDefinition(string key)
		=> _definitions.TryGetValue(key, out var def) ? def : null;

	/// <summary>
	/// Record where a staged package came from (a shipped board id, or a durable blob key for an
	/// upload), so the game it's used for can persist a reference and be restored later.
	/// </summary>
	public void SetOrigin(string key, PackageOrigin origin) => _origins[key] = origin;

	/// <summary>The recorded origin for a staged package, or null if none was set.</summary>
	public PackageOrigin? GetOrigin(string key)
		=> _origins.TryGetValue(key, out var o) ? o : null;

	/// <summary>
	/// Reads the package's own translation file <c>i18n/{lang}.json</c> (its keys are merged over
	/// the app's at game start). Returns null when there's no package, no such file, or the lang is
	/// not a simple locale token (guards against path traversal). The JSON is returned verbatim.
	/// </summary>
	public string? ReadI18n(string key, string lang)
	{
		if (!_dirs.TryGetValue(key, out var dir))
		{
			return null;
		}

		if (!System.Text.RegularExpressions.Regex.IsMatch(lang, "^[a-zA-Z]{2}(-[a-zA-Z]{2})?$"))
		{
			return null;
		}

		var i18nDir = Path.GetFullPath(Path.Combine(dir, "i18n"));
		var file = Path.GetFullPath(Path.Combine(i18nDir, lang + ".json"));
		if (!file.StartsWith(i18nDir + Path.DirectorySeparatorChar))
		{
			return null; // stay inside i18n/
		}

		return File.Exists(file) ? File.ReadAllText(file) : null;
	}

	/// <summary>
	/// Reads the package's help document <c>help.{lang}.md</c> (the board's rules + how-to-play, shown
	/// in-game). Returns null when there's no package, no such file, or the lang is not a simple locale
	/// token (guards against path traversal). The markdown is returned verbatim (rendered client-side).
	/// </summary>
	public string? ReadHelp(string key, string lang)
	{
		if (!_dirs.TryGetValue(key, out var dir))
		{
			return null;
		}

		if (!System.Text.RegularExpressions.Regex.IsMatch(lang, "^[a-zA-Z]{2}(-[a-zA-Z]{2})?$"))
		{
			return null;
		}

		var root = Path.GetFullPath(dir);
		var file = Path.GetFullPath(Path.Combine(root, $"help.{lang}.md"));
		if (!file.StartsWith(root + Path.DirectorySeparatorChar))
		{
			return null; // stay inside the package
		}

		return File.Exists(file) ? File.ReadAllText(file) : null;
	}

	/// <summary>Release a staged package: unregister its sound pack and delete its temp folder.</summary>
	public void Release(string key)
	{
		_sounds.UnregisterPackage(key);
		_definitions.TryRemove(key, out _);
		_origins.TryRemove(key, out _);
		if (_dirs.TryRemove(key, out var dir))
		{
			CorroPackageLoader.DeleteExtracted(dir);
		}
	}

	/// <summary>Keep the game id from escaping the base folder when used as a path segment.</summary>
	private static string SafeName(string gameId)
		=> string.Concat(gameId.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_'));
}

/// <summary>
/// Where a staged package came from, so a game can be restored later: a shipped board id (re-staged
/// from server/Packages) XOR a durable blob key (an upload re-staged from <see cref="IPackageBlobStore"/>).
/// </summary>
public sealed record PackageOrigin
{
	public string? ShippedId { get; init; }
	public string? BlobKey { get; init; }
}
