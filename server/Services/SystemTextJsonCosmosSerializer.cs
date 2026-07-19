using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Azure.Cosmos;

namespace CorroServer.Services;

/// <summary>
/// Cosmos DB serializer backed by System.Text.Json instead of Newtonsoft.Json.
/// </summary>
public class SystemTextJsonCosmosSerializer : CosmosSerializer
{
	private readonly JsonSerializerOptions _options;

	public SystemTextJsonCosmosSerializer(JsonSerializerOptions? options = null)
	{
		_options = options ?? new JsonSerializerOptions
		{
			PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
			WriteIndented = false,
			DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
			Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
		};
	}

	public override T FromStream<T>(Stream stream)
	{
		if (stream == null || !stream.CanRead || stream.Length == 0)
		{
			throw new ArgumentException("Stream is null, not readable, or empty", nameof(stream));
		}

		using var reader = new StreamReader(stream, Encoding.UTF8);
		var json = reader.ReadToEnd();
		return JsonSerializer.Deserialize<T>(json, _options)!;
	}

	public override Stream ToStream<T>(T input)
	{
		if (input == null)
		{
			throw new ArgumentNullException(nameof(input));
		}

		var json = JsonSerializer.Serialize(input, _options);
		return new MemoryStream(Encoding.UTF8.GetBytes(json));
	}
}
