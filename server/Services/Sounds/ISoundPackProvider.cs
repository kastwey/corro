using CorroServer.Models;

namespace CorroServer.Services.Sounds;

/// <summary>
/// Supplies sound packs and serves their audio files.
/// <para>
/// Phase 1 only exposes the bundled default pack (<c>Assets/Sounds</c>). This interface is
/// the extension seam for packs: a future provider will resolve the pack bound to a game
/// from its in-memory <c>.corro</c> (cached by manifest hash) and overlay it on top of
/// the defaults, so any event the pack omits still falls back to a default sound.
/// </para>
/// </summary>
public interface ISoundPackProvider
{
	/// <summary>Id of the bundled default pack (used when no pack is requested).</summary>
	string DefaultPackId { get; }

	/// <summary>
	/// Effective event-name to file-name(s) map for the requested pack. Each event resolves
	/// to one or more files (the client picks one at random per play). Unknown or null
	/// <paramref name="packId"/> yields the default pack. Future pack-backed providers
	/// overlay the pack on top of the defaults here.
	/// </summary>
	IReadOnlyDictionary<string, IReadOnlyList<string>> ResolveEvents(string? packId);

	/// <summary>The pack's announcement→event map (empty when it declares none); pack-backed
	/// providers overlay the pack's on top of the defaults, like <see cref="ResolveEvents"/>.</summary>
	IReadOnlyDictionary<string, string> ResolveAnnouncements(string? packId);

	/// <summary>
	/// Resolves a playable audio file for a pack, applying all safety checks (the file must
	/// be one declared by the pack and have an allowed audio extension). Returns
	/// <see langword="false"/> when the request is invalid or the file is missing.
	/// </summary>
	bool TryGetSoundFile(string packId, string fileName, out string physicalPath, out string contentType);
}
