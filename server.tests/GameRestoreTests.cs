using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Regression tests for resuming a persisted game after a server restart.
///
/// Bug: when the server restarted and a player rejoined, the restore path rebuilt a
/// brand-new game — every player snapped back to GO with the starting money and no
/// properties, even though the full state had been faithfully persisted to Cosmos. The
/// fix adds <see cref="GameService.RestoreGameAsync"/>, which adopts the saved snapshot verbatim.
/// </summary>
public class GameRestoreTests
{
	private static GameService NewService() => new(
		new CorroRulebook(),
		new AuctionRulebook());

	private static GameDefinition Corro()
		=> new CorroPackageLoader().LoadAsync(CorroTestPaths.FixtureDir("corro-classic"))
			.GetAwaiter().GetResult();

	private static GameState SavedState()
	{
		var alice = new Player { Id = "alice", Name = "Alice", Token = "disc", Position = 24, Money = 870, Properties = new List<int> { 1, 3 }, ReleasePasses = 1 };
		var bob = new Player { Id = "bob", Name = "Bob", Token = "star", Position = 11, Money = 1320, Properties = new List<int> { 5 } };
		return new GameState
		{
			Players = new List<Player> { alice, bob },
			CurrentTurn = "bob",
			HasRolledThisTurn = true,
			Bank = new BankInfo { Money = 4321 },
			Squares = new List<Square>
			{
				new() { Id = 0, Name = "Go" },
				new() { Id = 1, Name = "Old Kent Road", OwnerId = "alice", SmallBuildings = 2 },
				new() { Id = 3, Name = "Whitechapel Road", OwnerId = "alice", Mortgaged = true },
				new() { Id = 5, Name = "Station", OwnerId = "bob" },
			}
		};
	}

	[Fact]
	public async Task RestoreGameAsync_adopts_the_saved_snapshot_verbatim()
	{
		var service = NewService();
		var saved = SavedState();

		await service.RestoreGameAsync(saved);

		Assert.True(service.IsGameActive);
		var state = service.GameState!;
		// Same object: positions, money, properties, release passes, current turn, bank.
		Assert.Same(saved, state);
		Assert.Equal("bob", state.CurrentTurn);
		Assert.True(state.HasRolledThisTurn);
		Assert.Equal(4321, state.Bank.Money);

		var alice = state.Players.Single(p => p.Id == "alice");
		Assert.Equal(24, alice.Position);
		Assert.Equal(870, alice.Money);
		Assert.Equal(new[] { 1, 3 }, alice.Properties);
		Assert.Equal(1, alice.ReleasePasses);

		// Square ownership / buildings / mortgages survive the restore.
		Assert.Equal("alice", state.Squares.Single(s => s.Id == 1).OwnerId);
		Assert.Equal(2, state.Squares.Single(s => s.Id == 1).SmallBuildings);
		Assert.True(state.Squares.Single(s => s.Id == 3).Mortgaged);
		Assert.Equal("bob", state.Squares.Single(s => s.Id == 5).OwnerId);
	}

	[Fact]
	public async Task RestoreGameAsync_does_not_announce_a_new_game()
	{
		var service = NewService();
		var announcements = new List<string>();
		service.OnGameEvents += dispatches =>
		{
			announcements.AddRange(dispatches.Select(d => d.Event.Key));
			return Task.CompletedTask;
		};

		await service.RestoreGameAsync(SavedState());

		// Initializing a fresh game announces "game.game_started"; a restore must stay silent.
		Assert.DoesNotContain("game.game_started", announcements);
	}

	[Fact]
	public async Task RestoreGameAsync_throws_when_a_game_is_already_active()
	{
		var service = NewService();
		await service.RestoreGameAsync(SavedState());

		await Assert.ThrowsAsync<InvalidOperationException>(() => service.RestoreGameAsync(SavedState()));
	}

	[Fact]
	public async Task RestoreGameAsync_throws_on_null_state()
	{
		var service = NewService();
		await Assert.ThrowsAsync<ArgumentNullException>(() => service.RestoreGameAsync(null!));
	}

	[Theory]
	[InlineData(true)]
	[InlineData(false)]
	public async Task Initializing_a_game_exposes_the_FreeParkingJackpot_rule_on_the_bank(bool enabled)
	{
		// The client reads bank.freeParkingJackpot to decide whether to show the centre pot,
		// so initialising a game must copy the configured smallBuilding rule onto the bank.
		var service = NewService();

		await service.InitializeFromDefinitionAsync(
			new List<Player> { new() { Id = "a", Name = "Ann", Token = "disc" } },
			Corro(), "es",
			settings: new GameSettings { FreeParkingJackpot = enabled });

		Assert.Equal(enabled, service.GameState!.Bank.FreeParkingJackpot);
	}
}
