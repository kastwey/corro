using CorroServer.Hubs;
using CorroServer.Models;

namespace CorroServer.Tests;

/// <summary>
/// Unit tests for <see cref="GameHub.RenderBatchForPlayer"/>, the pure function that turns
/// one action's announcement batch into each player's personalized, ordered view. It is the
/// heart of the "single stream" transport: the actor must hear the first-person (_self)
/// lines and skip their third-person duplicates, while everyone else gets the opposite, and
/// "All" lines reach everybody — all in emission order.
/// </summary>
public class RenderBatchForPlayerTests
{
	private static AnnouncementDispatch All(string key) => new()
	{
		Event = new AnnouncementEvent { Key = key },
		Audience = AnnouncementAudience.All
	};

	private static AnnouncementDispatch ToPlayer(string player, string key) => new()
	{
		Event = new AnnouncementEvent { Key = key },
		Audience = AnnouncementAudience.Player,
		PlayerId = player
	};

	private static AnnouncementDispatch ToAllExcept(string player, string key) => new()
	{
		Event = new AnnouncementEvent { Key = key },
		Audience = AnnouncementAudience.AllExcept,
		PlayerId = player
	};

	[Fact]
	public void AllAudience_ReachesEveryone()
	{
		var batch = new[] { All("game.dice_rolled") };

		Assert.Equal(new[] { "game.dice_rolled" }, GameHub.RenderBatchForPlayer(batch, "a").Select(e => e.Key));
		Assert.Equal(new[] { "game.dice_rolled" }, GameHub.RenderBatchForPlayer(batch, "b").Select(e => e.Key));
	}

	[Fact]
	public void ActorSplit_ActorGetsSelf_OthersGetBase()
	{
		// The actorId convention produces this pair per announcement.
		var batch = new[]
		{
			ToPlayer("a", "game.rent_paid_self"),
			ToAllExcept("a", "game.rent_paid")
		};

		Assert.Equal(new[] { "game.rent_paid_self" }, GameHub.RenderBatchForPlayer(batch, "a").Select(e => e.Key));
		Assert.Equal(new[] { "game.rent_paid" }, GameHub.RenderBatchForPlayer(batch, "b").Select(e => e.Key));
	}

	[Fact]
	public void PreservesEmissionOrder_AcrossMixedAudiences()
	{
		var batch = new[]
		{
			All("game.dice_rolled"),
			ToPlayer("a", "game.landed_on_property_self"),
			ToAllExcept("a", "game.landed_on_property"),
			All("game.property_available")
		};

		Assert.Equal(
			new[] { "game.dice_rolled", "game.landed_on_property_self", "game.property_available" },
			GameHub.RenderBatchForPlayer(batch, "a").Select(e => e.Key));

		Assert.Equal(
			new[] { "game.dice_rolled", "game.landed_on_property", "game.property_available" },
			GameHub.RenderBatchForPlayer(batch, "b").Select(e => e.Key));
	}

	[Fact]
	public void EmptyBatch_YieldsNothing()
	{
		Assert.Empty(GameHub.RenderBatchForPlayer(System.Array.Empty<AnnouncementDispatch>(), "a"));
	}
}
