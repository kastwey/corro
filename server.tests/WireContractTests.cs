using System.Reflection;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using CorroServer.Models;

namespace CorroServer.Tests;

/// <summary>
/// The client's <c>models.ts</c> is 114 interfaces typed BY HAND against these DTOs. Every other
/// cross-boundary contract in this repo is verified — translation parity, the keymap, package
/// schemas — but this one was not, and it is the one where drift is silent: the server adds a
/// field, the client simply never reads it, and nothing fails until a player notices a number that
/// never updates.
///
/// These tests read the real <c>models.ts</c> and check the wire types against it. They are
/// deliberately TEXTUAL (the same approach PackageContentBoundaryTests takes over frontend
/// sources) rather than compiling TypeScript: the goal is to catch a forgotten field, not to
/// type-check the client.
///
/// Adding a field to a wire DTO therefore means adding it to models.ts in the same change — which
/// is exactly the discipline this pins.
/// </summary>
public class WireContractTests
{
	/// <summary>The DTOs that cross the wire, paired with the TS interface that mirrors each.</summary>
	public static TheoryData<string, string> WireTypes() => new()
	{
		{ nameof(GameState), "GameState" },
		{ nameof(Player), "Player" },
		{ nameof(Square), "Square" },
		{ nameof(TradeState), "TradeStateDto" },
		{ nameof(TradeOffer), "TradeOfferDto" },
		{ nameof(AuctionState), "AuctionState" },
		{ nameof(PendingPurchase), "PendingPurchase" },
		{ nameof(DebtState), "DebtState" },
	};

	/// <summary>
	/// Server-only members that deliberately never reach a client: state a family's ProjectFor
	/// strips, and bookkeeping the browser has no use for. Each needs a reason, so "the client does
	/// not need it" stays a decision rather than an oversight.
	/// </summary>
	private static readonly Dictionary<string, string> NotOnTheWire = new(StringComparer.Ordinal)
	{
		// Answer keys and full decks: stripped by the families' projections before any send.
		["GameState.triviaDeck"] = "carries the correct answers; TriviaFamily.ProjectFor blanks it",
		["GameState.forbiddenDeck"] = "carries every target word; ForbiddenFamily.ProjectFor removes it",
		// Server bookkeeping with no display or input meaning.
		["GameState.consecutiveDoubles"] = "speeding counter; the client only needs mustRollAgain",
		["GameState.packageCards"] = "the draw piles' catalog; a drawn card arrives via CardDrawn",
		["GameState.packageDecks"] = "deck ORDER is hidden information; the board shows counts only",
		["Player.isBot"] = "the engine treats a bot as any player; only the lobby distinguishes seats",
		["Player.lapsCompleted"] = "feeds first-lap rules server-side; nothing is rendered from it",
		["Player.seatId"] = "the race view reads seats from race.seats, not from the player",
		["Player.status"] = "drives turn rotation; the client shows isBankrupt / finishPlace instead",
		["Square.players"] = "who stands here is derived from each player's own position",
	};

	private static string ModelsSource()
	{
		var repositoryRoot = Directory.GetParent(Directory.GetParent(CorroTestPaths.PackagesRoot())!.FullName)!.FullName;
		return File.ReadAllText(Path.Combine(repositoryRoot, "frontend", "src", "models.ts"));
	}

	/// <summary>The body of `export interface &lt;name&gt; { … }`, brace-matched so a nested object
	/// literal inside a field does not end the block early.</summary>
	private static string InterfaceBody(string source, string interfaceName)
	{
		var header = Regex.Match(source, $@"export interface {Regex.Escape(interfaceName)}\s*\{{");
		Assert.True(header.Success, $"models.ts declares no interface '{interfaceName}'.");

		var depth = 0;
		var start = header.Index + header.Length;
		for (var i = start - 1; i < source.Length; i++)
		{
			if (source[i] == '{') depth++;
			else if (source[i] == '}' && --depth == 0) return source[start..i];
		}
		throw new InvalidOperationException($"interface '{interfaceName}' is never closed in models.ts.");
	}

	/// <summary>
	/// Property names declared DIRECTLY in a TS interface body (`name?: type;`). Fields nested in
	/// an inline object literal — <c>building?: { levels: number; … }</c> — belong to that literal,
	/// not to the interface, so only depth-0 declarations count.
	/// </summary>
	private static HashSet<string> DeclaredFields(string body)
	{
		var fields = new HashSet<string>(StringComparer.Ordinal);
		var depth = 0;
		foreach (var rawLine in body.Split('\n'))
		{
			var line = rawLine.Trim();
			if (depth == 0 && Regex.Match(line, @"^([a-zA-Z_][\w]*)\??\s*:") is { Success: true } match)
			{
				fields.Add(match.Groups[1].Value);
			}
			depth += line.Count(c => c == '{') - line.Count(c => c == '}');
		}
		return fields;
	}

	/// <summary>camelCase, matching the SignalR JSON protocol's naming policy.</summary>
	private static string Wire(string name) => char.ToLowerInvariant(name[0]) + name[1..];

	/// <summary>
	/// The wire names a type actually serializes: public instance properties minus those marked
	/// <see cref="JsonIgnoreAttribute"/>. Reflecting over CLR properties alone would count a
	/// computed convenience the server deliberately keeps off the wire.
	/// </summary>
	private static IEnumerable<string> WireFields(Type type)
		=> type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
			.Where(p => p.GetCustomAttribute<JsonIgnoreAttribute>() is null)
			.Select(p => Wire(p.Name));

	private static Type WireType(string serverType)
		=> typeof(GameState).Assembly.GetTypes()
			.Single(t => t.Name == serverType && t.Namespace == "CorroServer.Models");

	[Theory]
	[MemberData(nameof(WireTypes))]
	public void Every_field_the_server_sends_is_declared_on_the_client(string serverType, string clientInterface)
	{
		var declared = DeclaredFields(InterfaceBody(ModelsSource(), clientInterface));

		var missing = WireFields(WireType(serverType))
			.Where(name => !declared.Contains(name))
			.Where(name => !NotOnTheWire.ContainsKey($"{clientInterface}.{name}"))
			.OrderBy(name => name, StringComparer.Ordinal)
			.ToList();

		Assert.True(missing.Count == 0,
			$"{serverType} sends fields models.ts does not declare on {clientInterface}: "
			+ $"{string.Join(", ", missing)}.\nAdd them to the interface, or list them in NotOnTheWire "
			+ "with the reason they never reach a client.");
	}

	[Theory]
	[MemberData(nameof(WireTypes))]
	public void Every_field_the_client_expects_actually_exists_on_the_server(string serverType, string clientInterface)
	{
		var served = WireFields(WireType(serverType)).ToHashSet(StringComparer.Ordinal);

		var phantom = DeclaredFields(InterfaceBody(ModelsSource(), clientInterface))
			.Where(name => !served.Contains(name))
			.OrderBy(name => name, StringComparer.Ordinal)
			.ToList();

		Assert.True(phantom.Count == 0,
			$"models.ts expects fields {serverType} never sends on {clientInterface}: "
			+ $"{string.Join(", ", phantom)}.\nThose read as undefined forever — a renamed or removed "
			+ "server field usually explains it.");
	}

	[Fact]
	public void Every_exemption_still_names_a_real_server_field()
	{
		// An exemption that outlived its field would silently excuse a future field of that name.
		var stale = new List<string>();
		foreach (var (entry, _) in NotOnTheWire)
		{
			var (clientInterface, field) = (entry.Split('.')[0], entry.Split('.')[1]);
			var serverType = WireTypes().Cast<object[]>()
				.Single(row => (string)row[1] == clientInterface)[0] as string;
			if (!WireFields(WireType(serverType!)).Contains(field))
			{
				stale.Add(entry);
			}
		}

		Assert.True(stale.Count == 0,
			$"NotOnTheWire exempts fields that no longer exist: {string.Join(", ", stale)}. Remove them.");
	}
}
