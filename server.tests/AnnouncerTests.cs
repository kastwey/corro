using CorroServer.Models;
using CorroServer.Services;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Tests for the announcer personalization convention: an "actorId" var routes the
/// first-person "_self" variant to the actor and the third-person base to everyone
/// else; without it, the announcement goes to all.
/// </summary>
public class AnnouncerTests
{
	[Fact]
	public async Task Announce_WithActorId_SplitsSelfToActor_AndBaseToOthers()
	{
		var announcer = new TestFixtures.FakeAnnouncer();

		await announcer.Announce("game.bought_property", new Dictionary<string, object>
		{
			["player"] = "Ana",
			["actorId"] = "ana"
		});

		Assert.True(announcer.Has(AnnouncementAudience.Player, "ana", "game.bought_property_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "ana", "game.bought_property"));
		Assert.Equal(2, announcer.Sent.Count);
	}

	[Fact]
	public async Task Announce_WithoutActorId_GoesToAll()
	{
		var announcer = new TestFixtures.FakeAnnouncer();

		await announcer.Announce("game.game_ended", null);

		Assert.True(announcer.Has(AnnouncementAudience.All, null, "game.game_ended"));
		Assert.Single(announcer.Sent);
	}

	[Fact]
	public async Task Announce_WithEmptyActorId_GoesToAll()
	{
		var announcer = new TestFixtures.FakeAnnouncer();

		await announcer.Announce("game.something", new Dictionary<string, object> { ["actorId"] = "" });

		Assert.True(announcer.Has(AnnouncementAudience.All, null, "game.something"));
		Assert.Single(announcer.Sent);
	}

	[Fact]
	public async Task Announce_DefaultsToResolvePhase()
	{
		var announcer = new TestFixtures.FakeAnnouncer();

		await announcer.Announce("game.paid_rent", new Dictionary<string, object>());

		Assert.All(announcer.Sent, a => Assert.Equal(AnnouncementPhase.Resolve, a.Phase));
	}

	[Fact]
	public async Task Announce_PropagatesPhase_ToBothSelfAndBaseVariants()
	{
		var announcer = new TestFixtures.FakeAnnouncer();

		await announcer.Announce("game.dice_rolled", new Dictionary<string, object>
		{
			["actorId"] = "ana"
		}, AnnouncementPhase.Move);

		var self = announcer.Sent.Single(a => a.Key == "game.dice_rolled_self");
		var others = announcer.Sent.Single(a => a.Key == "game.dice_rolled");
		Assert.Equal(AnnouncementPhase.Move, self.Phase);
		Assert.Equal(AnnouncementPhase.Move, others.Phase);
	}
}
