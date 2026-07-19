using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Verifies that the configurable the classic gamemallBuilding/official rules exposed through
/// <see cref="GameSettings"/> actually change behaviour end-to-end at the rulebook
/// level. Each test toggles a single setting and asserts the observable effect so a
/// regression in the wiring (settings ignored, hardcoded constants, etc.) is caught.
/// </summary>
public class GameRulesSettingsTests
{
	private static Square ColourSquare(int id, string? ownerId = null, int smallBuildings = 0, int bigBuildings = 0, bool mortgaged = false)
		=> new()
		{
			Id = id,
			Name = $"Brown {id}",
			Type = "property",
			Color = "brown",
			Price = 100,
			Rent = new List<int> { 2, 10, 30, 90, 160, 250 },
			BuildingCost = 50,
			OwnerId = ownerId,
			SmallBuildings = smallBuildings,
			BigBuildings = bigBuildings,
			Mortgaged = mortgaged
		};

	// ── Defaults lock the canonical Corro contract ────────────────────────

	[Fact]
	public void Defaults_MatchStandardClassicRules()
	{
		var s = new GameSettings();
		Assert.Equal(1500, s.StartingMoney);
		Assert.Equal(200, s.GoBonus);
		Assert.False(s.DoubleGoSalary);
		Assert.False(s.FreeParkingJackpot);
		Assert.True(s.AuctionOnDecline);
		Assert.True(s.BuildingShortage);
		Assert.True(s.EvenBuildRule);
		Assert.False(s.NoBuildingFirstLap);
		Assert.Equal(10, s.MortgageInterestRate);
		Assert.Equal(50, s.HoldingReleaseCost);
		Assert.Equal(3, s.MaxHoldingTurns);
		Assert.True(s.CollectRentWhileHeld);
	}

	// ── GO salary ────────────────────────────────────────────────────────────

	[Fact]
	public async Task GoBonus_IsConfigurable_OnPassingGo()
	{
		var p = TestFixtures.NewPlayer("a", money: 1500, position: 38);
		var state = TestFixtures.NewState(new[] { p }, bankMoney: 10000);
		var context = TestFixtures.NewContext(state, new GameSettings { GoBonus = 300 });

		await GoBonusRules.AwardForMoveAsync(p, fromPosition: 38, toPosition: 2, doubleOnLanding: false, context);

		Assert.Equal(1500 + 300, p.Money);
	}

	[Fact]
	public async Task DoubleGoSalary_PaysTwice_WhenLandingExactlyOnGo()
	{
		var p = TestFixtures.NewPlayer("a", money: 1500, position: 20);
		var state = TestFixtures.NewState(new[] { p }, bankMoney: 10000);
		var context = TestFixtures.NewContext(state, new GameSettings { GoBonus = 200, DoubleGoSalary = true });

		await GoBonusRules.AwardForMoveAsync(p, fromPosition: 20, toPosition: 0, doubleOnLanding: true, context);

		Assert.Equal(1500 + 400, p.Money);
		// The special "landed exactly on GO" voice is only used when it really pays double.
		Assert.True(TestFixtures.Announcer(context).Has(AnnouncementAudience.AllExcept, "a", "game.landed_on_go"));
	}

	[Fact]
	public async Task DoubleGoSalary_Disabled_PaysSingle_WhenLandingOnGo()
	{
		var p = TestFixtures.NewPlayer("a", money: 1500, position: 20);
		var state = TestFixtures.NewState(new[] { p }, bankMoney: 10000);
		var context = TestFixtures.NewContext(state, new GameSettings { GoBonus = 200, DoubleGoSalary = false });

		await GoBonusRules.AwardForMoveAsync(p, fromPosition: 20, toPosition: 0, doubleOnLanding: true, context);

		Assert.Equal(1500 + 200, p.Money);
		// With the double rule off, landing on GO is identical to passing it — no special voice.
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.passed_through_go"));
		Assert.DoesNotContain(announcer.Sent, x => x.Key == "game.landed_on_go");
	}

	[Fact]
	public async Task DoubleGoSalary_On_MerelyPassingThroughGo_PaysSingle()
	{
		// The double only ever applies when you land EXACTLY on GO. Sailing past it on a
		// normal dice move pays the plain salary even with the smallBuilding rule enabled.
		var p = TestFixtures.NewPlayer("a", money: 1500, position: 38);
		var state = TestFixtures.NewState(new[] { p }, bankMoney: 10000);
		var context = TestFixtures.NewContext(state, new GameSettings { GoBonus = 200, DoubleGoSalary = true });

		await GoBonusRules.AwardForMoveAsync(p, fromPosition: 38, toPosition: 5, doubleOnLanding: true, context);

		Assert.Equal(1500 + 200, p.Money);
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.passed_through_go"));
		Assert.DoesNotContain(announcer.Sent, x => x.Key == "game.landed_on_go");
	}

	[Fact]
	public async Task DoubleGoSalary_On_CardLandingExactlyOnGo_PaysSingle()
	{
		// A card teleport that drops the player on GO is not a natural dice landing, so it
		// pays the single salary even with the double rule on (doubleOnLanding == false).
		var p = TestFixtures.NewPlayer("a", money: 1500, position: 20);
		var state = TestFixtures.NewState(new[] { p }, bankMoney: 10000);
		var context = TestFixtures.NewContext(state, new GameSettings { GoBonus = 200, DoubleGoSalary = true });

		await GoBonusRules.AwardForMoveAsync(p, fromPosition: 20, toPosition: 0, doubleOnLanding: false, context);

		Assert.Equal(1500 + 200, p.Money);
		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.passed_through_go"));
		Assert.DoesNotContain(announcer.Sent, x => x.Key == "game.landed_on_go");
	}

	// ── Free Parking jackpot ─────────────────────────────────────────────────

	[Fact]
	public async Task FreeParkingJackpot_On_TaxFeedsThePot()
	{
		var p = TestFixtures.NewPlayer("a", money: 1500, position: 0);
		var squares = new List<Square> { new() { Id = 0, Name = "Income Tax", Type = "tax", Amount = 200 } };
		var state = TestFixtures.NewState(new[] { p }, squares: squares);
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = true });

		await new CorroRulebook().ProcessLandingEffectsAsync(p, 0, context);

		Assert.Equal(200, context.Helper.GetFreeParkingPot());
		Assert.Equal(1500 - 200, p.Money);
	}

	[Fact]
	public async Task FreeParkingJackpot_Off_TaxGoesToBank_NotThePot()
	{
		var p = TestFixtures.NewPlayer("a", money: 1500, position: 0);
		var squares = new List<Square> { new() { Id = 0, Name = "Income Tax", Type = "tax", Amount = 200 } };
		var state = TestFixtures.NewState(new[] { p }, squares: squares);
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = false });

		await new CorroRulebook().ProcessLandingEffectsAsync(p, 0, context);

		Assert.Equal(0, context.Helper.GetFreeParkingPot());
		Assert.Equal(1500 - 200, p.Money);
	}

	[Fact]
	public async Task FreeParkingJackpot_Off_LandingCollectsNothing()
	{
		var p = TestFixtures.NewPlayer("a", money: 1500, position: 0);
		var squares = new List<Square> { new() { Id = 0, Name = "Free Parking", Type = "corner", Key = "free_parking" } };
		var state = TestFixtures.NewState(new[] { p }, squares: squares);
		context_FillPot(state, 500);
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = false });

		await new CorroRulebook().ProcessLandingEffectsAsync(p, 0, context);

		Assert.Equal(1500, p.Money); // pot is ignored when the jackpot rule is off
	}

	[Fact]
	public async Task FreeParkingJackpot_On_LandingCollectsThePot()
	{
		var p = TestFixtures.NewPlayer("a", money: 1500, position: 0);
		var squares = new List<Square> { new() { Id = 0, Name = "Free Parking", Type = "corner", Key = "free_parking" } };
		var state = TestFixtures.NewState(new[] { p }, squares: squares);
		context_FillPot(state, 500);
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = true });

		await new CorroRulebook().ProcessLandingEffectsAsync(p, 0, context);

		Assert.Equal(1500 + 500, p.Money);
		Assert.Equal(0, context.Helper.GetFreeParkingPot());
	}

	[Fact]
	public async Task FreeParkingJackpot_On_LandingCollectsThePot_AnnouncesWithActorId()
	{
		// Regression: the Free Parking announcements were missing "actorId", so the actor
		// heard the third-person base ("Núria lands on...") instead of the "_self" variant.
		var p = TestFixtures.NewPlayer("a", money: 1500, position: 0);
		var squares = new List<Square> { new() { Id = 0, Name = "Free Parking", Type = "corner", Key = "free_parking" } };
		var state = TestFixtures.NewState(new[] { p }, squares: squares);
		context_FillPot(state, 500);
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = true });

		await new CorroRulebook().ProcessLandingEffectsAsync(p, 0, context);

		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.free_parking_collect_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.free_parking_collect"));
	}

	[Fact]
	public async Task FreeParkingJackpot_On_EmptyPot_AnnouncesWithActorId()
	{
		// Regression for the reported bug: landing on an empty Free Parking pot voiced
		// "{{player}} lands on Free Parking..." in the third person to the actor.
		var p = TestFixtures.NewPlayer("a", money: 1500, position: 0);
		var squares = new List<Square> { new() { Id = 0, Name = "Free Parking", Type = "corner", Key = "free_parking" } };
		var state = TestFixtures.NewState(new[] { p }, squares: squares);
		var context = TestFixtures.NewContext(state, new GameSettings { FreeParkingJackpot = true });

		await new CorroRulebook().ProcessLandingEffectsAsync(p, 0, context);

		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.free_parking_empty_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.free_parking_empty"));
	}

	private static void context_FillPot(GameState state, int amount) => state.Bank.FreeParkingPot = amount;

	// ── Auction on decline ───────────────────────────────────────────────────

	[Fact]
	public async Task AuctionOnDecline_Off_DecliningClearsPending_NoAuction_NoTurnHandover()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 1);
		var b = TestFixtures.NewPlayer("b", money: 1500, position: 0);
		var squares = new List<Square>
		{
			new() { Id = 0, Name = "Go", Type = "go" },
			new() { Id = 1, Name = "Baltic", Type = "property", Price = 100 },
		};
		var state = TestFixtures.NewState(new[] { a, b }, squares: squares);
		state.CurrentTurn = "a";
		state.PendingPurchase = new PendingPurchase { PlayerId = "a", SquareIndex = 1, SquareName = "Baltic", Price = 100 };
		var context = TestFixtures.NewContext(state, new GameSettings { AuctionOnDecline = false });

		var outcome = await new CorroRulebook().DeclinePropertyAsync(a, 1, context);

		Assert.True(outcome.Success);
		Assert.False(outcome.AuctionStarted);
		Assert.Null(state.ActiveAuction);
		Assert.Null(state.PendingPurchase); // offer cleared
											// Declining no longer advances the turn; EndTurn (which invokes the decline)
											// hands the turn over once the pending purchase is resolved.
		Assert.Equal("a", state.CurrentTurn);
		var announcer = TestFixtures.Announcer(context);
		Assert.DoesNotContain(announcer.Sent, x => x.Key == "game.turn_of");
	}

	[Fact]
	public async Task AuctionOnDecline_On_DecliningStartsAuction()
	{
		var a = TestFixtures.NewPlayer("a", money: 1500, position: 1);
		var b = TestFixtures.NewPlayer("b", money: 1500, position: 0);
		var squares = new List<Square>
		{
			new() { Id = 0, Name = "Go", Type = "go" },
			new() { Id = 1, Name = "Baltic", Type = "property", Price = 100 },
		};
		var state = TestFixtures.NewState(new[] { a, b }, squares: squares);
		state.PendingPurchase = new PendingPurchase { PlayerId = "a", SquareIndex = 1, SquareName = "Baltic", Price = 100 };
		var context = TestFixtures.NewContext(state, new GameSettings { AuctionOnDecline = true });

		var outcome = await new CorroRulebook().DeclinePropertyAsync(a, 1, context);

		Assert.True(outcome.AuctionStarted);
		Assert.NotNull(state.ActiveAuction);
	}

	// ── Rent collection while in holding ────────────────────────────────────────

	[Fact]
	public async Task CollectRentWhileHeld_Off_HeldLandlordCollectsNoRent()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		owner.IsHeld = true;
		var tenant = TestFixtures.NewPlayer("tenant", money: 1500, position: 1);
		var state = TestFixtures.NewState(new[] { owner, tenant },
			squares: new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner") });
		var context = TestFixtures.NewContext(state, new GameSettings { CollectRentWhileHeld = false });

		await new CorroRulebook().ProcessLandingEffectsAsync(tenant, 1, context);

		Assert.Equal(1500, tenant.Money);
		Assert.Equal(1500, owner.Money);
	}

	[Fact]
	public async Task CollectRentWhileHeld_On_HeldLandlordStillCollects()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		owner.IsHeld = true;
		var tenant = TestFixtures.NewPlayer("tenant", money: 1500, position: 1);
		var state = TestFixtures.NewState(new[] { owner, tenant },
			squares: new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner") });
		var context = TestFixtures.NewContext(state, new GameSettings { CollectRentWhileHeld = true });

		await new CorroRulebook().ProcessLandingEffectsAsync(tenant, 1, context);

		Assert.Equal(1500 - 4, tenant.Money); // classic doubles base rent (2 → 4)
		Assert.Equal(1500 + 4, owner.Money);
	}

	// ── Building shortage (bank stock of smallBuildings/bigBuildings) ──────────────────────

	[Fact]
	public async Task BuildingShortage_On_BlocksWhenAllHousesAreInUse()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var squares = new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner") };
		// 8 filler lots already holding 4 smallBuildings each → 32 smallBuildings in use (bank empty).
		for (int i = 2; i < 10; i++)
		{
			squares.Add(new Square { Id = i, Name = $"f{i}", Type = "property", SmallBuildings = 4 });
		}

		var state = TestFixtures.NewState(new[] { owner }, squares: squares);
		var context = TestFixtures.NewContext(state, new GameSettings { BuildingShortage = true });

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("SMALL_BUILDING_SHORTAGE", outcome.ErrorCode);
	}

	[Fact]
	public async Task BuildingShortage_HonoursAConfigurableHouseLimit()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var squares = new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner") };
		// One filler lot with 2 smallBuildings: with a bank stocked for only 2 smallBuildings, it's already empty.
		squares.Add(new Square { Id = 2, Name = "f2", Type = "property", SmallBuildings = 2 });
		var state = TestFixtures.NewState(new[] { owner }, squares: squares);
		// Under the old hardcoded limit of 32 this would succeed; the parametrised limit blocks it.
		var context = TestFixtures.NewContext(state, new GameSettings { BuildingShortage = true, MaxSmallBuildings = 2 });

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("SMALL_BUILDING_SHORTAGE", outcome.ErrorCode);
	}

	[Fact]
	public async Task BuildingShortage_Off_AllowsBuildingDespiteDepletedBank()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var squares = new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner") };
		for (int i = 2; i < 10; i++)
		{
			squares.Add(new Square { Id = i, Name = $"f{i}", Type = "property", SmallBuildings = 4 });
		}

		var state = TestFixtures.NewState(new[] { owner }, squares: squares);
		var context = TestFixtures.NewContext(state, new GameSettings { BuildingShortage = false });

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.True(outcome.Success);
		Assert.Equal(1, state.Squares[0].SmallBuildings);
	}

	[Fact]
	public async Task BuildingShortage_On_BlocksHotelWhenAllHotelsInUse()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		// Both lots at 4 smallBuildings → next build is a bigBuilding.
		var squares = new List<Square> { ColourSquare(0, "owner", smallBuildings: 4), ColourSquare(1, "owner", smallBuildings: 4) };
		for (int i = 2; i < 14; i++)
		{
			squares.Add(new Square { Id = i, Name = $"f{i}", Type = "property", BigBuildings = 1 });
		}

		var state = TestFixtures.NewState(new[] { owner }, squares: squares);
		var context = TestFixtures.NewContext(state, new GameSettings { BuildingShortage = true });

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("BIG_BUILDING_SHORTAGE", outcome.ErrorCode);
	}

	// ── Even-building rule ───────────────────────────────────────────────────

	[Fact]
	public async Task EvenBuildRule_Off_AllowsUnevenBuilding()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		// Square 0 already has a smallBuilding; building a second before square 1 is uneven.
		var state = TestFixtures.NewState(new[] { owner },
			squares: new List<Square> { ColourSquare(0, "owner", smallBuildings: 1), ColourSquare(1, "owner") });
		var context = TestFixtures.NewContext(state, new GameSettings { EvenBuildRule = false });

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.True(outcome.Success);
		Assert.Equal(2, state.Squares[0].SmallBuildings);
	}

	[Fact]
	public async Task EvenBuildRule_On_BlocksUnevenBuilding()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var state = TestFixtures.NewState(new[] { owner },
			squares: new List<Square> { ColourSquare(0, "owner", smallBuildings: 1), ColourSquare(1, "owner") });
		var context = TestFixtures.NewContext(state, new GameSettings { EvenBuildRule = true });

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("UNEVEN_BUILDING", outcome.ErrorCode);
	}

	// ── No building before the first lap ─────────────────────────────────────

	[Fact]
	public async Task NoBuildingFirstLap_On_BlocksBeforeFirstLap()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		owner.LapsCompleted = 0;
		var state = TestFixtures.NewState(new[] { owner },
			squares: new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner") });
		var context = TestFixtures.NewContext(state, new GameSettings { NoBuildingFirstLap = true });

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.False(outcome.Success);
		Assert.Equal("NO_FIRST_LAP", outcome.ErrorCode);
	}

	[Fact]
	public async Task NoBuildingFirstLap_On_AllowsAfterFirstLap()
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		owner.LapsCompleted = 1;
		var state = TestFixtures.NewState(new[] { owner },
			squares: new List<Square> { ColourSquare(0, "owner"), ColourSquare(1, "owner") });
		var context = TestFixtures.NewContext(state, new GameSettings { NoBuildingFirstLap = true });

		var outcome = await new CorroRulebook().BuildAsync(owner, 0, context);

		Assert.True(outcome.Success);
	}

	// ── Mortgage interest ────────────────────────────────────────────────────

	[Theory]
	[InlineData(10, 55)]  // 50 * 1.10
	[InlineData(0, 50)]   // no interest
	[InlineData(20, 60)]  // 50 * 1.20
	public async Task MortgageInterestRate_DrivesUnmortgageCost(int rate, int expectedCost)
	{
		var owner = TestFixtures.NewPlayer("owner", money: 1500);
		var state = TestFixtures.NewState(new[] { owner },
			squares: new List<Square> { ColourSquare(0, "owner", mortgaged: true) });
		var context = TestFixtures.NewContext(state, new GameSettings { MortgageInterestRate = rate });

		var outcome = await new CorroRulebook().UnmortgagePropertyAsync(owner, 0, context);

		Assert.True(outcome.Success);
		Assert.Equal(1500 - expectedCost, owner.Money);
	}

	// ── Holding release cost cost ───────────────────────────────────────────────────────

	[Fact]
	public async Task HoldingReleaseCost_IsConfigurable()
	{
		var p = TestFixtures.NewPlayer("a", money: 1500);
		p.IsHeld = true;
		var state = TestFixtures.NewState(new[] { p });
		state.CurrentTurn = "a";
		var context = TestFixtures.NewContext(state, new GameSettings { HoldingReleaseCost = 75 });

		var outcome = await new CorroRulebook().PayReleaseCostAsync(p, context);

		Assert.True(outcome.Success);
		Assert.Equal(75, outcome.AmountPaid);
		Assert.Equal(1500 - 75, p.Money);
		Assert.False(p.IsHeld);
	}

	[Fact]
	public async Task PayReleaseCost_AfterRolling_IsRejected()
	{
		// Bug 3: release cost is a pre-roll decision. Once the player has rolled this turn the
		// option is gone and the server must reject a late release-cost payment.
		var p = TestFixtures.NewPlayer("a", money: 1500);
		p.IsHeld = true;
		var state = TestFixtures.NewState(new[] { p });
		state.CurrentTurn = "a";
		state.HasRolledThisTurn = true;
		var context = TestFixtures.NewContext(state);

		var outcome = await new CorroRulebook().PayReleaseCostAsync(p, context);

		Assert.False(outcome.Success);
		Assert.Equal("ALREADY_ROLLED", outcome.ErrorCode);
		Assert.True(p.IsHeld);
		Assert.Equal(1500, p.Money);
	}

	// ── Max holding turns ───────────────────────────────────────────────────────

	[Theory]
	[InlineData(3)]
	[InlineData(5)]
	[InlineData(1)]
	public async Task MaxHoldingTurns_SeedsHoldingTurnsRemaining_WhenSentByCard(int maxTurns)
	{
		var p = TestFixtures.NewPlayer("a", money: 1500);
		var state = TestFixtures.NewState(new[] { p });
		var context = TestFixtures.NewContext(state, new GameSettings { MaxHoldingTurns = maxTurns });

		await new CardActions().SendToHoldingByCardAsync(p, context);

		Assert.True(p.IsHeld);
		Assert.Equal(maxTurns, p.HoldingTurnsRemaining);
	}
}
