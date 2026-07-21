using System.Collections.Concurrent;

namespace CorroServer.Services.Sounds;

/// <summary>
/// Serves the bundled default sound pack PLUS a per-game pack supplied by a loaded .corro
/// package. A package's <c>assets/sounds/</c> folder is just another pack (same <c>pack.json</c> shape),
/// so it is served by a <see cref="DefaultSoundPackProvider"/> pointed at that folder. A package
/// pack OVERLAYS the default: it provides sounds for the events it declares and falls back to the
/// default for the rest. Registered when a package game starts and removed when it ends.
/// </summary>
public sealed class CompositeSoundPackProvider : ISoundPackProvider
{
	private readonly DefaultSoundPackProvider _default;
	private readonly ConcurrentDictionary<string, DefaultSoundPackProvider> _packages = new();

	public CompositeSoundPackProvider(DefaultSoundPackProvider def) => _default = def;

	public string DefaultPackId => _default.DefaultPackId;

	/// <summary>Register a game's package sound pack (its extracted <c>assets/sounds/</c> folder).</summary>
	public void RegisterPackage(string packId, string soundsDir)
		=> _packages[packId] = new DefaultSoundPackProvider(soundsDir);

	/// <summary>Remove a game's package pack (called when the game ends).</summary>
	public void UnregisterPackage(string packId) => _packages.TryRemove(packId, out _);

	public IReadOnlyDictionary<string, IReadOnlyList<string>> ResolveEvents(string? packId)
	{
		if (packId != null && _packages.TryGetValue(packId, out var pack))
		{
			// Overlay: start from the default events, then let the package override/add its own.
			var merged = new Dictionary<string, IReadOnlyList<string>>(_default.ResolveEvents(null));
			foreach (var (eventName, files) in pack.ResolveEvents(null))
			{
				merged[eventName] = files;
			}

			return merged;
		}
		return _default.ResolveEvents(packId);
	}

	public IReadOnlyDictionary<string, string> ResolveAnnouncements(string? packId)
	{
		if (packId != null && _packages.TryGetValue(packId, out var pack))
		{
			// Same overlay as the events: the package's announcement mappings win.
			var merged = new Dictionary<string, string>(_default.ResolveAnnouncements(null));
			foreach (var (announcement, eventName) in pack.ResolveAnnouncements(null))
			{
				merged[announcement] = eventName;
			}

			return merged;
		}
		return _default.ResolveAnnouncements(packId);
	}

	public bool TryGetSoundFile(string packId, string fileName, out string physicalPath, out string contentType)
	{
		// A package pack serves its own declared files; anything it doesn't (the overlaid default
		// events) is served by the default pack. Both constrain to files their manifest declares,
		// so there's no path-traversal surface.
		if (_packages.TryGetValue(packId, out var pack)
			&& pack.TryGetSoundFile(packId, fileName, out physicalPath, out contentType))
		{
			return true;
		}

		return _default.TryGetSoundFile(_default.DefaultPackId, fileName, out physicalPath, out contentType);
	}
}
