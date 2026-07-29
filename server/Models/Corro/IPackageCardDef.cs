namespace CorroServer.Models.Corro;

/// <summary>
/// What every card family's catalog entry has in common, whatever its family adds on top: an id,
/// the engine effect (<see cref="Type"/>), a translation key for its name, and how many copies the
/// deck holds. Enough for the structural checks every family repeated verbatim — see
/// <c>DeckValidation.RequireWellFormedDeck</c>, which validates against this shape so a family's
/// own <c>ValidateDefinition</c> only states what is genuinely ITS rule.
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
}
