using CorroServer.Models.Corro;

namespace Corro.PackageSdk;

/// <summary>
/// Safe, author-facing metadata for a loaded package. Secrets such as <c>unlockCode</c> are never
/// exposed; callers only learn whether the package is hidden.
/// </summary>
public sealed record PackageSummary
{
	public required string Format { get; init; }
	public required string Id { get; init; }
	public required string GameType { get; init; }
	public string? Version { get; init; }
	public string? EngineVersion { get; init; }
	public string? Author { get; init; }
	public required IReadOnlyDictionary<string, string> Names { get; init; }
	public required IReadOnlyList<string> Locales { get; init; }
	public int MinPlayers { get; init; }
	public int MaxPlayers { get; init; }
	public int TokenCount { get; init; }
	public int HouseRuleCount { get; init; }
	public bool Hidden { get; init; }
	public bool HasWarning { get; init; }
	public required IReadOnlyDictionary<string, int> Content { get; init; }

	internal static PackageSummary From(GameDefinition definition)
	{
		var manifest = definition.Manifest;
		var content = new SortedDictionary<string, int>(StringComparer.Ordinal);

		switch (manifest.GameType.ToLowerInvariant())
		{
			case "property":
				content["squares"] = definition.Board.Count;
				content["cardDefinitions"] = definition.Cards.Count;
				content["groups"] = manifest.Groups.Count;
				content["decks"] = manifest.Decks.Count;
				break;
			case "race" when definition.RaceBoard is { } race:
				content["circuitSquares"] = race.CircuitLength;
				content["corridorSquaresPerSeat"] = race.CorridorLength;
				content["piecesPerPlayer"] = race.PiecesPerPlayer;
				content["seats"] = race.Seats.Count;
				break;
			case "track" when definition.TrackBoard is { } track:
				content["trackSquares"] = track.TrackLength;
				content["effects"] = track.Effects.Count;
				break;
			case "trivia" when definition.TriviaBoard is { } trivia:
				content["spokeSquaresPerArm"] = trivia.SpokeLength;
				content["ringSquares"] = trivia.Ring.Count;
				foreach (var (locale, questions) in definition.TriviaQuestions ?? [])
				{
					content[$"questions.{locale}"] = questions.Count;
				}
				break;
			case "journey":
				AddDeck(content, definition.JourneyDeck, card => card.Count);
				break;
			case "assembly":
				AddDeck(content, definition.AssemblyDeck, card => card.Count);
				break;
			case "draft":
				AddDeck(content, definition.DraftDeck, card => card.Count);
				break;
			case "shedding":
				AddDeck(content, definition.SheddingDeck, card => card.Count);
				break;
			case "exploding":
				AddDeck(content, definition.ExplodingDeck, card => card.Count);
				break;
		}

		return new PackageSummary
		{
			Format = manifest.Format,
			Id = manifest.Id,
			GameType = manifest.GameType,
			Version = manifest.Version,
			EngineVersion = manifest.EngineVersion,
			Author = manifest.Author,
			Names = new SortedDictionary<string, string>(manifest.Name, StringComparer.Ordinal),
			Locales = manifest.Locales.Order(StringComparer.Ordinal).ToArray(),
			MinPlayers = manifest.Players.Min,
			MaxPlayers = manifest.Players.Max,
			TokenCount = manifest.Tokens.Count,
			HouseRuleCount = manifest.HouseRules.Count,
			Hidden = !string.IsNullOrWhiteSpace(manifest.UnlockCode),
			HasWarning = !string.IsNullOrWhiteSpace(manifest.Warning),
			Content = content,
		};
	}

	private static void AddDeck<T>(
		IDictionary<string, int> content,
		IReadOnlyCollection<T>? deck,
		Func<T, int> copies)
	{
		content["cardDefinitions"] = deck?.Count ?? 0;
		content["cardCopies"] = deck?.Sum(card => Math.Max(0, copies(card))) ?? 0;
	}
}
