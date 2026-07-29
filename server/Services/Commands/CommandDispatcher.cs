using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Dispatches commands to their appropriate handlers.
/// This is the central point for command execution, following OCP.
/// </summary>
public class CommandDispatcher
{
	private readonly Dictionary<Type, Func<GameCommand, GameContext, Task<ServerResponse>>> _handlers = new();

	public CommandDispatcher(ICorroRulebook rulebook, IAuctionRulebook auctionRulebook)
	{
		// Register all command handlers
		RegisterHandler(new RollDiceHandler(rulebook));
		RegisterHandler(new BuyPropertyHandler(rulebook));
		RegisterHandler(new EndTurnHandler(rulebook));
		RegisterHandler(new GetMoneyHandler());
		RegisterHandler(new GetReleasePassesHandler());
		RegisterHandler(new AnnounceTurnHandler());
		RegisterHandler(new BusChoiceHandler(rulebook));

		RegisterHandler(new MoveRacePieceHandler());

		// Journey family handlers (draw → play/discard, coup fourré answer).
		RegisterHandler(new JourneyDrawHandler());
		RegisterHandler(new JourneyPlayHandler());
		RegisterHandler(new JourneyDiscardHandler());
		RegisterHandler(new JourneyCoupHandler());

		// Assembly family handlers (play/discard).
		RegisterHandler(new AssemblyPlayHandler());
		RegisterHandler(new AssemblyDiscardHandler());

		// Draft family handler (the simultaneous pick; reveal/pass/scoring cascade from it).
		RegisterHandler(new DraftPickHandler());

		// Shedding family handlers (play/draw/keep).
		RegisterHandler(new SheddingPlayHandler());
		RegisterHandler(new SheddingDrawHandler());
		RegisterHandler(new SheddingKeepHandler());
		RegisterHandler(new SheddingDeclareLastCardHandler());
		RegisterHandler(new SheddingCatchLastCardHandler());

		// Exploding family handlers (play an action → the Nope window).
		RegisterHandler(new ExplodingPlayHandler());
		RegisterHandler(new ExplodingNopeHandler());
		RegisterHandler(new ExplodingDrawHandler());
		RegisterHandler(new ExplodingDefuseHandler());
		RegisterHandler(new ExplodingGiveHandler());
		RegisterHandler(new ExplodingResolveWindowHandler());

		// Trivia family handlers (choose judge at start → move after a roll → answer → judge).
		// A dice roll dispatches through the family's ProcessRoll, so no roll handler is needed.
		RegisterHandler(new TriviaChooseJudgeHandler());
		RegisterHandler(new TriviaMoveHandler());
		RegisterHandler(new TriviaAnswerHandler());
		RegisterHandler(new TriviaJudgeHandler());

		// Forbidden family: the clue-giver starts and resolves cards, the opposing monitor may
		// flag a violation, and the server clock ends the turn.
		RegisterHandler(new ForbiddenStartHandler());
		RegisterHandler(new ForbiddenCorrectHandler());
		RegisterHandler(new ForbiddenPassHandler());
		RegisterHandler(new ForbiddenViolationHandler());
		RegisterHandler(new ForbiddenExpireTurnHandler());

		// Holding handlers
		RegisterHandler(new PayReleaseCostHandler(rulebook));
		RegisterHandler(new UseReleasePassHandler(rulebook));

		// Auction handlers
		RegisterHandler(new PlaceBidHandler(auctionRulebook));
		RegisterHandler(new PassAuctionHandler(auctionRulebook));
		RegisterHandler(new EndAuctionHandler(auctionRulebook));

		// Property management handlers
		RegisterHandler(new MortgagePropertyHandler(rulebook));
		RegisterHandler(new UnmortgagePropertyHandler(rulebook));
		RegisterHandler(new SellBuildingsHandler(rulebook));
		RegisterHandler(new BuildHandler(rulebook));

		// Debt & bankruptcy handlers
		RegisterHandler(new DeclareBankruptcyHandler(rulebook));
		RegisterHandler(new GetDebtStatusHandler(rulebook));
		RegisterHandler(new ResolveDebtHandler(rulebook));

		// Trade handlers
		RegisterHandler(new ProposeTradeHandler(rulebook));
		RegisterHandler(new RespondTradeHandler(rulebook));
		RegisterHandler(new CancelTradeHandler(rulebook));
	}

	/// <summary>
	/// Registers a command handler for a specific command type. The handler is wrapped
	/// in a typed delegate so dispatch needs no reflection.
	/// </summary>
	public void RegisterHandler<TCommand>(ICommandHandler<TCommand> handler) where TCommand : GameCommand
	{
		_handlers[typeof(TCommand)] = (command, context) => handler.HandleAsync((TCommand)command, context);
	}

	/// <summary>
	/// Server-authoritative turn guard. Turn-bound commands (<see cref="GameCommand.RequiresTurn"/>)
	/// may only be executed by the player whose turn it currently is. Returns the error code to
	/// reject the command with, or null when it is allowed to proceed. Pure so it can be unit-tested
	/// without constructing a dispatcher.
	/// </summary>
	public static string? CheckTurn(GameCommand command, string? currentTurn)
		=> command.RequiresTurn && command.PlayerId != currentTurn ? "NOT_YOUR_TURN" : null;

	/// <summary>
	/// Trade freeze guard. While a player-to-player trade is pending, every state-mutating
	/// command is rejected EXCEPT the trade response (accept / decline) and cancellation, which
	/// are the only ways to resolve it. Read-only queries (<see cref="GameCommand.MutatesState"/>
	/// false) keep working so players can still inspect the board. Returns the rejection error
	/// code, or null when the command may proceed. Pure for unit testing.
	/// </summary>
	public static string? CheckTradeFreeze(GameCommand command, GameState state)
	{
		if (state.ActiveTrade is not { IsActive: true })
		{
			return null;
		}

		if (command is RespondTradeCommand or CancelTradeCommand)
		{
			return null;
		}

		return command.MutatesState ? "TRADE_IN_PROGRESS" : null;
	}

	/// <summary>
	/// Auction freeze guard. While an auction is running the game is frozen the same way a trade
	/// freezes it: every state-mutating command is rejected EXCEPT the auction actions (bid / pass)
	/// and the auction-ending command — the bid timeout ends the auction through the dispatcher too,
	/// so <see cref="EndAuctionCommand"/> must stay allowed. Read-only queries keep working so
	/// players can still inspect the board. Without this the player who declined the purchase — who
	/// remains the current turn holder until the auction resolves — could roll again on doubles
	/// (playtest #9) or open a trade that then freezes everyone, including the auction's own bids
	/// (playtest #6). Returns the rejection error code, or null when the command may proceed. Pure
	/// for unit testing.
	/// </summary>
	public static string? CheckAuctionFreeze(GameCommand command, GameState state)
	{
		if (state.ActiveAuction is not { IsActive: true })
		{
			return null;
		}

		if (command is PlaceBidCommand or PassAuctionCommand or EndAuctionCommand)
		{
			return null;
		}

		return command.MutatesState ? "AUCTION_IN_PROGRESS" : null;
	}

	/// <summary>While a Bus choice is pending, only that answer and read-only queries may mutate.</summary>
	public static string? CheckBusChoiceFreeze(GameCommand command, GameState state)
	{
		if (state.PendingBusChoice is null || command is BusChoiceCommand)
		{
			return null;
		}

		return command.MutatesState ? "BUS_CHOICE_REQUIRED" : null;
	}

	/// <summary>
	/// The pre-dispatch gate, in order: turn ownership first (a turn-bound command from anyone
	/// but the current player never runs, whatever the client did), then the three freezes —
	/// while a trade, an auction or a Bus choice is pending, only the commands that RESOLVE it
	/// (plus read-only queries) may mutate. The auction freeze matters twice over: the player who
	/// declined the purchase is still the turn holder, so without it they could roll again on
	/// doubles (playtest #9) or open a trade that freezes the auction's own bids (playtest #6).
	/// Each check stays a pure static method, unit-tested without constructing a dispatcher.
	/// </summary>
	private static readonly (Func<GameCommand, GameState, string?> Check, string Message)[] Guards =
	{
		(CheckTradeFreeze, "A trade is in progress"),
		(CheckAuctionFreeze, "An auction is in progress"),
		(CheckBusChoiceFreeze, "A bonus-die movement choice is required"),
	};

	/// <summary>
	/// Dispatches a command to its handler and returns the response.
	/// </summary>
	public Task<ServerResponse> DispatchAsync(GameCommand command, GameContext context)
	{
		if (CheckTurn(command, context.Helper.GetCurrentTurn()) is { } turnError)
		{
			return Task.FromResult<ServerResponse>(new ErrorResponse
			{
				Message = "It is not your turn",
				Code = turnError
			});
		}

		foreach (var (check, message) in Guards)
		{
			if (check(command, context.GameState) is { } code)
			{
				return Task.FromResult<ServerResponse>(new ErrorResponse { Message = message, Code = code });
			}
		}

		if (!_handlers.TryGetValue(command.GetType(), out var handler))
		{
			return Task.FromResult<ServerResponse>(new ErrorResponse
			{
				Message = $"No handler registered for command type: {command.GetType().Name}",
				Code = "UNKNOWN_COMMAND"
			});
		}

		return handler(command, context);
	}

}
