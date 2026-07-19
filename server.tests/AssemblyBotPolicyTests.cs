using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Bots;

namespace CorroServer.Tests;

/// <summary>
/// The assembly bot brain, over projected views: fix first, then install, steal, attack the
/// leader (afflicted slots first — the destruction), shield, and discard/pass fallbacks.
/// </summary>
public class AssemblyBotPolicyTests
{
	private static readonly List<AssemblyCardDef> Deck = new()
	{
		new() { Id = "p-red", Type = "piece", Color = "red", Count = 5, NameKey = "c.p-red" },
		new() { Id = "p-green", Type = "piece", Color = "green", Count = 5, NameKey = "c.p-green" },
		new() { Id = "a-red", Type = "attack", Color = "red", Count = 4, NameKey = "c.a-red" },
		new() { Id = "r-red", Type = "remedy", Color = "red", Count = 4, NameKey = "c.r-red" },
		new() { Id = "s-steal", Type = "special", SpecialKind = "stealPiece", Count = 3, NameKey = "c.s-steal" },
	};

	private static AssemblyCardInstance Inst(string cardId, int n = 0)
		=> new() { InstanceId = $"{cardId}@{n}", CardId = cardId };

	private static AssemblySlot Slot(string color, int afflictions = 0, int shields = 0)
		=> new()
		{
			Color = color,
			Piece = Inst($"p-{color}", 9),
			Afflictions = Enumerable.Range(0, afflictions).Select(i => Inst("a-red", i)).ToList(),
			Shields = Enumerable.Range(0, shields).Select(i => Inst("r-red", i)).ToList(),
		};

	private static GameState View(AssemblySeatState bot, params AssemblySeatState[] rivals)
		=> new()
		{
			GameType = "assembly",
			Assembly = new AssemblyState { Seats = new[] { bot }.Concat(rivals).ToList() },
			AssemblyDeck = Deck,
			AssemblyRules = new AssemblyRulesConfig(),
			CurrentTurn = "bot",
			Players = new[] { bot }.Concat(rivals)
				.Select(s => new Player { Id = s.PlayerId, Name = s.PlayerId, Token = "t" }).ToList(),
		};

	private static AssemblySeatState Seat(string id, string[] hand, params AssemblySlot[] slots)
		=> new() { PlayerId = id, Hand = hand.Select(Inst).ToList(), Slots = slots.ToList() };

	private readonly AssemblyBotPolicy _policy = new();

	[Fact]
	public void Fixing_an_afflicted_slot_beats_everything_else()
	{
		var view = View(
			Seat("bot", new[] { "p-green", "r-red", "a-red" }, Slot("red", afflictions: 1)),
			Seat("r1", Array.Empty<string>(), Slot("red")));

		var command = Assert.IsType<AssemblyPlayCommand>(_policy.Decide(view, "bot"));

		Assert.StartsWith("r-red", command.InstanceId);
		Assert.Equal("red", command.TargetColor);
		Assert.Null(command.TargetPlayerId); // own slot
	}

	[Fact]
	public void With_nothing_to_fix_it_installs_a_piece()
	{
		var view = View(
			Seat("bot", new[] { "p-green", "a-red" }),
			Seat("r1", Array.Empty<string>()));

		var command = Assert.IsType<AssemblyPlayCommand>(_policy.Decide(view, "bot"));
		Assert.StartsWith("p-green", command.InstanceId);
	}

	[Fact]
	public void Attacks_prefer_the_leaders_afflicted_slot_to_destroy_it()
	{
		var leader = Seat("r1", Array.Empty<string>(), Slot("red", afflictions: 1), Slot("green"));
		var view = View(Seat("bot", new[] { "a-red" }, Slot("green")), leader);

		var command = Assert.IsType<AssemblyPlayCommand>(_policy.Decide(view, "bot"));

		Assert.StartsWith("a-red", command.InstanceId);
		Assert.Equal("r1", command.TargetPlayerId);
		Assert.Equal("red", command.TargetColor); // the afflicted one: second hit destroys
	}

	[Fact]
	public void Steals_a_colour_it_lacks_before_attacking()
	{
		var view = View(
			Seat("bot", new[] { "s-steal", "a-red" }, Slot("green")),
			Seat("r1", Array.Empty<string>(), Slot("red")));

		var command = Assert.IsType<AssemblyPlayCommand>(_policy.Decide(view, "bot"));
		Assert.StartsWith("s-steal", command.InstanceId);
		Assert.Equal("red", command.TargetColor);
	}

	[Fact]
	public void Nothing_playable_discards_one_card_and_an_empty_hand_passes()
	{
		// Only a red remedy with nothing red on the rack: unplayable → discard it.
		var view = View(Seat("bot", new[] { "r-red" }), Seat("r1", Array.Empty<string>()));
		var discard = Assert.IsType<AssemblyDiscardCommand>(_policy.Decide(view, "bot"));
		Assert.Single(discard.InstanceIds);

		var empty = View(Seat("bot", Array.Empty<string>()), Seat("r1", Array.Empty<string>()));
		var pass = Assert.IsType<AssemblyDiscardCommand>(_policy.Decide(empty, "bot"));
		Assert.Empty(pass.InstanceIds);
	}

	[Fact]
	public void Off_turn_or_finished_games_yield_nothing()
	{
		var view = View(Seat("bot", new[] { "p-green" }), Seat("r1", Array.Empty<string>()));
		view.CurrentTurn = "r1";
		Assert.Null(_policy.Decide(view, "bot"));

		view.CurrentTurn = "bot";
		view.IsGameOver = true;
		Assert.Null(_policy.Decide(view, "bot"));
	}
}
