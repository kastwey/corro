using System.Text.Json;
using System.Text.Json.Serialization;

namespace CorroServer.Models;

/// <summary>
/// On-disk definition of a sound pack. The bundled default lives in
/// <c>Assets/Sounds/pack.json</c>; later a pack of the same shape will be read from the
/// <c>.corro</c> bound to a game. Keys are logical event names (e.g. <c>dice.roll</c>),
/// values are the file names that live alongside the pack.
/// <para>
/// Each event maps to one or more files. A single file may be written as a bare string or
/// as a one-element array; multiple files (chosen at random by the client) are written as
/// an array. <see cref="SoundFileListConverter"/> normalises both forms to a list.
/// </para>
/// </summary>
public record SoundPackDefinition
{
	public required string PackId { get; init; }
	public Dictionary<string, IReadOnlyList<string>> Events { get; init; } = new();
	/// <summary>
	/// Optional: announcement key → event name. Lets a pack give an earcon to its OWN
	/// announcement keys (a card family's themed playedKey lines, e.g.
	/// "cards.pinchazo_played" → "journey.flat") or re-map an engine key for this game
	/// only (e.g. "game.game_started" → a shuffle). The client consults this map before
	/// its built-in announcement table; `_self`/`_victim` variants inherit the base entry.
	/// </summary>
	public Dictionary<string, string> Announcements { get; init; } = new();
}

/// <summary>
/// Resolved manifest returned to the client: a logical event name to the list of URLs the
/// browser can fetch and decode (the client picks one at random per play). The client plays
/// sounds by event name and never knows the underlying file names.
/// </summary>
public record SoundManifestResponse
{
	public required string PackId { get; init; }
	public required IReadOnlyDictionary<string, IReadOnlyList<string>> Events { get; init; }
	/// <summary>The pack's announcement→event map (see <see cref="SoundPackDefinition.Announcements"/>).</summary>
	public IReadOnlyDictionary<string, string> Announcements { get; init; } = new Dictionary<string, string>();
}

/// <summary>
/// Reads a sound-pack event value as a list of file names, accepting either a single JSON
/// string (<c>"a.ogg"</c>) or an array (<c>["a.ogg", "b.ogg"]</c>). Blank entries are
/// dropped; any other JSON shape is rejected.
/// </summary>
public sealed class SoundFileListConverter : JsonConverter<IReadOnlyList<string>>
{
	public override IReadOnlyList<string> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
	{
		switch (reader.TokenType)
		{
			case JsonTokenType.Null:
				return Array.Empty<string>();

			case JsonTokenType.String:
				{
					var single = reader.GetString();
					return string.IsNullOrWhiteSpace(single) ? Array.Empty<string>() : new[] { single };
				}

			case JsonTokenType.StartArray:
				{
					var list = new List<string>();
					while (reader.Read())
					{
						if (reader.TokenType == JsonTokenType.EndArray)
						{
							break;
						}

						if (reader.TokenType != JsonTokenType.String)
						{
							throw new JsonException($"Sound file array may only contain strings, found {reader.TokenType}.");
						}

						var item = reader.GetString();
						if (!string.IsNullOrWhiteSpace(item))
						{
							list.Add(item);
						}
					}
					return list;
				}

			default:
				throw new JsonException($"Unexpected token {reader.TokenType} for a sound file value.");
		}
	}

	public override void Write(Utf8JsonWriter writer, IReadOnlyList<string> value, JsonSerializerOptions options)
	{
		writer.WriteStartArray();
		foreach (var item in value)
		{
			writer.WriteStringValue(item);
		}

		writer.WriteEndArray();
	}
}
