using CorroServer.Models.Corro;

namespace CorroServer.Services.Corro.Families;

/// <summary>
/// The structural checks a card family's deck must pass before its OWN rules are worth testing:
/// the deck exists and is not empty, ids are present and unique, and every card names a known
/// effect, a translation key and a positive count.
///
/// Every card family repeated these verbatim, differing only in the family word inside the
/// message. They live here once so a family's <see cref="IGameFamily.ValidateDefinition"/> states
/// only what is genuinely ITS rule — shedding's colour discipline, exploding's bombs-per-table,
/// journey's hazard classes — and so a NEW family inherits the same wording for free.
///
/// The messages reach package authors through <c>corro-package validate</c>, so they name the
/// offending card and say what to do about it.
/// </summary>
public static class DeckValidation
{
	/// <summary>
	/// Validates <paramref name="deck"/> and returns it non-null, so a family can write
	/// <c>var deck = DeckValidation.RequireWellFormedDeck(d.SheddingDeck, "shedding", CardTypes);</c>
	/// and carry on with its own checks. Throws with a clear reason on the first problem.
	/// </summary>
	public static List<TCard> RequireWellFormedDeck<TCard>(
		List<TCard>? deck, string family, IReadOnlyCollection<string> knownTypes)
		where TCard : IPackageCardDef
	{
		if (deck is null)
		{
			throw new InvalidOperationException($"{family} package has no deck (cards.json).");
		}

		if (deck.Count == 0)
		{
			throw new InvalidOperationException($"{family} deck has no cards.");
		}

		var ids = deck.Select(c => c.Id).ToList();
		if (ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct().Count() != ids.Count)
		{
			throw new InvalidOperationException($"every {family} card needs a unique id.");
		}

		foreach (var card in deck)
		{
			if (!knownTypes.Contains(card.Type))
			{
				throw new InvalidOperationException($"{family} card '{card.Id}' has an unknown type '{card.Type}'.");
			}

			if (string.IsNullOrWhiteSpace(card.NameKey))
			{
				throw new InvalidOperationException($"{family} card '{card.Id}' has no name (add a nameKey).");
			}

			if (card.Count < 1)
			{
				throw new InvalidOperationException($"{family} card '{card.Id}' needs a positive count.");
			}
		}

		return deck;
	}
}
