using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Rules;

namespace CorroServer.Tests.Integration;

/// <summary>
/// A single, deterministic, end-to-end Corro game with four players that walks the
/// real <see cref="CorroRulebook"/> (and <see cref="AuctionRulebook"/>) through every
/// major mechanic — purchases, rent between players, completing a colour classic and
/// building smallBuildings, railroad/utility rent scaling, tax, card cards, going to
/// holding and release (payment + doubles), declining into an auction, an unaffordable rent
/// turning into a debt resolved by mortgaging, and finally three bankruptcies that crown
/// a winner.
///
/// It is intentionally one long game rather than many tiny scenarios: a real playthrough
/// is the harshest regression canary, because a rule change that quietly breaks how two
/// mechanics interact will surface here even when each unit test still passes.
///
/// Every move is scripted (dice come from <see cref="ScriptedRandomSource"/>), so the run
/// is fully deterministic. Through the early/mid game we also assert the money-conservation
/// invariant (players + bank is constant, because every transfer is closed). The engineered
/// endgame deliberately tunes balances to force debt and bankruptcy, so conservation no
/// longer holds there — that boundary is called out explicitly below.
/// </summary>
public class FullGamePlaythroughTests
{
	private const int StartingMoney = 1500;

	// Four players, four laps of the board boiled down to the moments that matter.
	private const string A = "a";
	private const string B = "b";
	private const string C = "c";
	private const string D = "d";

	[Fact]
	public async Task A_full_four_player_game_exercises_every_major_mechanic_and_crowns_a_winner()
	{
		var players = new List<Player>
		{
			TestFixtures.NewPlayer(A, money: StartingMoney, token: "disc"),
			TestFixtures.NewPlayer(B, money: StartingMoney, token: "star"),
			TestFixtures.NewPlayer(C, money: StartingMoney, token: "diamond"),
			TestFixtures.NewPlayer(D, money: StartingMoney, token: "cross"),
		};

		// Bank starts with the standard remainder, so players + bank == 20580 throughout.
		var bankMoney = GameConstants.CalculateBankMoney(players.Count);
		var initialTotal = players.Sum(p => p.Money) + bankMoney; // 20580
		Assert.Equal(20580, initialTotal);

		var h = new GameHarness(players, FullGameBoard(), new GameSettings(), bankMoney: bankMoney);

		// Deterministic decks: drawn from the top, in order.
		h.StackChanceDeck("chance_advance_go");
		h.StackCommunityDeck("community_doctor_fee", "community_send_to_holding");

		// ── Local helpers — keep the script readable as a sequence of plays. ──────────
		int Money(string id) => h.Player(id).Money;
		int Bank() => h.State.Bank.Money;
		int Pos(string id) => h.Player(id).Position;
		string? Owner(int idx) => h.Context.Helper.GetSquare(idx)!.OwnerId;
		int SmallBuildings(int idx) => h.Context.Helper.GetSquare(idx)!.SmallBuildings;
		string Cur() => h.State.CurrentTurn!;
		void Conserve() => Assert.Equal(initialTotal, TestFixtures.TotalMoney(h.State));

		async Task End(string id)
		{
			var outcome = await h.Rulebook.EndTurnAsync(h.Player(id), h.Context);
			Assert.True(outcome.Success);
		}

		async Task Buy(string id, int idx)
		{
			var outcome = await h.Rulebook.BuyPropertyAsync(h.Player(id), idx, h.Context);
			Assert.True(outcome.Success, outcome.Error);
			Assert.Equal(id, Owner(idx));
		}

		async Task Build(string id, int idx)
		{
			var outcome = await h.Rulebook.BuildAsync(h.Player(id), idx, h.Context);
			Assert.True(outcome.Success, outcome.Error);
		}

		// =====================================================================
		// PHASE 1 — Opening moves: a purchase, a tax, a card teleport.
		// =====================================================================
		Assert.Equal(A, Cur());

		// a buys the first railroad.
		var before = Money(A);
		await h.RollAsync(A, 2, 3);            // 0 -> 5 (RR1)
		Assert.Equal(5, Pos(A));
		await Buy(A, 5);
		Assert.Equal(before - 200, Money(A));
		await End(A);
		Conserve();

		// b lands on Income Tax and pays the bank.
		(before, var bankBefore) = (Money(B), Bank());
		await h.RollAsync(B, 1, 3);            // 0 -> 4 (Income Tax 200)
		Assert.Equal(4, Pos(B));
		Assert.Equal(before - 200, Money(B));
		Assert.Equal(bankBefore + 200, Bank());
		await End(B);
		Conserve();

		// c buys a light-blue.
		before = Money(C);
		await h.RollAsync(C, 2, 4);            // 0 -> 6 (light-blue 100)
		await Buy(C, 6);
		Assert.Equal(before - 100, Money(C));
		await End(C);
		Conserve();

		// d hits Chance and is teleported to GO, collecting the salary.
		(before, bankBefore) = (Money(D), Bank());
		await h.RollAsync(D, 2, 5);            // 0 -> 7 (Chance) -> advance to GO
		Assert.Equal(0, Pos(D));
		Assert.Equal(before + 200, Money(D));
		Assert.Equal(bankBefore - 200, Bank());
		await End(D);
		Conserve();

		// =====================================================================
		// PHASE 2 — Decline into an auction, then complete a classic and build.
		// =====================================================================

		// a lands on an unowned light-blue and declines -> it goes to auction.
		await h.RollAsync(A, 1, 2);            // 5 -> 8 (light-blue 100, unowned)
		Assert.Equal(8, Pos(A));
		var decline = await h.Rulebook.DeclinePropertyAsync(h.Player(A), 8, h.Context);
		Assert.True(decline.Success);
		Assert.True(decline.AuctionStarted);
		Assert.NotNull(h.State.ActiveAuction);

		// The auction: c bids 60, everyone else passes, c wins. EndAuction advances the turn.
		var auctioneer = new AuctionRulebook();
		before = Money(C);
		bankBefore = Bank();
		var bid = await auctioneer.PlaceBidAsync(C, 8, 60, h.Context);
		Assert.True(bid.Success, bid.Error);
		Assert.False(bid.AuctionEnded);       // a, b and d can still outbid
		Assert.True((await auctioneer.PassAuctionAsync(A, 8, h.Context)).Success);
		Assert.True((await auctioneer.PassAuctionAsync(B, 8, h.Context)).Success);
		var lastPass = await auctioneer.PassAuctionAsync(D, 8, h.Context);
		Assert.True(lastPass.AuctionEnded);
		Assert.Equal(C, lastPass.FinalResult!.WinnerId);
		Assert.Equal(C, Owner(8));
		Assert.Equal(before - 60, Money(C));
		Assert.Equal(bankBefore + 60, Bank());
		Assert.Null(h.State.ActiveAuction);
		Assert.Equal(B, Cur());               // turn advanced past a (the auction initiator)
		Conserve();

		// b just visits holding.
		await h.RollAsync(B, 2, 4);            // 4 -> 10 (Just Visiting)
		Assert.Equal(10, Pos(B));
		await End(B);
		Conserve();

		// c buys the third light-blue, completing the classic, then builds one smallBuilding on each.
		before = Money(C);
		await h.RollAsync(C, 1, 2);            // 6 -> 9 (light-blue 120)
		await Buy(C, 9);
		Assert.Equal(C, Owner(6));
		Assert.Equal(C, Owner(8));
		Assert.Equal(C, Owner(9));            // full light-blue classic
		await Build(C, 6);
		await Build(C, 8);
		await Build(C, 9);
		Assert.Equal(1, SmallBuildings(6));
		Assert.Equal(1, SmallBuildings(8));
		Assert.Equal(1, SmallBuildings(9));
		Assert.Equal(before - 120 - (3 * 50), Money(C)); // property + three smallBuildings
		await End(C);
		Conserve();

		// d lands on c's developed light-blue and pays the escalated (1-smallBuilding) rent.
		(before, var cBefore) = (Money(D), Money(C));
		await h.RollAsync(D, 2, 4);            // 0 -> 6 (light-blue, 1 smallBuilding -> rent 30)
		Assert.Equal(6, Pos(D));
		Assert.Equal(before - 30, Money(D));
		Assert.Equal(cBefore + 30, Money(C));
		await End(D);
		Conserve();

		// =====================================================================
		// PHASE 3 — Railroad rent scales with the number owned.
		// =====================================================================

		// a buys a second railroad.
		before = Money(A);
		await h.RollAsync(A, 3, 4);            // 8 -> 15 (RR2)
		await Buy(A, 15);
		Assert.Equal(before - 200, Money(A));
		await End(A);
		Conserve();

		// b lands on it: owning two railroads doubles the rent to 50.
		(before, var aBefore) = (Money(B), Money(A));
		await h.RollAsync(B, 2, 3);            // 10 -> 15 (RR2, owner has 2 railroads -> 50)
		Assert.Equal(before - 50, Money(B));
		Assert.Equal(aBefore + 50, Money(A));
		await End(B);
		Conserve();

		// =====================================================================
		// PHASE 4 — Utility rent is a multiple of the dice.
		// =====================================================================

		// c buys a utility.
		before = Money(C);
		await h.RollAsync(C, 1, 2);            // 9 -> 12 (Electric utility 150)
		await Buy(C, 12);
		Assert.Equal(before - 150, Money(C));
		await End(C);
		Conserve();

		// d rolls doubles onto the utility (rent = 4 x dice = 24), then rolls again and buys.
		(before, cBefore) = (Money(D), Money(C));
		await h.RollAsync(D, 3, 3);            // 6 -> 12 (utility, single owner -> 4 x 6 = 24)
		Assert.Equal(before - 24, Money(D));
		Assert.Equal(cBefore + 24, Money(C));
		Assert.True(h.State.MustRollAgain);    // doubles
		before = Money(D);
		await h.RollAsync(D, 2, 4);            // 12 -> 18 (orange 180)
		await Buy(D, 18);
		Assert.Equal(before - 180, Money(D));
		await End(D);
		Conserve();

		// =====================================================================
		// PHASE 5 — Go To Holding, then escape by paying release cost.
		// =====================================================================

		// Place a one short of the Go-To-Holding corner to exercise the holding pipeline deterministically.
		h.Player(A).Position = 25;
		await h.RollAsync(A, 2, 3);            // 25 -> 30 (Go To Holding)
		Assert.True(h.Player(A).IsHeld);
		Assert.Equal(10, Pos(A));              // sent to the holding square
		await End(A);
		Conserve();

		// b and c and d keep building their boards.
		before = Money(B);
		await h.RollAsync(B, 1, 3);            // 15 -> 19 (orange 200)
		await Buy(B, 19);
		Assert.Equal(before - 200, Money(B));
		await End(B);
		Conserve();

		before = Money(C);
		await h.RollAsync(C, 2, 2);            // 12 -> 16 (orange 180), doubles
		await Buy(C, 16);
		Assert.Equal(before - 180, Money(C));
		Assert.True(h.State.MustRollAgain);
		await h.RollAsync(C, 1, 3);            // 16 -> 20 (Free Parking, no effect)
		Assert.Equal(20, Pos(C));
		await End(C);
		Conserve();

		before = Money(D);
		await h.RollAsync(D, 2, 3);            // 18 -> 23 (red 220)
		await Buy(D, 23);
		Assert.Equal(before - 220, Money(D));
		await End(D);
		Conserve();

		// a pays release cost to get out of holding, then rolls onto their own railroad (no rent).
		(before, bankBefore) = (Money(A), Bank());
		var releaseCost = await h.Rulebook.PayReleaseCostAsync(h.Player(A), h.Context);
		Assert.True(releaseCost.Success, releaseCost.Error);
		Assert.False(h.Player(A).IsHeld);
		Assert.Equal(before - 50, Money(A));
		Assert.Equal(bankBefore + 50, Bank());
		await h.RollAsync(A, 2, 3);            // 10 -> 15 (own RR2, no rent)
		await End(A);
		Conserve();

		// =====================================================================
		// PHASE 6 — card-deck cards: pay the bank, then a card sends a player to holding,
		//            who escapes by rolling doubles.
		// =====================================================================

		// Place b before a card square to draw "Doctor's fee: pay 50".
		h.Player(B).Position = 28;
		(before, bankBefore) = (Money(B), Bank());
		await h.RollAsync(B, 2, 3);            // 28 -> 33 (Community -> pay 50 to bank)
		Assert.Equal(33, Pos(B));
		Assert.Equal(before - 50, Money(B));
		Assert.Equal(bankBefore + 50, Bank());
		await End(B);
		Conserve();

		// Place c before a card square to draw "Go to holding".
		h.Player(C).Position = 12;
		await h.RollAsync(C, 2, 3);            // 12 -> 17 (Community -> go to holding)
		Assert.True(h.Player(C).IsHeld);
		Assert.Equal(10, Pos(C));
		await End(C);
		Conserve();

		// d keeps playing.
		before = Money(D);
		await h.RollAsync(D, 2, 4);            // 23 -> 29 (yellow 280)
		await Buy(D, 29);
		Assert.Equal(before - 280, Money(D));
		await End(D);
		Conserve();

		// a moves harmlessly.
		await h.RollAsync(A, 1, 4);            // 15 -> 20 (Free Parking)
		Assert.Equal(20, Pos(A));
		await End(A);
		Conserve();

		// b buys a dark-blue, rolls again on doubles and passes GO.
		before = Money(B);
		await h.RollAsync(B, 2, 2);            // 33 -> 37 (dark-blue 350), doubles
		await Buy(B, 37);
		Assert.Equal(before - 350, Money(B));
		Assert.True(h.State.MustRollAgain);
		(before, bankBefore) = (Money(B), Bank());
		await h.RollAsync(B, 1, 2);            // 37 -> 0 (passes/lands GO, +200)
		Assert.Equal(0, Pos(B));
		Assert.Equal(before + 200, Money(B));
		Assert.Equal(bankBefore - 200, Bank());
		await End(B);
		Conserve();

		// c escapes holding by rolling doubles and moves onto their own orange (no rent).
		await h.RollAsync(C, 3, 3);            // holding (10) -> 16 (own orange), doubles escape
		Assert.False(h.Player(C).IsHeld);
		Assert.Equal(16, Pos(C));
		await End(C);
		Conserve();

		// The closed-economy invariant has held across the whole mid-game.
		Conserve();

		// =====================================================================
		// PHASE 7 — Endgame, played out for real. c reinvests their cash to grow the
		//            light-blue classic into bigBuildings; the other three are then bled dry
		//            by the rent they genuinely owe, until one cannot cover it even after
		//            mortgaging every asset they hold. That is a real bankruptcy earned by
		//            where they landed and what they bought — not a balance we tampered
		//            with. Because every step is a closed transfer, the money-conservation
		//            invariant keeps holding right up to the instant a player is declared
		//            bankrupt.
		// =====================================================================

		// c upgrades 6/8/9 evenly all the way to bigBuildings (each already has one smallBuilding).
		// Building costs real money, draining c's cash into the bank in exchange for
		// the ruinous rents that will decide the game.
		for (var level = 2; level <= 5; level++)
		{
			await Build(C, 6);
			await Build(C, 8);
			await Build(C, 9);
		}
		Assert.Equal(1, h.Context.Helper.GetSquare(6)!.BigBuildings);
		Assert.Equal(1, h.Context.Helper.GetSquare(8)!.BigBuildings);
		Assert.Equal(1, h.Context.Helper.GetSquare(9)!.BigBuildings);
		Conserve(); // building is a player -> bank transfer

		// Drive a loser back onto c's bigBuilding street turn after turn until the rent owed
		// exceeds everything they can raise. They mortgage every property to try to stay
		// afloat; when even that is not enough, they go bankrupt. Conservation is asserted
		// around every transfer — everything except the bankruptcy declaration itself.
		var sawAutoResolvingMortgage = false;
		async Task<BankruptcyOutcome> PlayUntilBankrupt(string id)
		{
			for (var safety = 0; safety < 12; safety++)
			{
				var total = TestFixtures.TotalMoney(h.State);

				// Land squarely on c's bigBuilding at square 9 (rent 600).
				h.Player(id).Position = 4;
				await h.RollAsync(id, 2, 3);   // 4 -> 9
				Assert.Equal(9, Pos(id));

				if (!h.State.PendingDebts.Any(x => x.DebtorId == id))
				{
					// They paid the rent outright: a pure transfer to c.
					Assert.Equal(total, TestFixtures.TotalMoney(h.State));
					continue;
				}

				// They are in debt. Liquidate every property they still own to try to cover it.
				foreach (var propIndex in h.Player(id).Properties.ToList())
				{
					if (h.Context.Helper.GetSquare(propIndex)!.Mortgaged)
					{
						continue;
					}

					var beforeMortgage = TestFixtures.TotalMoney(h.State);
					var result = await h.Rulebook.MortgagePropertyAsync(h.Player(id), propIndex, h.Context);
					Assert.True(result.Success, result.Error);
					// The GameService pipeline runs the debt sweep after each command; this
					// harness drives the rulebook directly, so invoke it to mirror that.
					await h.Rulebook.SweepResolvableDebtsAsync(h.Context);
					// Mortgaging (bank -> player) plus any auto-resolved debt (player -> c)
					// are all closed transfers.
					Assert.Equal(beforeMortgage, TestFixtures.TotalMoney(h.State));
					if (!h.State.PendingDebts.Any(x => x.DebtorId == id))
					{
						sawAutoResolvingMortgage = true; // raised enough to clear the debt
						break;                            // survive to fight another turn
					}
				}

				if (h.State.PendingDebts.Any(x => x.DebtorId == id))
				{
					// Even after mortgaging everything, they still cannot pay. Bankruptcy.
					return await h.Rulebook.DeclareBankruptcyAsync(h.Player(id), h.Context);
				}
			}

			Assert.Fail($"Player {id} never went bankrupt");
			throw new InvalidOperationException(); // unreachable, keeps the compiler happy
		}

		// =====================================================================
		// PHASE 8 — The rent grinds three players out; the last one standing wins.
		// =====================================================================

		var aBankrupt = await PlayUntilBankrupt(A);
		Assert.True(aBankrupt.Success);
		Assert.Equal(0, Money(A));
		Assert.Empty(h.Player(A).Properties);
		Assert.False(aBankrupt.GameOver);
		Assert.Equal(3, aBankrupt.RemainingPlayers);
		Assert.Equal(C, Owner(5));             // a's railroads pass to creditor c
		Assert.Equal(C, Owner(15));

		var bBankrupt = await PlayUntilBankrupt(B);
		Assert.True(bBankrupt.Success);
		Assert.Equal(0, Money(B));
		Assert.Empty(h.Player(B).Properties);
		Assert.False(bBankrupt.GameOver);
		Assert.Equal(2, bBankrupt.RemainingPlayers);

		var dBankrupt = await PlayUntilBankrupt(D);
		Assert.True(dBankrupt.Success);
		Assert.Empty(h.Player(D).Properties);
		Assert.True(dBankrupt.GameOver);
		Assert.Equal(1, dBankrupt.RemainingPlayers);
		Assert.Equal(C, dBankrupt.WinnerId);
		Assert.Equal(C, dBankrupt.WinnerName);

		// At least one loser bought themselves an extra turn by mortgaging assets to clear
		// the debt before finally succumbing — proof of a gradual bleed, not an instant wipe.
		Assert.True(sawAutoResolvingMortgage);

		// The winner is the last player still standing with money and property.
		Assert.True(Money(C) > 0);
		Assert.NotEmpty(h.Player(C).Properties);
		Assert.Contains(h.Announcer.Sent, m => m.Key == "game.game_over");
	}

	[Fact]
	public async Task Landing_on_unpayable_rent_auto_forces_bankruptcy_through_the_debt_sweep()
	{
		// Companion to the long playthrough above, which exercises *manual* bankruptcy
		// (the player explicitly declares once mortgaging cannot save them). This pins the
		// other path: a genuinely insolvent player is forced into bankruptcy AUTOMATICALLY
		// by the post-command debt sweep — the rules decide it, the test never calls
		// DeclareBankruptcyAsync. The whole turn is played for real: a dice roll lands the
		// pauper on a bigBuilding they cannot afford, rent becomes an unpayable debt, and the
		// sweep (which GameService runs after every command) liquidates them.
		var pauper = TestFixtures.NewPlayer("p", money: 100, token: "disc");
		var landlord = TestFixtures.NewPlayer("r", money: 1500, token: "star");

		var board = FullGameBoard();
		// The landlord owns the whole light-blue classic with a bigBuilding on square 9, so the
		// rent there is a ruinous 600 (rent table index 5).
		foreach (var idx in new[] { 6, 8, 9 })
		{
			board[idx].OwnerId = "r";
			landlord.Properties.Add(idx);
		}
		board[9].BigBuildings = 1;
		// The pauper owns one cheap brown (price 60) — its 30 mortgage value plus their 100
		// cash totals 130 liquidatable, nowhere near the 600 rent: genuinely insolvent.
		board[1].OwnerId = "p";
		pauper.Properties.Add(1);

		var h = new GameHarness(new[] { pauper, landlord }, board, new GameSettings(), bankMoney: 10000);
		foreach (var idx in new[] { 1, 6, 8, 9 })
		{
			h.State.Ownership.Add(new SquareOwnership { Index = idx, OwnerId = h.Context.Helper.GetSquare(idx)!.OwnerId! });
		}

		h.State.CurrentTurn = "p";

		// Sanity: the rules agree the pauper cannot cover the looming rent.
		Assert.True(h.Rulebook.GetLiquidatableAssets(pauper, h.Context) < 600);

		// Play the turn: roll 4+5 = 9, landing on the bigBuilding. Rent is unaffordable, so the
		// landing creates a pending rent debt instead of a payment.
		await h.RollAsync("p", 4, 5);
		Assert.Equal(9, pauper.Position);
		var rentDebt = Assert.Single(h.State.PendingDebts, d => d.DebtorId == "p");
		Assert.Equal(600, rentDebt.Amount);
		Assert.Equal("r", rentDebt.CreditorId);
		Assert.False(pauper.IsBankrupt); // not yet — the sweep has not run

		// GameService runs the debt sweep after every command; mirror that single call.
		// No money-gainers exist and the debtor is insolvent, so the sweep must FORCE the
		// bankruptcy automatically — we never call DeclareBankruptcyAsync ourselves.
		await h.Rulebook.SweepResolvableDebtsAsync(h.Context);

		// The pauper is wiped out and their estate handed to the creditor.
		Assert.True(pauper.IsBankrupt);
		Assert.Equal(0, pauper.Money);
		Assert.Empty(pauper.Properties);
		Assert.Empty(h.State.PendingDebts);

		Assert.Equal(1600, landlord.Money);             // 1500 + the pauper's 100 cash
		Assert.Contains(1, landlord.Properties);        // the brown is transferred
		Assert.Equal("r", h.Context.Helper.GetSquare(1)!.OwnerId);
		Assert.Equal("r", h.State.Ownership.Single(o => o.Index == 1).OwnerId);

		// Last player standing -> the game is over and the landlord is crowned.
		Assert.True(h.State.IsGameOver);
		Assert.Equal("r", h.State.WinnerId);

		// The server voices both the bankruptcy and the win (third-person to everyone else).
		Assert.Contains(h.Announcer.Sent, m => m.Key == "game.player_bankrupt");
		Assert.Contains(h.Announcer.Sent, m => m.Key == "game.game_over");
	}

	// ────────────────────────────────────────────────────────────────────────────
	// A hand-built 40-square board that mirrors the classic layout closely
	// enough to exercise every mechanic, with indices the test controls precisely.
	// ────────────────────────────────────────────────────────────────────────────
	private static List<Square> FullGameBoard() => new()
	{
		Corner(0, "GO", "go"),
		Prop(1, "Brown 1", "brown", 60, new[] { 2, 10, 30, 90, 160, 250 }, 50),
		Card(2, "Treasury", "community"),
		Prop(3, "Brown 2", "brown", 60, new[] { 4, 20, 60, 180, 320, 450 }, 50),
		Tax(4, "Income Tax", "income_tax", 200),
		Rail(5, "Railroad 1"),
		Prop(6, "Light Blue 1", "lightblue", 100, new[] { 6, 30, 90, 270, 400, 550 }, 50),
		Card(7, "Chance", "chance"),
		Prop(8, "Light Blue 2", "lightblue", 100, new[] { 6, 30, 90, 270, 400, 550 }, 50),
		Prop(9, "Light Blue 3", "lightblue", 120, new[] { 8, 40, 100, 300, 450, 600 }, 50),
		Corner(10, "Holding", "holding"),
		Prop(11, "Pink 1", "pink", 140, new[] { 10, 50, 150, 450, 625, 750 }, 100),
		Util(12, "Electric Company"),
		Prop(13, "Pink 2", "pink", 140, new[] { 10, 50, 150, 450, 625, 750 }, 100),
		Prop(14, "Pink 3", "pink", 160, new[] { 12, 60, 180, 500, 700, 900 }, 100),
		Rail(15, "Railroad 2"),
		Prop(16, "Orange 1", "orange", 180, new[] { 14, 70, 200, 550, 750, 950 }, 100),
		Card(17, "Treasury", "community"),
		Prop(18, "Orange 2", "orange", 180, new[] { 14, 70, 200, 550, 750, 950 }, 100),
		Prop(19, "Orange 3", "orange", 200, new[] { 16, 80, 220, 600, 800, 1000 }, 100),
		Corner(20, "Free Parking", "free_parking"),
		Prop(21, "Red 1", "red", 220, new[] { 18, 90, 250, 700, 875, 1050 }, 150),
		Card(22, "Chance", "chance"),
		Prop(23, "Red 2", "red", 220, new[] { 18, 90, 250, 700, 875, 1050 }, 150),
		Prop(24, "Red 3", "red", 240, new[] { 20, 100, 300, 750, 925, 1100 }, 150),
		Rail(25, "Railroad 3"),
		Prop(26, "Yellow 1", "yellow", 260, new[] { 22, 110, 330, 800, 975, 1150 }, 150),
		Prop(27, "Yellow 2", "yellow", 260, new[] { 22, 110, 330, 800, 975, 1150 }, 150),
		Util(28, "Water Works"),
		Prop(29, "Yellow 3", "yellow", 280, new[] { 24, 120, 360, 850, 1025, 1200 }, 150),
		Corner(30, "Go To Holding", "goto_holding"),
		Prop(31, "Green 1", "green", 300, new[] { 26, 130, 390, 900, 1100, 1275 }, 200),
		Prop(32, "Green 2", "green", 300, new[] { 26, 130, 390, 900, 1100, 1275 }, 200),
		Card(33, "Treasury", "community"),
		Prop(34, "Green 3", "green", 320, new[] { 28, 150, 450, 1000, 1200, 1400 }, 200),
		Rail(35, "Railroad 4"),
		Card(36, "Chance", "chance"),
		Prop(37, "Dark Blue 1", "darkblue", 350, new[] { 35, 175, 500, 1100, 1300, 1500 }, 200),
		Tax(38, "Luxury Tax", "luxury_tax", 100),
		Prop(39, "Dark Blue 2", "darkblue", 400, new[] { 50, 200, 600, 1400, 1700, 2000 }, 200),
	};

	private static Square Prop(int id, string name, string color, int price, int[] rent, int houseCost)
		=> new() { Id = id, Name = name, Type = "property", Color = color, Price = price, Rent = rent.ToList(), BuildingCost = houseCost };

	private static Square Rail(int id, string name)
		=> new() { Id = id, Name = name, Type = "railroad", Price = 200 };

	private static Square Util(int id, string name)
		=> new() { Id = id, Name = name, Type = "utility", Price = 150 };

	private static Square Tax(int id, string name, string key, int amount)
		=> new() { Id = id, Name = name, Type = "tax", Key = key, Amount = amount };

	private static Square Corner(int id, string name, string key)
		=> new() { Id = id, Name = name, Type = "corner", Key = key };

	private static Square Card(int id, string name, string type)
		=> new() { Id = id, Name = name, Type = type };
}
