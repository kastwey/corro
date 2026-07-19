using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Tests.Integration;

/// <summary>
/// A card-driven move must emit a MOVE-phase line for its
/// teleport segment so the client's
/// announcement gate arms and the action bar's deferred refresh waits for the token hop to settle.
/// Without it the segment applied un-paced, the refresh fired mid-hop and never re-fired, so End
/// Turn stayed hidden and the turn was stranded.
/// </summary>
public class CardMoveAnnouncementTests
{
	[Fact]
	public async Task MoveToSquare_CheckpointsTheSegment_AndAnnouncesAMovePhaseCardMove()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500, position: 20);
		var harness = new GameHarness(new[] { player }, TestFixtures.StandardBoard());
		var presenter = (TestFixtures.CapturingPresenter)harness.Context.Presenter;

		// "Advance to GO": the card teleports the player to square 0, collecting the GO salary.
		await new CardActions().MoveToSquareAsync(
			harness.Player("a"), targetPosition: 0, collectGoIfPassed: true, harness.Context);

		Assert.Equal(0, harness.Player("a").Position);
		// The card's move is its own turn segment (checkpoint), and the teleport is announced as a
		// MOVE phase (spoken at once, arming the client's gate) — not a resolve consequence held
		// back during the hop, which is what left the action bar frozen with no End Turn.
		Assert.Equal(1, presenter.CheckpointCount);
		var move = harness.Announcer.Sent.Single(s => s.Key == "game.card_move");
		Assert.Equal(AnnouncementPhase.Move, move.Phase);
		Assert.Equal("a", move.Vars["actorId"]);
	}
}
