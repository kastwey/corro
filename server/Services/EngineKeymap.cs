using System.Reflection;
using System.Text.Json;

namespace CorroServer.Services;

/// <summary>
/// The canonical board keymap (key spec → client command), embedded in the server so there is a single
/// source of truth: the client fetches it (GET /api/config/keymap) and the package validator derives
/// the engine-reserved shortcut letters from it (so a package group key can't steal one). Loaded once.
/// </summary>
public static class EngineKeymap
{
	private static readonly Lazy<string> _json = new(LoadJson);
	private static readonly Lazy<IReadOnlySet<string>> _reservedLetters = new(DeriveReservedLetters);

	/// <summary>The keymap JSON, exactly as embedded, for serving to the client.</summary>
	public static string Json => _json.Value;

	/// <summary>
	/// The single bare letters the engine already binds (e.g. "c" = cash). A package group's shortcut
	/// key must not be one of these. Derived from the keymap, so adding a letter binding there updates
	/// this automatically — no second list to keep in sync.
	/// </summary>
	public static IReadOnlySet<string> ReservedLetters => _reservedLetters.Value;

	private static string LoadJson()
	{
		var asm = Assembly.GetExecutingAssembly();
		var name = asm.GetManifestResourceNames().Single(n => n.EndsWith("keymap.json", StringComparison.Ordinal));
		using var stream = asm.GetManifestResourceStream(name)!;
		using var reader = new StreamReader(stream);
		return reader.ReadToEnd();
	}

	private static IReadOnlySet<string> DeriveReservedLetters()
	{
		using var doc = JsonDocument.Parse(Json);
		var set = new HashSet<string>();
		foreach (var prop in doc.RootElement.EnumerateObject())
		{
			var k = prop.Name; // a key spec; bare single letters (no modifier) are the reserved ones
			if (k.Length != 1 || k[0] is < 'a' or > 'z')
			{
				continue;
			}
			// A binding scoped to a non-property family does NOT reserve its letter: those
			// boards have no property groups to clash with, and in property games the client
			// keeps the binding inert — so the letter stays free for property-package group
			// keys (e.g. "s" is the stations group there and the landmark cycle in a race).
			if (prop.Value.ValueKind == JsonValueKind.Object
				&& prop.Value.TryGetProperty("family", out var family)
				&& !string.IsNullOrEmpty(family.GetString()))
			{
				continue;
			}

			set.Add(k);
		}
		return set;
	}
}
