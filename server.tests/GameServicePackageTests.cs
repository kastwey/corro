using System.Text.Json;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Creating a live game from a loaded .corro package: GameService builds the board, settings
/// and rent rules from the definition, and a real command then computes by the package's rules —
/// the end-to-end proof that a package drives the game through the normal runtime path.
/// </summary>
public class GameServicePackageTests
{
	private static GameDefinition Corro()
		=> new CorroPackageLoader().LoadAsync(CorroTestPaths.FixtureDir("corro-classic"))
			.GetAwaiter().GetResult();

	private static List<Player> TwoPlayers() => new()
	{
		new() { Id = "a", Name = "Ana", Token = "disc" },
		new() { Id = "b", Name = "Bob", Token = "star" },
	};

	[Fact]
	public async Task InitializeFromDefinition_builds_the_board_and_settings_from_the_package()
	{
		var svc = new GameService(
			new CorroRulebook(), new AuctionRulebook());

		await svc.InitializeFromDefinitionAsync(TwoPlayers(), Corro(), "es");

		var state = svc.GameState!;
		Assert.Equal(40, state.Squares.Count);
		Assert.Equal("Calle 1", state.Squares[1].Name);  // localized for the chosen lang
		Assert.Equal("ownable", state.Squares[1].Behavior);
		Assert.Equal("sendToHolding", state.Squares[30].Behavior);
		Assert.Equal(1500, svc.Settings.StartingMoney);
		Assert.Equal(1500, state.Players[0].Money);
		// The board's localized name + centre brand reach the state (page title + board centre).
		Assert.Equal("Clásico (Madrid)", state.BoardName!["es"]);
		Assert.Equal("CLÁSICO", state.CenterBrand);
		// The package's decks reach the state so the client can label the center piles with them.
		Assert.Equal(2, state.Decks.Count);
		Assert.Equal("chance", state.Decks[0].Id);
		Assert.Equal("game.card_deck_chance", state.Decks[0].NameKey); // i18n key (resolved client-side)
		Assert.Equal("community", state.Decks[1].Id);
		// The package's groups (with their board shortcut keys) reach the state for keyboard nav.
		Assert.Equal("b", state.Groups.Single(g => g.Id == "brown").Key);
		Assert.Equal("d", state.Groups.Single(g => g.Id == "darkblue").Key);
		// The board's currency reaches the state so the client renders amounts in its money, and its
		// terminology so announcements/help use the board's own words (not hardcoded "euros"/"holding").
		Assert.Equal("€", state.Currency!.Symbol);
		Assert.Equal("currency.name", state.Currency.NameKey);
		Assert.Equal("terminology.holding", state.Terminology["holding"]);
		// The board's building tiers reach the state so the client labels them ("casa"/"hotel").
		Assert.Equal(4, state.Building!.Levels);
		Assert.Equal("building.small", state.Building.SmallKey);
		Assert.Equal("building.big", state.Building.BigKey);
		// Holding movement: the classic fixture teleports (no rules.holding.walk), so the client snaps to holding.
		Assert.False(state.WalkToHolding);
	}

	[Fact]
	public async Task A_board_with_rules_holding_walk_sets_WalkToHolding_on_the_state()
	{
		// A board can opt the token INTO walking to holding; the flag must reach the client state so the
		// token animates the trip (and the holding announcement is paced) instead of teleporting.
		var def = Corro();
		var walking = def with { Manifest = def.Manifest with { Rules = def.Manifest.Rules with { Holding = def.Manifest.Rules.Holding with { Walk = true } } } };

		var svc = new GameService(new CorroRulebook(), new AuctionRulebook());
		await svc.InitializeFromDefinitionAsync(TwoPlayers(), walking, "es");

		Assert.True(svc.GameState!.WalkToHolding);
	}

	// ── EffectiveSettings: the host's house-rule choices survive a restart ────────────────
	private static GameDocument DocWith(Dictionary<string, JsonElement>? ruleValues, GameSettings settings) => new()
	{
		Id = "game-x",
		GameId = "x",
		Status = GameStatus.Active,
		HostId = "h",
		InviteCode = "INV",
		RuleValues = ruleValues,
		Settings = settings,
	};

	[Fact]
	public void EffectiveSettings_applies_the_hosts_rule_values_over_the_package_defaults()
	{
		// Regression: the auction bid timeout (a house rule) reverted to a default after a server
		// restart, because restore used the stored Settings and never re-applied the host's RuleValues.
		// EffectiveSettings (used at start AND restore) must honour the chosen value, not the stale one.
		var def = Corro();
		var game = DocWith(
			new() { ["auctionTimeoutSeconds"] = JsonSerializer.SerializeToElement(10) },
			new GameSettings { AuctionBidTimeoutSeconds = 99 }); // stale stored value must NOT win

		var eff = GameDefinitionAdapter.EffectiveSettings(game, def);

		Assert.Equal(10, eff.AuctionBidTimeoutSeconds);
	}

	[Fact]
	public void EffectiveSettings_recovers_EVERY_host_chosen_rule_not_just_the_auction_timeout()
	{
		// The fix restores all house-rule choices, not only the reported one: RuleValues carries every
		// rule the host set, and each is re-applied via the catalog exactly as at game start.
		var def = Corro();
		var chosen = new Dictionary<string, JsonElement>
		{
			["startingMoney"] = JsonSerializer.SerializeToElement(2500),
			["passStartBonus"] = JsonSerializer.SerializeToElement(300),
			["mortgageInterestRate"] = JsonSerializer.SerializeToElement(5),
			["holdingReleaseCost"] = JsonSerializer.SerializeToElement(75),
			["maxHoldingTurns"] = JsonSerializer.SerializeToElement(2),
			["auctionTimeoutSeconds"] = JsonSerializer.SerializeToElement(10),
			["collectRentWhileHeld"] = JsonSerializer.SerializeToElement(true),
		};
		// Stored Settings are all different, to prove the recovered values come from RuleValues.
		var eff = GameDefinitionAdapter.EffectiveSettings(DocWith(chosen, new GameSettings()), def);

		Assert.Equal(2500, eff.StartingMoney);
		Assert.Equal(300, eff.GoBonus);
		Assert.Equal(5, eff.MortgageInterestRate);
		Assert.Equal(75, eff.HoldingReleaseCost);
		Assert.Equal(2, eff.MaxHoldingTurns);
		Assert.Equal(10, eff.AuctionBidTimeoutSeconds);
		Assert.True(eff.CollectRentWhileHeld);
	}

	[Fact]
	public void EffectiveSettings_falls_back_to_stored_settings_without_rule_values_or_package()
	{
		var def = Corro();
		var stored = new GameSettings { AuctionBidTimeoutSeconds = 42 };

		Assert.Equal(42, GameDefinitionAdapter.EffectiveSettings(DocWith(null, stored), def).AuctionBidTimeoutSeconds);
		Assert.Equal(42, GameDefinitionAdapter.EffectiveSettings(
			DocWith(new() { ["auctionTimeoutSeconds"] = JsonSerializer.SerializeToElement(10) }, stored),
			null /* no definition re-staged */).AuctionBidTimeoutSeconds);
	}

	[Fact]
	public async Task A_package_game_computes_rent_by_the_packages_rules_end_to_end()
	{
		// b owns the station at id 5; a rolls onto it and should pay 25 — the package's transit
		// table, dispatched on the "transit" type that only the package's rules know about.
		var svc = new GameService(
			new CorroRulebook(randomSource: new ScriptedRandomSource().Enqueue(1, 1)),
			new AuctionRulebook());
		await svc.InitializeFromDefinitionAsync(TwoPlayers(), Corro(), "es");

		svc.GameState!.Squares[5].OwnerId = "b";
		svc.GameState.Players.First(p => p.Id == "a").Position = 3; // 3 + (1+1) = 5

		await svc.ExecuteCommandAsync(new RollDiceCommand { PlayerId = "a" });

		Assert.Equal(1525, svc.GameState.Players.First(p => p.Id == "b").Money);
	}

	[Fact]
	public async Task AttachPackageDefinition_re_applies_the_packages_rent_rules_after_a_restore()
	{
		var def = Corro();

		// A snapshot to restore (a fresh package game's state stands in for a persisted one).
		var seed = new GameService(new CorroRulebook(), new AuctionRulebook());
		await seed.InitializeFromDefinitionAsync(TwoPlayers(), def, "es");
		var snapshot = seed.GameState!;

		// A package with a DISTINCTIVE transit rent, so the test fails if the rules aren't re-attached
		// (a restored game otherwise falls back to the classic 25, not 99).
		var custom = def with { Manifest = def.Manifest with { Rules = def.Manifest.Rules with { TransitRent = new[] { 99, 150, 200, 250 } } } };

		var restored = new GameService(
			new CorroRulebook(randomSource: new ScriptedRandomSource().Enqueue(1, 1)), new AuctionRulebook());
		restored.ConfigureSettings(seed.Settings);
		await restored.RestoreGameAsync(snapshot);
		restored.AttachPackageDefinition(custom);

		restored.GameState!.Squares[5].OwnerId = "b";        // b owns the station
		restored.GameState.Players.First(p => p.Id == "a").Position = 3; // 3 + (1+1) = 5

		await restored.ExecuteCommandAsync(new RollDiceCommand { PlayerId = "a" });

		Assert.Equal(1599, restored.GameState.Players.First(p => p.Id == "b").Money); // the package's 99, not 25
	}

	[Fact]
	public async Task A_restored_journey_game_keeps_the_hosts_house_rules_over_the_manifest_defaults()
	{
		// The host chose a 700 km goal in the lobby; the manifest's default is 1000. After a
		// restore, AttachPackageDefinition re-stages the package — the runtime must rebuild
		// from the SNAPSHOT's effective rules, or the goal silently reverts to 1000.
		var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("la-gran-ruta"));

		var seed = new GameService(new CorroRulebook(), new AuctionRulebook());
		await seed.InitializeFromDefinitionAsync(TwoPlayers(), def, "es",
			ruleValues: new Dictionary<string, JsonElement>
			{
				["journeyGoalKm"] = JsonSerializer.SerializeToElement(700),
			});
		var snapshot = seed.GameState!;
		Assert.Equal(700, snapshot.JourneyRules!.GoalKm); // the effective rules are persisted

		// Put player "a" mid-hand where the two goals DISAGREE: 650 + 100 overshoots 700
		// (illegal) but not 1000 (legal). Rolling, drawn, holding a 100.
		snapshot.CurrentTurn = "a";
		snapshot.Journey!.HasDrawn = true;
		var seat = snapshot.Journey.Seats.First(s => s.PlayerId == "a");
		seat.Km = 650;
		seat.Hazards.Clear();
		seat.Members[0].Hand.Add(new JourneyCardInstance { InstanceId = "d100#99", CardId = "d100" });

		var restored = new GameService(new CorroRulebook(), new AuctionRulebook());
		await restored.RestoreGameAsync(snapshot);
		restored.AttachPackageDefinition(def);

		var response = await restored.ExecuteCommandAsync(new JourneyPlayCommand { PlayerId = "a", InstanceId = "d100#99" });

		var error = Assert.IsType<ErrorResponse>(response);
		Assert.Equal("JOURNEY_ILLEGAL_PLAY", error.Code); // overshooting the CHOSEN 700 km goal
		Assert.Equal(650, restored.GameState!.Journey!.Seats.First(s => s.PlayerId == "a").Km);
	}
}
