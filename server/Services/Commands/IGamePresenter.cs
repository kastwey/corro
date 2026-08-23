using CorroServer.Models;

namespace CorroServer.Services.Commands;

/// <summary>
/// Client-facing notification sink the rulebook fires while resolving a command.
/// Bundles ordered state checkpoints, single-square visual refreshes and card reveals into
/// one cohesive abstraction so <see cref="GameContext"/> does not keep growing an open-ended
/// list of <c>Func&lt;&gt;</c> delegates. Normal full-state delivery belongs to the command host
/// after <c>GameService</c> has flushed the command's announcement batch; handlers cannot
/// bypass that ordering.
/// <see cref="GameService"/> provides the live implementation; tests use a no-op or a
/// capturing fake.
/// </summary>
public interface IGamePresenter
{
	/// <summary>
	/// Closes the current turn segment mid-command: flushes the announcements buffered so
	/// far as their own ordered batch, then pushes the current state snapshot. Lets a
	/// compound move (for example, a card with multiple paced stages) reach the
	/// client as discrete "move → consequence" segments instead of a single lump, so each
	/// token hop and its consequences play in sequence. The remainder of the command forms
	/// the next segment, flushed normally when the command ends.
	/// </summary>
	Task CheckpointTurnSegmentAsync();

	/// <summary>Notifies clients that a single square's visual state changed.</summary>
	Task NotifySquareChangedAsync(Square square);

	/// <summary>
	/// Sends one response to EVERY player, for something that happened to the table rather than
	/// to the caller. A command's own response is private unless it declares
	/// <see cref="ServerResponse.ReachesEveryPlayer"/>, which covers the common case: the thing
	/// that happened IS the answer to somebody's command. It cannot cover a side effect — an
	/// auction opening because a purchase was declined is not the decline, carries different
	/// facts, and concerns players who sent no command at all.
	///
	/// Written from the rulebook, where the side effect happens, so it travels the same way the
	/// voice and the state already do: through the game SERVICE, whose events the registry
	/// subscribes to. That is what makes it reach the table whoever ran the command — a person
	/// through the hub, or a bot through its driver.
	///
	/// It ships with the command's announcement batch, never before it: the ordering doctrine
	/// here is that the voice comes first, and a broadcast that opens a dialog would otherwise
	/// move focus across a narration still being spoken.
	/// </summary>
	Task BroadcastAsync(ServerResponse response);

	/// <summary>Reveals a drawn Chance / Community card to clients.</summary>
	Task NotifyCardDrawnAsync(CardDrawnNotification notification);
}
