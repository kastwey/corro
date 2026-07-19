using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Unit coverage for the command handlers. Handlers are thin: they guard
/// (PLAYER_NOT_FOUND and similar), delegate game rules to the rulebook (covered
/// separately) and shape the <see cref="ServerResponse"/>. These tests pin the guards,
/// the error→<see cref="ErrorResponse"/> mapping and the response shaping by invoking each
/// handler directly with a real <see cref="CorroRulebook"/>.
/// </summary>
public class HandlerTests
{
	private static GameContext Ctx(GameState state) => TestFixtures.NewContext(state);

	private static GameState OnePlayer(int money = 1500)
		=> TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a", money: money) });

	// ===== Holding handlers =====

	[Fact]
	public async Task PayReleaseCost_UnknownPlayer_IsRejected()
	{
		var response = await new PayReleaseCostHandler(new CorroRulebook()).HandleAsync(
			new PayReleaseCostCommand { PlayerId = "ghost" }, Ctx(OnePlayer()));

		Assert.Equal("PLAYER_NOT_FOUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task PayReleaseCost_FromHeldPlayer_ReleasesAndCharges()
	{
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a", money: 1500) }, squares: TestFixtures.StandardBoard());
		state.CurrentTurn = "a";
		var context = Ctx(state);
		context.Helper.SendToHolding("a", 10);

		var response = await new PayReleaseCostHandler(new CorroRulebook()).HandleAsync(
			new PayReleaseCostCommand { PlayerId = "a" }, context);

		var paid = Assert.IsType<ReleaseCostPaidResponse>(response);
		Assert.Equal(50, paid.Amount);
		Assert.False(context.Helper.IsPlayerHeld("a"));
	}

	[Fact]
	public async Task UseReleasePass_WithNoCards_IsRejected()
	{
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a") }, squares: TestFixtures.StandardBoard());
		state.CurrentTurn = "a";
		var context = Ctx(state);
		context.Helper.SendToHolding("a", 10);

		var response = await new UseReleasePassHandler(new CorroRulebook()).HandleAsync(
			new UseReleasePassCommand { PlayerId = "a" }, context);

		Assert.Equal("NO_RELEASE_PASSES", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task UseReleasePass_WithCard_ReleasesAndDecrementsCount()
	{
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a") }, squares: TestFixtures.StandardBoard());
		state.CurrentTurn = "a";
		var context = Ctx(state);
		context.Helper.SendToHolding("a", 10);
		context.Helper.AddPlayerReleasePass("a");

		var response = await new UseReleasePassHandler(new CorroRulebook()).HandleAsync(
			new UseReleasePassCommand { PlayerId = "a" }, context);

		var used = Assert.IsType<ReleasePassUsedResponse>(response);
		Assert.Equal(0, used.CardsRemaining);
		Assert.False(context.Helper.IsPlayerHeld("a"));
	}

	// ===== Property management handlers =====

	private static GameState OwnedBrown()
	{
		var square = new Square { Id = 1, Name = "Brown", Type = "property", Color = "brown", Price = 100, OwnerId = "a" };
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a", money: 1500) }, squares: new List<Square> { new() { Id = 0, Name = "Go", Type = "corner" }, square });
		state.CurrentTurn = "a";
		state.Players[0].Properties.Add(1);
		return state;
	}

	[Fact]
	public async Task Mortgage_UnknownPlayer_IsRejected()
	{
		var response = await new MortgagePropertyHandler(new CorroRulebook()).HandleAsync(
			new MortgagePropertyCommand { PlayerId = "ghost", SquareIndex = 1 }, Ctx(OwnedBrown()));

		Assert.Equal("PLAYER_NOT_FOUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task Mortgage_OwnedProperty_PaysHalfPrice()
	{
		var context = Ctx(OwnedBrown());

		var response = await new MortgagePropertyHandler(new CorroRulebook()).HandleAsync(
			new MortgagePropertyCommand { PlayerId = "a", SquareIndex = 1 }, context);

		var mortgaged = Assert.IsType<PropertyMortgagedResponse>(response);
		Assert.Equal(50, mortgaged.AmountReceived);
		Assert.True(context.Helper.GetSquare(1)!.Mortgaged);
	}

	[Fact]
	public async Task Unmortgage_RestoresProperty()
	{
		var state = OwnedBrown();
		state.Squares[1].Mortgaged = true;
		var context = Ctx(state);

		var response = await new UnmortgagePropertyHandler(new CorroRulebook()).HandleAsync(
			new UnmortgagePropertyCommand { PlayerId = "a", SquareIndex = 1 }, context);

		Assert.IsType<PropertyUnmortgagedResponse>(response);
		Assert.False(context.Helper.GetSquare(1)!.Mortgaged);
	}

	[Fact]
	public async Task Build_UnknownPlayer_IsRejected()
	{
		var response = await new BuildHandler(new CorroRulebook()).HandleAsync(
			new BuildCommand { PlayerId = "ghost", SquareIndex = 1 }, Ctx(OwnedBrown()));

		Assert.Equal("PLAYER_NOT_FOUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task SellHouses_UnknownPlayer_IsRejected()
	{
		var response = await new SellBuildingsHandler(new CorroRulebook()).HandleAsync(
			new SellBuildingsCommand { PlayerId = "ghost", SquareIndex = 1 }, Ctx(OwnedBrown()));

		Assert.Equal("PLAYER_NOT_FOUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	// ===== Debt handlers =====

	[Fact]
	public async Task GetDebtStatus_UnknownPlayer_IsRejected()
	{
		var response = await new GetDebtStatusHandler(new CorroRulebook()).HandleAsync(
			new GetDebtStatusCommand { PlayerId = "ghost" }, Ctx(OnePlayer()));

		Assert.Equal("PLAYER_NOT_FOUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task GetDebtStatus_SummarisesCashMortgageableAndHouseValue()
	{
		// Player has 200 cash, one clean property (mortgageable for 50) and one with a
		// bigBuilding. A brown smallBuilding costs 50, so each sells back for 25; a bigBuilding = 5 smallBuildings =
		// 125. Total against a 100 debt.
		var clean = new Square { Id = 1, Name = "Clean", Type = "property", Color = "brown", Price = 100, OwnerId = "a" };
		var built = new Square { Id = 2, Name = "Built", Type = "property", Color = "brown", Price = 100, OwnerId = "a", BigBuildings = 1 };
		var state = TestFixtures.NewState(
			new[] { TestFixtures.NewPlayer("a", money: 200) },
			squares: new List<Square> { new() { Id = 0, Name = "Go", Type = "corner" }, clean, built });
		state.Players[0].Properties.AddRange(new[] { 1, 2 });
		var context = Ctx(state);
		context.Helper.CreateDebt("a", null, 100, DebtReason.Rent, "rent");

		var response = await new GetDebtStatusHandler(new CorroRulebook()).HandleAsync(
			new GetDebtStatusCommand { PlayerId = "a" }, context);

		var status = Assert.IsType<DebtStatusResponse>(response);
		Assert.Equal(100, status.TotalDebt);
		Assert.Equal(200, status.Cash);
		Assert.Equal(50, status.MortgageableValue); // only the clean property is mortgageable
		Assert.Equal(125, status.BuildingSaleValue);    // bigBuilding = 5 smallBuildings * (50 / 2)
		Assert.Equal(375, status.TotalAssets);       // 200 + 50 + 125
		Assert.True(status.CanPayDebt);
		Assert.False(status.IsBankrupt);
	}

	[Fact]
	public async Task ResolveDebt_UnknownPlayer_IsRejected()
	{
		var response = await new ResolveDebtHandler(new CorroRulebook()).HandleAsync(
			new ResolveDebtCommand { PlayerId = "ghost" }, Ctx(OnePlayer()));

		Assert.Equal("PLAYER_NOT_FOUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task ResolveDebt_WithNoDebts_MapsRulebookError()
	{
		var response = await new ResolveDebtHandler(new CorroRulebook()).HandleAsync(
			new ResolveDebtCommand { PlayerId = "a" }, Ctx(OnePlayer()));

		Assert.Equal("NO_DEBTS", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task ResolveDebt_AffordableDebt_PaysAndReports()
	{
		var state = OnePlayer(money: 200);
		var context = Ctx(state);
		context.Helper.CreateDebt("a", null, 50, DebtReason.Tax, "tax");

		var response = await new ResolveDebtHandler(new CorroRulebook()).HandleAsync(
			new ResolveDebtCommand { PlayerId = "a" }, context);

		var resolved = Assert.IsType<DebtResolvedResponse>(response);
		Assert.Equal(50, resolved.Amount);
		Assert.Equal(150, context.Helper.GetPlayerMoney("a"));
	}

	[Fact]
	public async Task DeclareBankruptcy_UnknownPlayer_IsRejected()
	{
		var response = await new DeclareBankruptcyHandler(new CorroRulebook()).HandleAsync(
			new DeclareBankruptcyCommand { PlayerId = "ghost" }, Ctx(OnePlayer()));

		Assert.Equal("PLAYER_NOT_FOUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task DeclareBankruptcy_LastOpponent_EndsGame()
	{
		var state = TestFixtures.NewState(
			new[] { TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b") },
			squares: TestFixtures.StandardBoard());
		var context = Ctx(state);

		var response = await new DeclareBankruptcyHandler(new CorroRulebook()).HandleAsync(
			new DeclareBankruptcyCommand { PlayerId = "a" }, context);

		var bankruptcy = Assert.IsType<BankruptcyResponse>(response);
		Assert.True(bankruptcy.GameOver);
		Assert.Equal("b", bankruptcy.WinnerId);
	}

	// ===== Query handlers =====

	[Fact]
	public async Task GetReleasePasses_UnknownPlayer_IsRejected()
	{
		var response = await new GetReleasePassesHandler().HandleAsync(
			new GetReleasePassesCommand { PlayerId = "ghost" }, Ctx(OnePlayer()));

		Assert.Equal("PLAYER_NOT_FOUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task GetReleasePasses_ReportsCount()
	{
		var state = OnePlayer();
		var context = Ctx(state);
		context.Helper.AddPlayerReleasePass("a");

		var response = await new GetReleasePassesHandler().HandleAsync(
			new GetReleasePassesCommand { PlayerId = "a" }, context);

		var cards = Assert.IsType<PlayerReleasePassesResponse>(response);
		Assert.Equal(1, cards.Count);
	}

	[Fact]
	public async Task AnnounceTurn_ReportsCurrentPlayer()
	{
		var state = TestFixtures.NewState(new[] { TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b") });
		state.CurrentTurn = "b";

		var response = await new AnnounceTurnHandler().HandleAsync(
			new AnnounceTurnCommand { PlayerId = "a" }, Ctx(state));

		var turn = Assert.IsType<TurnAnnouncementResponse>(response);
		Assert.Equal("b", turn.CurrentPlayer);
	}

	// ===== Trade handlers =====

	private static GameState TwoPlayers()
	{
		var state = TestFixtures.NewState(
			new[] { TestFixtures.NewPlayer("a", money: 1500), TestFixtures.NewPlayer("b", money: 1500) },
			squares: TestFixtures.StandardBoard());
		state.CurrentTurn = "a";
		return state;
	}

	[Fact]
	public async Task ProposeTrade_UnknownInitiator_IsRejected()
	{
		var response = await new ProposeTradeHandler(new CorroRulebook()).HandleAsync(
			new ProposeTradeCommand { PlayerId = "ghost", TargetPlayerId = "b" }, Ctx(TwoPlayers()));

		Assert.Equal("PLAYER_NOT_FOUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task ProposeTrade_UnknownTarget_IsRejected()
	{
		var response = await new ProposeTradeHandler(new CorroRulebook()).HandleAsync(
			new ProposeTradeCommand { PlayerId = "a", TargetPlayerId = "ghost" }, Ctx(TwoPlayers()));

		Assert.Equal("TARGET_NOT_FOUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task ProposeTrade_Valid_ReturnsProposedAndFreezesGame()
	{
		var state = TwoPlayers();
		var context = Ctx(state);

		var response = await new ProposeTradeHandler(new CorroRulebook()).HandleAsync(
			new ProposeTradeCommand { PlayerId = "a", TargetPlayerId = "b", OfferedMoney = 100 }, context);

		var proposed = Assert.IsType<TradeProposedResponse>(response);
		Assert.Equal("a", proposed.InitiatorId);
		Assert.Equal("b", proposed.TargetId);
		Assert.Equal(100, proposed.Offered.Money);
		Assert.NotNull(state.ActiveTrade);
	}

	[Fact]
	public async Task ProposeTrade_ExpandsPropertiesWithPriceAndGroupName()
	{
		// Bug #4: the review DTO must carry each property's price (so the target sees its worth
		// in the board currency) and its group-name key (so the UI shows the group, not the raw
		// hex colour). Before, BuildSide sent only index/name/colour.
		var state = TwoPlayers();
		state.Squares[19] = new Square { Id = 19, Name = "Acería Tubal", Type = "property", Price = 200, Color = "#8a5a2b", GroupNameKey = "groups.g6", OwnerId = "a" };
		state.Players.First(p => p.Id == "a").Properties.Add(19);

		var response = await new ProposeTradeHandler(new CorroRulebook()).HandleAsync(
			new ProposeTradeCommand { PlayerId = "a", TargetPlayerId = "b", OfferedProperties = new() { 19 } }, Ctx(state));

		var prop = Assert.Single(Assert.IsType<TradeProposedResponse>(response).Offered.Properties);
		Assert.Equal(200, prop.Price);
		Assert.Equal("groups.g6", prop.GroupNameKey);
		Assert.Equal("Acería Tubal", prop.Name);
	}

	[Fact]
	public async Task RespondTrade_Accept_ExecutesAndResolves()
	{
		var state = TwoPlayers();
		var context = Ctx(state);
		var rulebook = new CorroRulebook();
		await new ProposeTradeHandler(rulebook).HandleAsync(
			new ProposeTradeCommand { PlayerId = "a", TargetPlayerId = "b", OfferedMoney = 100 }, context);
		var tradeId = state.ActiveTrade!.Id;

		var response = await new RespondTradeHandler(rulebook).HandleAsync(
			new RespondTradeCommand { PlayerId = "b", TradeId = tradeId, Accept = true }, context);

		var resolved = Assert.IsType<TradeResolvedResponse>(response);
		Assert.Equal("accepted", resolved.Outcome);
		Assert.Null(state.ActiveTrade);
	}

	[Fact]
	public async Task RespondTrade_UnknownResponder_IsRejected()
	{
		var response = await new RespondTradeHandler(new CorroRulebook()).HandleAsync(
			new RespondTradeCommand { PlayerId = "ghost", TradeId = "T1", Accept = true }, Ctx(TwoPlayers()));

		Assert.Equal("PLAYER_NOT_FOUND", Assert.IsType<ErrorResponse>(response).Code);
	}

	[Fact]
	public async Task CancelTrade_ByInitiator_Resolves()
	{
		var state = TwoPlayers();
		var context = Ctx(state);
		var rulebook = new CorroRulebook();
		await new ProposeTradeHandler(rulebook).HandleAsync(
			new ProposeTradeCommand { PlayerId = "a", TargetPlayerId = "b", OfferedMoney = 100 }, context);
		var tradeId = state.ActiveTrade!.Id;

		var response = await new CancelTradeHandler(rulebook).HandleAsync(
			new CancelTradeCommand { PlayerId = "a", TradeId = tradeId }, context);

		var resolved = Assert.IsType<TradeResolvedResponse>(response);
		Assert.Equal("cancelled", resolved.Outcome);
		Assert.Null(state.ActiveTrade);
	}
}
