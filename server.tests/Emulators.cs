using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using CorroServer.Services;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Logging.Abstractions;

namespace CorroServer.Tests;

/// <summary>
/// Shared helpers for the local-emulator integration tests: reachability probes (used by the
/// <see cref="AzuriteFactAttribute"/> / <see cref="CosmosFactAttribute"/> / <see cref="EmulatorsFactAttribute"/>
/// gates so they skip — never fail — when an emulator is down) plus the well-known emulator
/// connection details and a Cosmos client/repository configured exactly like the server's.
/// Start the emulators with <c>tools/dev.ps1</c> (or <c>docker compose up -d</c>).
/// </summary>
internal static class Emulators
{
	public const int AzuriteBlobPort = 10000;
	public const int CosmosPort = 8081;

	// Well-known emulator endpoints. Azurite's dev shortcut; Cosmos vnext-preview over HTTP on :8081.
	public const string BlobConnectionString = "UseDevelopmentStorage=true";
	public const string CosmosConnectionString =
		"AccountEndpoint=http://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

	public static bool Reachable(int port)
	{
		try
		{
			using var client = new TcpClient();
			return client.ConnectAsync("127.0.0.1", port).Wait(TimeSpan.FromMilliseconds(400)) && client.Connected;
		}
		catch
		{
			return false;
		}
	}

	/// <summary>
	/// True only when a real Cosmos endpoint answers on :8081 — not just any TCP listener. A TCP probe
	/// alone is fooled by an unrelated dev server squatting on the port, which would make the gated tests
	/// FAIL (talking Cosmos to a foreign server) instead of skip. Confirm it by actually reading the
	/// account; a non-Cosmos server faults the call, so we skip as intended.
	/// </summary>
	public static bool CosmosReachable()
	{
		if (!Reachable(CosmosPort))
		{
			return false;
		}

		try
		{
			using var client = NewCosmosClient();
			var read = client.ReadAccountAsync();
			return read.Wait(TimeSpan.FromSeconds(2)) && !read.IsFaulted;
		}
		catch
		{
			return false;
		}
	}

	/// <summary>A Cosmos client for the emulator, with the same serializer the server uses (lowercase "id").</summary>
	public static CosmosClient NewCosmosClient() => new(CosmosConnectionString, new CosmosClientOptions
	{
		ConnectionMode = ConnectionMode.Gateway,
		LimitToEndpoint = true,
		Serializer = new SystemTextJsonCosmosSerializer(new JsonSerializerOptions
		{
			PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
			DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
			Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) }
		})
	});

	/// <summary>The game repository against the emulator, with the CorroGame/Games schema ensured.</summary>
	public static async Task<CosmosGameRepository> NewCosmosRepositoryAsync()
	{
		var client = NewCosmosClient();
		var db = (await client.CreateDatabaseIfNotExistsAsync("CorroGame")).Database;
		await db.CreateContainerIfNotExistsAsync("Games", "/gameId");
		return new CosmosGameRepository(client, NullLogger<CosmosGameRepository>.Instance);
	}
}
