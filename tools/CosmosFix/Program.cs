using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Configuration;

// One-off maintenance tool: inspect / fix a game document directly in Cosmos.
//
// Usage:
//   dotnet run -- inspect <gameId>
//   dotnet run -- fix <gameId> <playerNameOrId>
//
// "fix" removes every pending debt owed by the given player (by name or id, case
// insensitive) and clears the turn flags that would keep them blocked, then writes the
// document back. The raw JSON is manipulated through System.Text.Json.Nodes so no field
// is lost in a model round-trip.

if (args.Length < 2)
{
	Console.Error.WriteLine("Usage: dotnet run -- inspect <gameId> | fix <gameId> <playerNameOrId>");
	return 1;
}

var mode = args[0].ToLowerInvariant();
var gameId = args[1];

var config = new ConfigurationBuilder()
	.AddUserSecrets(typeof(Program).Assembly) // pulls ConnectionStrings:CosmosDB from the server's secrets
	.Build();

var connectionString = config.GetConnectionString("CosmosDB");
if (string.IsNullOrEmpty(connectionString))
{
	Console.Error.WriteLine("CosmosDB connection string not found in user-secrets / environment.");
	return 1;
}

using var client = new CosmosClient(connectionString);
var container = client.GetDatabase("CorroGame").GetContainer("Games");

var documentId = gameId.StartsWith("game-") ? gameId : $"game-{gameId}";
var partitionKeyValue = gameId.StartsWith("game-") ? gameId.Substring(5) : gameId;
var pk = new PartitionKey(partitionKeyValue);

// Read the raw document as a JSON node tree.
JsonNode root;
using (var read = await container.ReadItemStreamAsync(documentId, pk))
{
	if (!read.IsSuccessStatusCode)
	{
		Console.Error.WriteLine($"Could not read {documentId} (status {read.StatusCode}).");
		return 1;
	}
	root = JsonNode.Parse(read.Content)!;
}

var gameState = root["gameState"];
if (gameState is null)
{
	Console.Error.WriteLine("Document has no gameState (still a lobby?).");
	return 1;
}

var players = gameState["players"]?.AsArray() ?? new JsonArray();
var debts = gameState["pendingDebts"]?.AsArray() ?? new JsonArray();

Console.WriteLine($"Game {gameId}  status={root["status"]}  currentTurn={gameState["currentTurn"]}");
Console.WriteLine($"  hasRolledThisTurn={gameState["hasRolledThisTurn"]}  mustRollAgain={gameState["mustRollAgain"]}");
Console.WriteLine("  Players:");
foreach (var p in players)
{
	Console.WriteLine($"    - {p!["name"]} (id={p["id"]})  money={p["money"]}  pos={p["position"]}  holding={p["isHeld"]}");
}
Console.WriteLine($"  PendingDebts ({debts.Count}):");
foreach (var d in debts)
{
	Console.WriteLine($"    - id={d!["id"]}  debtor={d["debtorName"]} (id={d["debtorId"]})  amount={d["amount"]}  reason={d["reason"]}  creditor={d["creditorName"]}  desc={d["description"]}");
}

if (mode == "inspect")
{
	return 0;
}

if (mode != "fix" || args.Length < 3)
{
	Console.Error.WriteLine("fix mode requires: fix <gameId> <playerNameOrId>");
	return 1;
}

var who = args[2];
bool Matches(JsonNode? debt)
{
	var name = debt?["debtorName"]?.GetValue<string>();
	var id = debt?["debtorId"]?.GetValue<string>();
	return string.Equals(name, who, StringComparison.OrdinalIgnoreCase)
		|| string.Equals(id, who, StringComparison.OrdinalIgnoreCase);
}

var toRemove = debts.Where(Matches).ToList();
if (toRemove.Count == 0)
{
	Console.WriteLine($"No pending debts found for '{who}'. Nothing to change.");
	return 0;
}

Console.WriteLine();
Console.WriteLine($"Removing {toRemove.Count} debt(s) owed by '{who}':");
foreach (var d in toRemove)
{
	Console.WriteLine($"    - id={d!["id"]}  amount={d["amount"]}  reason={d["reason"]}  desc={d["description"]}");
	debts.Remove(d);
}

// If the unblocked player is the one whose turn it is and the only thing keeping them
// stuck was an owed re-roll tied to the phantom debt, clear that flag too so they are not
// forced to roll again into the same bad state. We only touch it when no debts remain.
if (debts.Count == 0 && gameState["mustRollAgain"]?.GetValue<bool>() == true)
{
	gameState["mustRollAgain"] = false;
	Console.WriteLine("    (also cleared mustRollAgain, no debts remain)");
}

gameState["pendingDebts"] = debts;
root["lastUpdated"] = DateTime.UtcNow.ToString("o");

var json = root.ToJsonString(new JsonSerializerOptions { WriteIndented = false });
using var stream = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(json));
using var write = await container.ReplaceItemStreamAsync(stream, documentId, pk);
if (!write.IsSuccessStatusCode)
{
	Console.Error.WriteLine($"Write failed (status {write.StatusCode}).");
	return 1;
}

Console.WriteLine();
Console.WriteLine($"Done. {documentId} updated. Remaining debts: {debts.Count}.");
return 0;
