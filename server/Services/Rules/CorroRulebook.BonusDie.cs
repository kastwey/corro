using CorroServer.Models;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Rules;

/// <summary>Optional property-family bonus die: numbered movement, Bus choice and Express advance.</summary>
public partial class CorroRulebook
{
	public async Task<DiceRollOutcome> ProcessBusChoiceAsync(
		Player player,
		string choice,
		GameContext context)
	{
		var pending = context.GameState.PendingBusChoice;
		if (pending is null || pending.PlayerId != player.Id)
		{
			throw new InvalidOperationException("No pending Bus choice for this player");
		}

		var movement = choice switch
		{
			"die1" => pending.Die1,
			"die2" => pending.Die2,
			"both" => pending.Die1 + pending.Die2,
			_ => throw new ArgumentOutOfRangeException(nameof(choice)),
		};
		context.GameState.PendingBusChoice = null;

		await context.Announcer.Announce("game.bus_moving", new Dictionary<string, object>
		{
			["player"] = player.Name,
			["total"] = movement,
			["actorId"] = player.Id,
		}, AnnouncementPhase.Move);

		var oldPosition = player.Position;
		await MovePlayerAsync(player, movement, context);
		context.LastDiceTotal = pending.Die1 + pending.Die2;
		await ProcessLandingEffectsAsync(player, player.Position, context);
		var landing = AnalyzeLanding(player.Position, player.Id, context);
		var (nextId, nextName) = await HandleTurnProgressionAsync(
			player, pending.Die1 == pending.Die2, context);
		var (squareName, price, canBuy, canAfford) = ResolvePurchaseResponse(landing, player.Id, context);

		return new DiceRollOutcome
		{
			Die1 = pending.Die1,
			Die2 = pending.Die2,
			Total = movement,
			IsDoubles = pending.Die1 == pending.Die2,
			FromPosition = oldPosition,
			ToPosition = player.Position,
			NextPlayerId = nextId,
			NextPlayerName = nextName,
			SquareName = squareName,
			SquarePrice = price,
			CanBuySquare = canBuy,
			CanAfford = canAfford,
			BonusDie = BonusDieFace.Bus,
			BonusDieValue = 0,
		};
	}

	private async Task<DiceRollOutcome> SetupBusChoiceAsync(
		Player player,
		DiceResult dice,
		GameContext context)
	{
		var squares = context.Helper.GetSquares();
		Square? At(int spaces)
		{
			if (squares.Count == 0)
			{
				return null;
			}
			var position = ((player.Position + spaces) % squares.Count + squares.Count) % squares.Count;
			return squares[position];
		}

		var destination1 = At(dice.Die1);
		var destination2 = At(dice.Die2);
		var destinationBoth = At(dice.StandardTotal);
		context.LastDiceTotal = dice.StandardTotal;

		int? RentAt(Square? square)
		{
			if (square?.OwnerId is null || square.OwnerId == player.Id || square.Mortgaged)
			{
				return null;
			}
			var landlord = context.Helper.GetPlayer(square.OwnerId);
			if (landlord is null || landlord.Status != PlayerStatus.Active)
			{
				return null;
			}
			var rent = CalculateRent(square, landlord, context);
			return rent > 0 ? rent : null;
		}

		var rent1 = RentAt(destination1);
		var rent2 = RentAt(destination2);
		var rentBoth = RentAt(destinationBoth);
		context.GameState.PendingBusChoice = new PendingBusChoice
		{
			PlayerId = player.Id,
			Die1 = dice.Die1,
			Die2 = dice.Die2,
			FromPosition = player.Position,
			RentDie1 = rent1,
			RentDie2 = rent2,
			RentBoth = rentBoth,
		};

		static string GroupKey(Square? square) => square?.GroupNameKey ?? string.Empty;
		static string Context(Square? square) => string.IsNullOrEmpty(GroupKey(square)) ? string.Empty : "colored";
		static object Name(Square? square) => square is null ? string.Empty : AnnouncementVariables.SquareName(square);

		await context.Announcer.ToAllExcept(player.Id, "game.bus_rolled_other", new Dictionary<string, object>
		{
			["player"] = player.Name,
		});
		await context.Announcer.ToPlayer(player.Id, "game.bus_choice_required", new Dictionary<string, object>
		{
			["die1"] = dice.Die1,
			["die2"] = dice.Die2,
			["both"] = dice.StandardTotal,
			["square1"] = Name(destination1),
			["square2"] = Name(destination2),
			["squareBoth"] = Name(destinationBoth),
			["colorKey1"] = GroupKey(destination1),
			["colorKey2"] = GroupKey(destination2),
			["colorKeyBoth"] = GroupKey(destinationBoth),
			["ctx1"] = Context(destination1),
			["ctx2"] = Context(destination2),
			["ctxBoth"] = Context(destinationBoth),
		});

		return new DiceRollOutcome
		{
			Die1 = dice.Die1,
			Die2 = dice.Die2,
			Total = dice.StandardTotal,
			IsDoubles = dice.IsDoubles,
			FromPosition = player.Position,
			ToPosition = player.Position,
			BonusDie = BonusDieFace.Bus,
			BonusDieValue = 0,
			RequiresBusChoice = true,
			BusDestinationDie1Name = destination1?.Name,
			BusDestinationDie2Name = destination2?.Name,
			BusDestinationBothName = destinationBoth?.Name,
			BusDestinationDie1ColorKey = GroupKey(destination1),
			BusDestinationDie2ColorKey = GroupKey(destination2),
			BusDestinationBothColorKey = GroupKey(destinationBoth),
			BusDestinationDie1Rent = rent1,
			BusDestinationDie2Rent = rent2,
			BusDestinationBothRent = rentBoth,
		};
	}

	public async Task ResolveDeferredExpressMoveAsync(GameContext context)
	{
		var pending = context.GameState.PendingExpressMove;
		if (pending is null
			|| context.GameState.PendingPurchase is not null
			|| context.GameState.ActiveAuction is not null)
		{
			return;
		}

		context.GameState.PendingExpressMove = null;
		if (context.Helper.GetPlayer(pending.PlayerId) is { } player && !player.IsHeld)
		{
			await ExecuteExpressMoveAsync(player, context);
		}
	}

	private async Task<(int position, Square square)?> ExecuteExpressMoveAsync(
		Player player,
		GameContext context)
	{
		var destination = FindExpressDestination(player.Position, player.Id, context);
		if (destination is null)
		{
			return null;
		}

		await context.Presenter.CheckpointTurnSegmentAsync();
		var fromPosition = player.Position;
		player.Position = destination.Value.position;
		await context.Announcer.Announce("game.express_move", new Dictionary<string, object>
		{
			["player"] = player.Name,
			["property"] = AnnouncementVariables.SquareName(destination.Value.square),
			["actorId"] = player.Id,
		}, AnnouncementPhase.Move);
		await GoBonusRules.AwardForMoveAsync(
			player, fromPosition, destination.Value.position, doubleOnLanding: false, context);
		await ProcessLandingEffectsAsync(player, destination.Value.position, context);
		return destination;
	}

	private static (int position, Square square)? FindExpressDestination(
		int currentPosition,
		string playerId,
		GameContext context)
	{
		var squares = context.Helper.GetSquares();
		for (var step = 1; step < squares.Count; step++)
		{
			var position = (currentPosition + step) % squares.Count;
			var square = squares[position];
			if (square.Price.HasValue && string.IsNullOrEmpty(square.OwnerId))
			{
				return (position, square);
			}
		}
		for (var step = 1; step < squares.Count; step++)
		{
			var position = (currentPosition + step) % squares.Count;
			var square = squares[position];
			if (square.Price.HasValue
				&& !string.IsNullOrEmpty(square.OwnerId)
				&& square.OwnerId != playerId
				&& !square.Mortgaged)
			{
				return (position, square);
			}
		}
		return null;
	}
}
