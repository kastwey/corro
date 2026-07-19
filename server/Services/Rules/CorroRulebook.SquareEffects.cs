using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

/// <summary>
/// CorroRulebook - SQUARE EFFECTS
/// 
/// What happens when landing on different square types:
/// - Tax squares: Pay tax to Free Parking pot
/// - Fortune/Treasury: Draw a card
/// - Go To Holding: Go directly to holding
/// - Free Parking: Collect the pot
/// - Just Visiting: Nothing happens
/// </summary>
public partial class CorroRulebook
{
	// ============================================================
	// SECTION: LANDING EFFECTS (Main dispatcher)
	// ============================================================

	public async Task ProcessLandingEffectsAsync(Player player, int squareIndex, GameContext context)
	{
		var square = context.Helper.GetSquare(squareIndex);
		if (square == null)
		{
			return;
		}

		var behavior = ResolveLandingBehavior(square);

		// A failing square effect must never abort the dice roll, otherwise turn
		// progression would freeze and the player could roll forever. Log and continue.
		try
		{
			await (behavior switch
			{
				"ownable" => ProcessPropertyLandingAsync(player, square, context),
				"drawCard" => ProcessDrawCardLandingAsync(player, square, context),
				"tax" => ProcessTaxAsync(player, square, context),
				"sendToHolding" => ProcessSendToHoldingAsync(player, context),
				"freeParking" => ProcessFreeParkingAsync(player, context),
				"justVisiting" => ProcessJustVisitingAsync(player, context),
				_ => Task.CompletedTask, // "start" / idle: the GO bonus is handled during movement
			});
		}
		catch (Exception ex)
		{
			context.Logger?.LogError(ex, "Landing effect failed on square {SquareIndex} (behaviour {Behavior}); continuing the turn", squareIndex, behavior);
		}
	}

	/// <summary>
	/// The generic landing behaviour for a square: the explicit <see cref="Square.Behavior"/> when
	/// the board declares one, otherwise derived from the classic Type/Key so existing boards need
	/// no data changes. "property/railroad/utility" all collapse to one "ownable" behaviour;
	/// "chance/community" to "drawCard"; each corner Key becomes its own behaviour.
	/// </summary>
	private static string ResolveLandingBehavior(Square square)
	{
		if (!string.IsNullOrEmpty(square.Behavior))
		{
			return square.Behavior;
		}

		return (square.Type?.ToLower() ?? "") switch
		{
			"property" or "railroad" or "utility" => "ownable",
			"chance" or "community" => "drawCard",
			"tax" => "tax",
			"corner" => (square.Key?.ToLower() ?? "") switch
			{
				"goto_holding" => "sendToHolding",
				"free_parking" => "freeParking",
				"holding" => "justVisiting",
				_ => "start", // "go" and anything else: no landing effect
			},
			_ => "start",
		};
	}

	// ============================================================
	// SECTION: CARD DECKS
	// ============================================================

	private async Task ProcessDrawCardLandingAsync(Player player, Square square, GameContext context)
	{
		// The deck a card square draws from (the board names its own decks). The landing line is
		// generic — the engine privileges no specific deck; the deck's own name is shown on the card.
		var deck = (square.Deck ?? square.Type)?.ToLower() ?? "";
		await context.Announce("game.landed_on_card", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "actorId", player.Id }
		});

		// Auto-draw the card and execute its effect. The draw notifies clients (for the visual
		// card reveal) and announces its own effect.
		await DrawCardAsync(player, deck, context);
	}

	// ============================================================
	// SECTION: PROPERTY / RAILROAD / UTILITY
	// ============================================================

	/// <summary>
	/// Announces the property the player landed on (the client board no longer
	/// narrates the landing square), then resolves rent if it is owned by someone else.
	/// If the square is unowned and buyable, offers the purchase — this is the single
	/// place every landing path (dice, holding release, movement cards) offers a buy, so
	/// teleporting onto an unowned property via a card prompts the purchase too.
	/// </summary>
	private async Task ProcessPropertyLandingAsync(Player player, Square square, GameContext context)
	{
		// Colored streets announce their colour group so a screen-reader player knows
		// which set the square belongs to; railroads/utilities (no colour) use the plain line.
		// squareType lets the client pick a landing earcon by kind (e.g. the station cue on
		// railroads) without coupling the sound to the generic landing text.
		var squareType = square.Type?.ToLower() ?? "";
		if (!string.IsNullOrEmpty(square.GroupNameKey))
		{
			// Announce the group by its own name key (e.g. "game.color_brown" or a package's
			// "groups.utility"), which the client nests via $t. Passing the raw colour leaked
			// "game.color_#hex" for package boards, whose groups have no game.color_* key.
			await context.Announce("game.landed_on_property_colored", new Dictionary<string, object>
			{
				{ "player", player.Name },
				{ "square", SquareNameVar(square) },
				{ "colorKey", square.GroupNameKey! },
				{ "squareType", squareType },
				{ "actorId", player.Id }
			});
		}
		else
		{
			await context.Announce("game.landed_on_property", new Dictionary<string, object>
			{
				{ "player", player.Name },
				{ "square", SquareNameVar(square) },
				{ "squareType", squareType },
				{ "actorId", player.Id }
			});
		}

		if (square.OwnerId == player.Id)
		{
			await context.Announce("game.property_already_owned", new Dictionary<string, object>
			{
				{ "player", player.Name },
				{ "square", SquareNameVar(square) },
				{ "actorId", player.Id }
			});
		}

		await ProcessRentPaymentAsync(player, square, context);

		// Offer the purchase for an unowned, buyable square. Centralised here so it
		// fires for dice rolls, holding-release moves and movement cards alike.
		var landing = AnalyzeLanding(square.Id, player.Id, context);
		SetupPendingPurchaseIfNeeded(landing, player.Id, context);
		await AnnouncePurchaseAvailabilityAsync(player, landing, context);
	}

	// ============================================================
	// SECTION: TAX SQUARES
	// ============================================================

	private async Task ProcessTaxAsync(Player player, Square square, GameContext context)
	{
		var taxAmount = square.Amount ?? 200; // a tax square's sum lives in Amount (not Price)

		var (success, debtId) = context.Helper.TryPay(
			player.Id,
			null, // Bank
			taxAmount,
			DebtReason.Tax,
			square.Name
		);

		// Tax goes to Free Parking pot (smallBuilding rule, but common)
		if (success)
		{
			if (context.Settings.FreeParkingJackpot)
			{
				context.Helper.AddToFreeParkingPot(taxAmount);
			}

			await context.Announce("game.tax_paid", new Dictionary<string, object>
			{
				{ "player", player.Name },
				{ "square", SquareNameVar(square) },
				{ "amount", taxAmount },
				{ "actorId", player.Id }
			});
		}
		else
		{
			// Even when the tax pushes the player into debt, still tell them WHERE they
			// landed (the generic debt line alone hides the location).
			await context.Announce("game.tax_debt_created", new Dictionary<string, object>
			{
				{ "player", player.Name },
				{ "square", SquareNameVar(square) },
				{ "amount", taxAmount },
				{ "actorId", player.Id }
			});
		}
	}

	// ============================================================
	// SECTION: CORNER SQUARES
	// ============================================================

	private async Task ProcessSendToHoldingAsync(Player player, GameContext context)
	{
		await SendToHoldingAsync(player, context);
	}

	private async Task ProcessFreeParkingAsync(Player player, GameContext context)
	{
		// The Free Parking jackpot is a smallBuilding rule; when disabled the square does nothing.
		var pot = context.Settings.FreeParkingJackpot ? context.Helper.CollectFreeParkingPot() : 0;

		if (pot > 0)
		{
			context.Helper.AddPlayerMoney(player.Id, pot);

			await context.Announce("game.free_parking_collect", new Dictionary<string, object>
			{
				{ "player", player.Name },
				{ "amount", pot },
				{ "actorId", player.Id }
			});
		}
		else
		{
			await context.Announce("game.free_parking_empty", new Dictionary<string, object>
			{
				{ "player", player.Name },
				{ "actorId", player.Id }
			});
		}
	}

	private async Task ProcessJustVisitingAsync(Player player, GameContext context)
	{
		await context.Announce("game.visiting_holding", new Dictionary<string, object>
		{
			{ "player", player.Name },
			{ "actorId", player.Id }
		});
	}
}
