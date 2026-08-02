using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using CorroServer.Services.Rules;

namespace CorroServer.Services.Commands;

/// <summary>
/// Interface for command handlers. Each command type has its own handler.
/// Following the Open/Closed Principle: new commands = new handlers, no modification to existing code.
/// </summary>
public interface ICommandHandler<TCommand> where TCommand : GameCommand
{
	Task<ServerResponse> HandleAsync(TCommand command, GameContext context);
}

/// <summary>
/// Base for the (large) majority of handlers, whose first act is always resolving the acting
/// player or returning PLAYER_NOT_FOUND. Subclasses receive the resolved <see cref="Player"/>
/// and are left with just "delegate to the flow, shape the response" — the guard is written
/// once here instead of at the top of every handler.
/// </summary>
public abstract class PlayerCommandHandler<TCommand> : ICommandHandler<TCommand> where TCommand : GameCommand
{
	public Task<ServerResponse> HandleAsync(TCommand command, GameContext context)
		=> context.RequirePlayer(command.PlayerId, out var player) is { } error
			? Task.FromResult<ServerResponse>(error)
			: HandleAsync(command, player, context);

	protected abstract Task<ServerResponse> HandleAsync(TCommand command, Player player, GameContext context);
}

/// <summary>
/// Context passed to command handlers containing all necessary dependencies.
/// This avoids passing multiple parameters and makes testing easier.
/// </summary>
public class GameContext
{
	public required GameState GameState { get; init; }
	public required GameStateHelper Helper { get; init; }
	public required GameSettings Settings { get; init; }

	/// <summary>
	/// The property family's own turn context — rent rules, the landing in flight, the callbacks
	/// that let a card trigger a landing. Every family gets one, but only property reads it: the
	/// nine other families' handlers see a context with none of it, which is the point of the
	/// separation. Grouped rather than spread across <see cref="GameContext"/> so "what does a
	/// shedding turn actually need?" has an honest answer.
	/// </summary>
	public PropertyTurnContext Property { get; init; } = new();

	/// <summary>
	/// The family's board + rules (e.g. <see cref="RaceRuntime"/>), published by the game's
	/// family at start / package re-attach. Null in the property family, whose board and rent
	/// rules travel in first-class slots (<see cref="GameState.Squares"/> / <see cref="RentRules"/>).
	/// Family handlers read it through <see cref="Family{T}"/>.
	/// </summary>
	public IFamilyRuntime? FamilyRuntime { get; init; }

	/// <summary>The family runtime, typed. Throws when the context doesn't carry that family's
	/// runtime — a family handler running outside its family is a programming error.</summary>
	public T Family<T>() where T : class, IFamilyRuntime
		=> FamilyRuntime as T
			?? throw new InvalidOperationException($"{typeof(T).Name} missing from context");

	/// <summary>
	/// The game's randomness (shuffles, reshuffled discards). Every family draws from the SAME
	/// source, which is what keeps the E2E environment deterministic: its scripted source
	/// shuffles as the identity, so decks stay in cards.json order there. Carried here rather
	/// than reached through the property rulebook, so a card family needs nothing from property.
	/// </summary>
	public required IRandomSource Random { get; init; }

	public required Func<string, Dictionary<string, object>?, Task> Announce { get; init; }

	/// <summary>
	/// Client-facing notification sink (state snapshots, single-square refreshes, card
	/// reveals). Replaces the previous scattered notify callbacks. Wired by GameService.
	/// </summary>
	public required IGamePresenter Presenter { get; init; }

	/// <summary>
	/// The game's announcer (spoken voice). <see cref="Announce"/> is kept as
	/// convenience sugar over <see cref="IGameAnnouncer.ToAll"/>; new code can use
	/// the announcer directly for targeted variants.
	/// </summary>
	public required IGameAnnouncer Announcer { get; init; }

	/// <summary>
	/// Optional logger for handlers and rulebooks. Null in tests / non-DI paths.
	/// </summary>
	public ILogger? Logger { get; init; }
}

/// <summary>
/// The property family's slice of a command's context: the board's economy, plus the two callbacks
/// that break the rulebook to cards and auction to property dependency cycles. Mutable where a
/// landing is resolved in steps; the rest is fixed for the game.
///
/// Grouped here rather than spread across <see cref="GameContext"/> so that "what does a shedding
/// turn actually need?" has an honest answer — nine of the ten families never open this.
/// </summary>
public sealed class PropertyTurnContext
{
	/// <summary>
	/// The board's rent rules (per-type strategy + parameters). Defaults to the classic config; a
	/// loaded .corro package supplies its own, so the rulebook reads strategies from here instead
	/// of hardcoding per-type formulas.
	/// </summary>
	public RulesConfig RentRules { get; init; } = RulesConfig.ClassicRules;

	/// <summary>
	/// Processes landing effects on a square. Wired by GameService so a card effect ("go back 3
	/// spaces") can trigger a landing without a rulebook to card dependency cycle. Null in tests.
	/// </summary>
	public Func<Player, int, GameContext, Task>? ProcessLanding { get; init; }

	/// <summary>
	/// Completes a deferred Express move once a purchase or auction resolves. Wired by GameService
	/// so the auction rulebook need not depend on the property rulebook.
	/// </summary>
	public Func<GameContext, Task>? ResolveDeferredExpressMove { get; init; }

	/// <summary>
	/// Transient rent adjustment for the landing being resolved right now. Set by movement cards
	/// (railway double, utility 10x dice) and cleared by them once the landing settles; null for
	/// an ordinary landing.
	/// </summary>
	public RentModifier? PendingRentModifier { get; set; }

	/// <summary>
	/// Total of the two white dice from the roll that caused the current landing, for utility rent
	/// (4x or 10x the throw). Zero when a landing was not caused by a roll.
	/// </summary>
	public int LastDiceTotal { get; set; }
}
