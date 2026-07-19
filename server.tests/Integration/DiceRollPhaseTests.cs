using CorroServer.Models;
using Xunit;

namespace CorroServer.Tests.Integration;

/// <summary>
/// The dice roll is the CAUSE of a move, so it is announced with the <see cref="AnnouncementPhase.Move"/>
/// phase (the client speaks it immediately, starting the token hop). Everything that follows
/// from landing carries the default <see cref="AnnouncementPhase.Resolve"/> phase so the client
/// can hold it until the hop finishes. This protects that contract end-to-end through the rulebook.
/// </summary>
public class DiceRollPhaseTests
{
	[Fact]
	public async Task DiceRoll_IsAnnouncedWithMovePhase()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500, position: 0);
		var harness = new GameHarness(new[] { player }, TestFixtures.StandardBoard());

		await harness.RollAsync("a", die1: 2, die2: 3);

		var diceLines = harness.Announcer.Sent.Where(s => s.Key.StartsWith("game.dice_rolled")).ToList();
		Assert.NotEmpty(diceLines);
		Assert.All(diceLines, s => Assert.Equal(AnnouncementPhase.Move, s.Phase));
	}

	[Fact]
	public async Task LandingConsequences_AreAnnouncedWithResolvePhase()
	{
		var player = TestFixtures.NewPlayer("a", money: 1500, position: 0);
		var harness = new GameHarness(new[] { player }, TestFixtures.StandardBoard());

		await harness.RollAsync("a", die1: 2, die2: 3);

		// Every non-dice line a roll produces (landing, purchase offer, turn progression…)
		// stays in the default Resolve phase so the client paces it to the token hop.
		var consequences = harness.Announcer.Sent.Where(s => !s.Key.StartsWith("game.dice_rolled")).ToList();
		Assert.NotEmpty(consequences);
		Assert.All(consequences, s => Assert.Equal(AnnouncementPhase.Resolve, s.Phase));
	}
}
