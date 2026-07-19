using System.Security.Cryptography;

namespace CorroServer.Services;

/// <summary>
/// Centralized ID generation for games, invite codes, and secure player IDs.
/// </summary>
public static class IdGenerator
{
	private const string AlphanumericUppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	private const string AlphanumericMixed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	/// <summary>No I/O/0/1: re-entry codes are dictated aloud and copied by ear (screen
	/// reader), so every character must be unmistakable. Exactly 32 symbols, which also
	/// makes the byte-mod mapping bias-free.</summary>
	private const string UnambiguousUppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

	/// <summary>
	/// Generates a 6-character game ID (uppercase alphanumeric).
	/// Example: "A3X9K2"
	/// </summary>
	public static string GameId()
	{
		return GenerateRandomString(AlphanumericUppercase, 6);
	}

	/// <summary>
	/// Generates an invite code (same format as GameId for simplicity).
	/// </summary>
	public static string InviteCode()
	{
		return GameId();
	}

	/// <summary>
	/// Generates a 32-character secure ID for player authentication.
	/// Uses mixed case for increased entropy.
	/// </summary>
	public static string SecureId()
	{
		return GenerateRandomString(AlphanumericMixed, 32);
	}

	/// <summary>
	/// Generates a new player ID using GUID.
	/// </summary>
	public static string PlayerId()
	{
		return Guid.NewGuid().ToString();
	}

	/// <summary>
	/// A player's personal RE-ENTRY code: 8 characters, unambiguous alphabet. It is a
	/// credential (whoever types it can reclaim the seat while it is disconnected), so it
	/// must be unguessable (32^8 ≈ 10^12) yet short enough to note down or dictate.
	/// </summary>
	public static string RejoinCode()
	{
		return GenerateRandomString(UnambiguousUppercase, 8);
	}

	private static string GenerateRandomString(string chars, int length)
	{
		// Cryptographic RNG: these strings are credentials (secret ids, re-entry codes),
		// not just identifiers. The byte-mod mapping is bias-free for 32-symbol alphabets
		// and negligibly biased for the 36/62 ones.
		var bytes = new byte[length];
		RandomNumberGenerator.Fill(bytes);
		return new string(bytes.Select(b => chars[b % chars.Length]).ToArray());
	}
}
