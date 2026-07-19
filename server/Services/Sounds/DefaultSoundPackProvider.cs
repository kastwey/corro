using System.Text.Json;
using CorroServer.Models;
using Microsoft.Extensions.Logging;

namespace CorroServer.Services.Sounds;

/// <summary>
/// Serves the bundled default sound pack from a directory on disk (defaults to
/// <c>Assets/Sounds</c>). The pack definition (<c>pack.json</c>) is loaded once and cached.
/// All file access is constrained to files the pack actually declares, which removes any
/// path-traversal surface.
/// </summary>
public sealed class DefaultSoundPackProvider : ISoundPackProvider
{
	private static readonly IReadOnlyDictionary<string, string> AllowedContentTypes =
		new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
		{
			[".mp3"] = "audio/mpeg",
			[".ogg"] = "audio/ogg",
			[".wav"] = "audio/wav",
		};

	private static readonly JsonSerializerOptions JsonOptions = new()
	{
		PropertyNameCaseInsensitive = true,
		Converters = { new SoundFileListConverter() },
	};

	private readonly string _rootDir;
	private readonly ILogger<DefaultSoundPackProvider>? _logger;
	private readonly Lazy<SoundPackDefinition> _pack;

	public DefaultSoundPackProvider(string? rootDir = null, ILogger<DefaultSoundPackProvider>? logger = null)
	{
		_rootDir = rootDir ?? Path.Combine(Directory.GetCurrentDirectory(), "Assets", "Sounds");
		_logger = logger;
		_pack = new Lazy<SoundPackDefinition>(LoadPack);
	}

	public string DefaultPackId => _pack.Value.PackId;

	public IReadOnlyDictionary<string, IReadOnlyList<string>> ResolveEvents(string? packId)
		// Phase 1: only the default pack exists. Pack-backed providers overlay here later.
		=> _pack.Value.Events;

	public IReadOnlyDictionary<string, string> ResolveAnnouncements(string? packId)
		=> _pack.Value.Announcements;

	public bool TryGetSoundFile(string packId, string fileName, out string physicalPath, out string contentType)
	{
		physicalPath = string.Empty;
		contentType = string.Empty;

		// Only files the pack actually declares can be served — this removes any path
		// traversal surface (a caller can never reach an arbitrary file on disk).
		var declared = _pack.Value.Events.Values.SelectMany(files => files);
		if (!declared.Contains(fileName, StringComparer.Ordinal))
		{
			return false;
		}

		var extension = Path.GetExtension(fileName);
		if (!AllowedContentTypes.TryGetValue(extension, out var resolvedType))
		{
			return false;
		}

		var candidate = Path.Combine(_rootDir, fileName);
		if (!File.Exists(candidate))
		{
			return false;
		}

		physicalPath = candidate;
		contentType = resolvedType;
		return true;
	}

	private SoundPackDefinition LoadPack()
	{
		var manifestPath = Path.Combine(_rootDir, "pack.json");
		try
		{
			if (File.Exists(manifestPath))
			{
				var json = File.ReadAllText(manifestPath);
				var pack = JsonSerializer.Deserialize<SoundPackDefinition>(json, JsonOptions);
				if (pack != null)
				{
					return pack;
				}
			}
			else
			{
				_logger?.LogWarning("Default sound pack manifest not found at {Path}", manifestPath);
			}
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Failed to load default sound pack from {Path}", manifestPath);
		}

		// Graceful fallback: an empty pack means the game simply plays no sounds.
		return new SoundPackDefinition { PackId = "default" };
	}
}
