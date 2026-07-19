using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Live-connection tracking: when a player's SignalR connection drops, the game marks them
/// disconnected, ANNOUNCES it (the server owns the spoken voice) and broadcasts fresh state;
/// an authenticated rejoin flips it back with a reconnection announcement. The initial join
/// must stay silent — the flag is already true, so there is nothing to announce.
/// </summary>
public class PlayerConnectionTests
{
	private static GameDefinition Corro()
		=> new CorroPackageLoader().LoadAsync(CorroTestPaths.FixtureDir("corro-classic"))
			.GetAwaiter().GetResult();

	private static List<Player> TwoPlayers() => new()
	{
		new() { Id = "a", Name = "Ana", Token = "disc" },
		new() { Id = "b", Name = "Bob", Token = "star" },
	};

	private static async Task<(GameService svc, List<AnnouncementDispatch> announced, int stateChanges)> StartedGameAsync()
	{
		var svc = new GameService(new CorroRulebook(), new AuctionRulebook());
		await svc.InitializeFromDefinitionAsync(TwoPlayers(), Corro(), "es");
		var announced = new List<AnnouncementDispatch>();
		svc.OnGameEvents += batch => { announced.AddRange(batch); return Task.CompletedTask; };
		return (svc, announced, 0);
	}

	[Fact]
	public async Task Disconnecting_flags_the_player_and_announces_it_to_everyone()
	{
		var (svc, announced, _) = await StartedGameAsync();
		var stateChanges = 0;
		svc.OnGameStateChanged += _ => { stateChanges++; return Task.CompletedTask; };

		await svc.SetPlayerConnectedAsync("b", connected: false);

		Assert.False(svc.GameState!.Players.First(p => p.Id == "b").IsConnected);
		// The actorId convention splits the announcement: everyone else hears the base line
		// (the actor's first-person copy goes to their — now dead — connection).
		var others = Assert.Single(announced, d => d.Audience == AnnouncementAudience.AllExcept);
		Assert.Equal("game.player_disconnected", others.Event.Key);
		Assert.Equal("Bob", others.Event.Vars["player"]);
		Assert.Equal("b", others.Event.Vars["actorId"]);
		Assert.Equal(1, stateChanges); // panels refresh from the broadcast state
	}

	[Fact]
	public async Task Rejoining_flags_the_player_back_and_announces_the_reconnection()
	{
		var (svc, announced, _) = await StartedGameAsync();
		await svc.SetPlayerConnectedAsync("b", connected: false);
		announced.Clear();

		await svc.SetPlayerConnectedAsync("b", connected: true);

		Assert.True(svc.GameState!.Players.First(p => p.Id == "b").IsConnected);
		// The returning player hears the first-person line; everyone else the base one.
		var self = Assert.Single(announced, d => d.Audience == AnnouncementAudience.Player);
		Assert.Equal("game.player_reconnected_self", self.Event.Key);
		Assert.Equal("b", self.PlayerId);
		var others = Assert.Single(announced, d => d.Audience == AnnouncementAudience.AllExcept);
		Assert.Equal("game.player_reconnected", others.Event.Key);
		Assert.Equal("Bob", others.Event.Vars["player"]);
	}

	[Fact]
	public async Task The_initial_join_is_silent_because_nothing_changed()
	{
		// JoinGameWithAuth calls SetPlayerConnectedAsync(true) on EVERY authenticated join;
		// the first one must not announce a fake "reconnected" (the flag is already true).
		var (svc, announced, _) = await StartedGameAsync();

		await svc.SetPlayerConnectedAsync("a", connected: true);

		Assert.Empty(announced);
	}

	[Fact]
	public async Task Repeated_disconnects_announce_only_once()
	{
		var (svc, announced, _) = await StartedGameAsync();

		await svc.SetPlayerConnectedAsync("b", connected: false);
		await svc.SetPlayerConnectedAsync("b", connected: false);

		Assert.Single(announced, d => d.Audience == AnnouncementAudience.AllExcept);
	}

	[Fact]
	public async Task An_unknown_player_is_ignored()
	{
		var (svc, announced, _) = await StartedGameAsync();

		await svc.SetPlayerConnectedAsync("ghost", connected: false);

		Assert.Empty(announced);
	}

	[Fact]
	public async Task Players_start_connected()
	{
		var (svc, _, _) = await StartedGameAsync();
		Assert.All(svc.GameState!.Players, p => Assert.True(p.IsConnected));
	}
}
