using System.Text.Json;

namespace CorroServer.Services.Corro;

/// <summary>Package-file JSON reading, shared by the loader and the family board readers.</summary>
internal static class PackageJson
{
	internal static readonly JsonSerializerOptions Options = new()
	{
		PropertyNameCaseInsensitive = true,
		ReadCommentHandling = JsonCommentHandling.Skip,
		AllowTrailingCommas = true,
	};

	internal static async Task<T> ReadAsync<T>(string dir, string file)
	{
		var path = Path.Combine(dir, file);
		if (!File.Exists(path))
		{
			throw new FileNotFoundException($"Package is missing {file}", path);
		}

		await using var stream = File.OpenRead(path);
		var value = await JsonSerializer.DeserializeAsync<T>(stream, Options)
			?? throw new InvalidOperationException($"{file} deserialized to null.");
		return value;
	}

	/// <summary>Like <see cref="ReadAsync{T}"/> but returns null when the file doesn't exist
	/// (e.g. cards.json in a family without card decks).</summary>
	internal static async Task<T?> ReadOptionalAsync<T>(string dir, string file) where T : class
		=> File.Exists(Path.Combine(dir, file)) ? await ReadAsync<T>(dir, file) : null;
}
