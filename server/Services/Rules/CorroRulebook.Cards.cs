using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro;

namespace CorroServer.Services.Rules;

/// <summary>
/// CorroRulebook - CARD RULES
///
/// Drawing cards from a package's shuffled decks and applying each card's generic effect through the
/// engine. There is no hardcoded card catalog: every board ships its own deck as .corro data, and
/// the effect is resolved generically (see <see cref="CardEffectInterpreter"/> / <see cref="CardOutcomeApplier"/>).
/// </summary>
public partial class CorroRulebook
{
	private CardDeck CreateShuffledDeck(IReadOnlyList<string> cardIds)
	{
		var shuffled = _random.Shuffle(cardIds).ToList();
		return new CardDeck
		{
			Cards = shuffled,
			HeldCards = new List<string>(),
			IsInitialized = true
		};
	}

	/// <summary>
	/// Resolve and apply a package deck card (a generic <see cref="CardEffect"/>) through the engine.
	/// The interpreter resolves the effect over the live board (from the drawer's position); the
	/// applier mutates via the shared card primitives, so any .corro deck plays.
	/// </summary>
	public Task ApplyPackageCardAsync(Player player, CardDef card, GameContext context)
	{
		var outcome = CardEffectInterpreter.Resolve(card.Effect, context.GameState.Squares, player.Position);
		return CardOutcomeApplier.ApplyAsync(outcome, player, new CardActions(), context);
	}

	/// <summary>Draw a card from the named package deck and apply its effect.</summary>
	public Task<CardDrawResult> DrawCardAsync(Player player, string deckType, GameContext context)
		=> DrawPackageCardAsync(player, deckType, context);

	/// <summary>
	/// Draw from a package deck: pick the top card, recycle it (or hold a "get out of holding" card),
	/// announce, and apply its effect via the generic interpreter/applier. No card classes.
	/// </summary>
	private async Task<CardDrawResult> DrawPackageCardAsync(Player player, string deckId, GameContext context)
	{
		var state = context.GameState;
		if (!state.PackageDecks.TryGetValue(deckId, out var deck) || !deck.IsInitialized)
		{
			var ids = (state.PackageCards ?? new List<CardDef>()).Where(c => c.Deck == deckId).Select(c => c.Id).ToList();
			deck = CreateShuffledDeck(ids);
			state.PackageDecks[deckId] = deck;
		}

		if (deck.Cards.Count == 0)
		{
			return new CardDrawResult { Success = false, Error = "DECK_EMPTY" };
		}

		var cardId = deck.Cards[0];
		deck.Cards.RemoveAt(0);
		var card = state.PackageCards?.FirstOrDefault(c => c.Id == cardId);
		if (card == null)
		{
			return new CardDrawResult { Success = false, Error = "UNKNOWN_CARD" };
		}

		// Hold a "get out of holding" card out of the pile (returned to the bottom when used); every
		// other card recycles to the bottom immediately.
		if (card.Effect.Type == "grantReleasePass")
		{
			deck.HeldCards.Add(cardId);
		}
		else
		{
			deck.Cards.Add(cardId);
		}

		await context.Announce("game.card_drawn", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "actorId", player.Id }
		});

		// The card's own text is the server's voice too (the client resolves the key against the
		// merged package i18n). Announced before the effect: "drew a card" -> "<card text>".
		if (!string.IsNullOrEmpty(card.TextKey))
		{
			await context.Announce(card.TextKey, new Dictionary<string, object> { ["actorId"] = player.Id });
		}

		// Reveal the card to clients BEFORE applying the effect, so the reveal is ordered right after
		// the "drew a card" line. The text travels as a key, resolved per-player on the client.
		await context.Presenter.NotifyCardDrawnAsync(new CardDrawnNotification
		{
			PlayerId = player.Id,
			PlayerName = player.Name,
			CardId = cardId,
			DeckType = deckId,
			Svg = card.Svg,
			ArtColor = card.ArtColor,
			ArtType = card.Effect.Type,
			DescriptionKey = card.TextKey ?? string.Empty
		});

		await ApplyPackageCardAsync(player, card, context);

		return new CardDrawResult { Success = true, CardId = cardId };
	}
}
