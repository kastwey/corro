using CorroServer.Models;

namespace CorroServer.Services.Commands;

/// <summary>
/// Client-facing notification sink the rulebook fires while resolving a command.
/// Bundles the presentation callbacks — full-state snapshots, single-square visual
/// refreshes and card reveals — into one cohesive abstraction so <see cref="GameContext"/>
/// does not keep growing an open-ended list of <c>Func&lt;&gt;</c> delegates.
/// <see cref="GameService"/> provides the live implementation; tests use a no-op or a
/// capturing fake.
/// </summary>
public interface IGamePresenter
{
	/// <summary>Pushes the full game-state snapshot to clients (and persists it).</summary>
	Task NotifyStateChangedAsync();

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

	/// <summary>Reveals a drawn Chance / Community card to clients.</summary>
	Task NotifyCardDrawnAsync(CardDrawnNotification notification);
}
