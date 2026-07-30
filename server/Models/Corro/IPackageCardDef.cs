namespace CorroServer.Models.Corro;

/// <summary>
/// What every card family's catalog entry has in common, whatever its family adds on top: an id,
/// the engine effect (<see cref="Type"/>), a translation key for its name, how many copies the deck
/// holds, and an optional accent colour.
///
/// This is what lets the passes that treat ALL cards alike stop enumerating families by hand:
/// the structural deck checks (<c>DeckValidation.RequireWellFormedDeck</c>), and the package-wide
/// sweeps for art, accent colours and translation keys (reached through
/// <c>GameDefinition.AllFamilyCards</c>). A family's own validation is then free to state only
/// what is genuinely ITS rule.
/// </summary>
public interface IPackageCardDef
{
	string Id { get; }

	/// <summary>The engine effect ("number", "bomb", "distance"…). Each family owns its vocabulary.</summary>
	string Type { get; }

	/// <summary>Translation key for the spoken/displayed card name.</summary>
	string NameKey { get; }

	/// <summary>How many copies of this card the deck holds.</summary>
	int Count { get; }

	/// <summary>Optional package-owned #RRGGBB accent for the card face; null uses the engine's.
	/// Validated package-wide, so a malformed colour is reported wherever it appears.</summary>
	string? ArtColor { get; }
}
