using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;

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
/// Context passed to command handlers containing all necessary dependencies.
/// This avoids passing multiple parameters and makes testing easier.
/// </summary>
public class GameContext
{
	public required GameState GameState { get; init; }
	public required GameStateHelper Helper { get; init; }
	public required GameSettings Settings { get; init; }

	/// <summary>
	/// The board's rent rules (per-type strategy + parameters). Defaults to the classic
	/// config; a loaded .corro package supplies its own. The rulebook reads rent strategies from
	/// here instead of hardcoding per-type formulas.
	/// </summary>
	public RulesConfig RentRules { get; init; } = RulesConfig.ClassicRules;

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

	/// <summary>
	/// Optional callback to process landing effects on a square. Wired by GameService
	/// so card effects (e.g. "go back 3 spaces") can trigger landing without a
	/// rulebook ↔ card dependency cycle. Null in tests / non-DI paths.
	/// </summary>
	public Func<Player, int, GameContext, Task>? ProcessLanding { get; init; }

	/// <summary>
	/// Transient rent adjustment for the landing currently being resolved. Set by
	/// movement cards (railway double, utility 10× dice) and cleared by them right
	/// after the landing resolves. Null for ordinary landings.
	/// </summary>
	public RentModifier? PendingRentModifier { get; set; }

	/// <summary>
	/// Total of the two white dice from the roll that produced the current landing.
	/// Used to compute utility rent (4× or 10× the throw). Set by the dice flow
	/// before resolving the landing; 0 when a landing isn't caused by a dice roll.
	/// </summary>
	public int LastDiceTotal { get; set; }
}
