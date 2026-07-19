using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;
using CorroServer.Services.Corro.Families;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Hidden-information plumbing: families that hide nothing keep the historical whole-state
/// broadcast (identity projection, one group send), while a hiding family fans the state out
/// per player — each connection gets THAT player's projection and unauthenticated connections
/// get nothing. Persistence is out of scope here on purpose: it always stores the full state.
/// </summary>
public class GameStateProjectionTests
{
	[Theory]
	[InlineData("property")]
	[InlineData("race")]
	[InlineData("track")]
	public void Shipped_families_hide_nothing_and_project_identity(string gameType)
	{
		var family = GameFamilies.For(gameType);
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("p1") });

		Assert.False(family.HasHiddenInformation);
		// The SAME instance goes out: no copy, no field left behind by a partial clone.
		Assert.Same(state, family.ProjectFor(state, "p1"));
		Assert.Same(state, family.ProjectFor(state, null));
		// And the fanout planner tells the caller to keep the single group broadcast.
		Assert.Null(GameStateFanout.PlanPerPlayer(state, family, _ => new[] { "c1" }));
	}

	[Fact]
	public void A_hiding_family_sends_each_connected_player_their_own_projection()
	{
		var state = TestFixtures.NewState(new[]
		{
			TestFixtures.NewPlayer("p1"), TestFixtures.NewPlayer("p2"), TestFixtures.NewPlayer("p3"),
		});
		var connections = new Dictionary<string, string[]>
		{
			["p1"] = new[] { "c1a", "c1b" }, // two tabs
			["p2"] = System.Array.Empty<string>(), // disconnected: nothing is sent for them
			["p3"] = new[] { "c3" },
		};

		var sends = GameStateFanout.PlanPerPlayer(state, new HidingFamily(),
			pid => connections[pid]);

		Assert.NotNull(sends);
		Assert.Collection(sends!,
			s =>
			{
				Assert.Equal(new[] { "c1a", "c1b" }, s.ConnectionIds);
				Assert.Equal("projected-for:p1", s.State.CurrentTurn);
			},
			s =>
			{
				Assert.Equal(new[] { "c3" }, s.ConnectionIds);
				Assert.Equal("projected-for:p3", s.State.CurrentTurn);
			});
	}

	[Fact]
	public void Sanitized_documents_keep_an_open_familys_state_untouched()
	{
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("p1") });
		state.GameType = "race";
		var doc = new GameDocument
		{
			Id = "g1",
			GameId = "g1",
			Status = GameStatus.Active,
			HostId = "p1",
			InviteCode = "123456",
			GameState = state,
			Players = new List<LobbyPlayer>
			{
				new() { Id = "p1", Name = "Ana", Token = "disc", PlayerSecretId = "secret", RejoinCode = "ABCDEFGH" },
			},
		};

		var safe = doc.Sanitized();

		// Credentials always go; the embedded snapshot passes through IDENTICAL for a family
		// without hidden information (the public projection is the state itself).
		Assert.Equal("", safe.Players[0].PlayerSecretId);
		Assert.Null(safe.Players[0].RejoinCode);
		Assert.Same(state, safe.GameState);
	}

	/// <summary>A family that hides information: the projection marks who it was made for, so
	/// the tests can assert each connection got its owner's view.</summary>
	private sealed class HidingFamily : IGameFamily
	{
		public string GameType => "hiding-test";
		public bool HasHiddenInformation => true;

		public GameState ProjectFor(GameState state, string? playerId)
			=> new() { Players = state.Players, CurrentTurn = $"projected-for:{playerId ?? "public"}" };

		// Only the projection contract is under test; the rest of the family surface is unused.
		public Task<GameDefinition> LoadDefinitionAsync(string packageDir, Manifest manifest,
			Dictionary<string, Dictionary<string, string>> i18n) => throw new NotSupportedException();
		public void ValidateDefinition(GameDefinition definition) => throw new NotSupportedException();
		public FamilyGame CreateGame(FamilyStartContext start) => throw new NotSupportedException();
		public IFamilyRuntime? CreateRuntime(GameDefinition definition) => throw new NotSupportedException();
		public IFamilyRuntime? RuntimeFromState(GameState state) => throw new NotSupportedException();
		public Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context)
			=> throw new NotSupportedException();
	}
}
