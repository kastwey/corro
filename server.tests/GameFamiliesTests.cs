using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The family registry is the single dispatch point for load/validate/start/restore/roll:
/// these pin its lookup contract (exact + case-insensitive match, property fallback) and the
/// supported-types list the package validator reports to authors.
/// </summary>
public class GameFamiliesTests
{
	[Theory]
	[InlineData("property", typeof(PropertyFamily))]
	[InlineData("race", typeof(RaceFamily))]
	[InlineData("track", typeof(TrackFamily))]
	[InlineData("journey", typeof(JourneyFamily))]
	[InlineData("exploding", typeof(ExplodingFamily))]
	[InlineData("Race", typeof(RaceFamily))] // manifest gameType is case-insensitive, like before
	public void For_resolves_each_family(string gameType, System.Type expected)
		=> Assert.IsType(expected, GameFamilies.For(gameType));

	[Theory]
	[InlineData(null)]
	[InlineData("")]
	[InlineData("deckbuilder")]
	public void For_falls_back_to_property_for_missing_or_unknown_types(string? gameType)
		// The loader's historical default: the content validator reports the unsupported type,
		// but the loader itself reads the board with the property shape.
		=> Assert.IsType<PropertyFamily>(GameFamilies.For(gameType));

	[Fact]
	public void Supported_types_list_the_registered_families_in_order()
		// The validator's "supported: …" message uses this order — keep it stable.
		=> Assert.Equal(new[] { "property", "race", "track", "journey", "assembly", "draft", "shedding", "exploding", "trivia" }, GameFamilies.SupportedTypes);

	[Theory]
	[InlineData("property", true)]
	[InlineData("TRACK", true)]
	[InlineData("deckbuilder", false)]
	public void IsSupported_matches_case_insensitively(string gameType, bool expected)
		=> Assert.Equal(expected, GameFamilies.IsSupported(gameType));

	[Fact]
	public void Only_race_and_track_own_their_dice_flow()
	{
		// The property family must return null so RollDiceHandler runs the shared two-dice flow;
		// a non-null here would silently skip the debt/holding/doubles guards.
		var player = TestFixtures.NewPlayer("p1");
		var context = TestFixtures.NewContext(TestFixtures.NewState(new[] { player }));
		Assert.Null(new PropertyFamily().ProcessRoll(() => 1, player, context));
	}

	// The rules now ride the state (public config for the active-rules dialog), and the restore
	// path reads them back instead of falling to defaults — so a non-default board plays the same
	// after a server restart.
	[Fact]
	public void Race_runtime_reads_the_rules_off_the_state_on_restore()
	{
		var board = new RaceBoardDef
		{
			CircuitLength = 12,
			CorridorLength = 4,
			PiecesPerPlayer = 2,
			SafeSquares = new(),
			Seats = new(),
		};
		var state = new GameState { GameType = "race", RaceBoard = board, RaceRules = new RaceRulesConfig { ExitOn = 3 } };
		var runtime = (RaceRuntime)new RaceFamily().RuntimeFromState(state)!;
		Assert.Equal(3, runtime.Rules.ExitOn);
	}

	[Fact]
	public void Track_runtime_reads_the_rules_off_the_state_on_restore()
	{
		var board = new TrackBoardDef { TrackLength = 30, GridWidth = 6, Effects = new() };
		var state = new GameState { GameType = "track", TrackBoard = board, TrackRules = new TrackRulesConfig { RollAgainOnMax = true } };
		var runtime = (TrackRuntime)new TrackFamily().RuntimeFromState(state)!;
		Assert.True(runtime.Rules.RollAgainOnMax);
	}
}
