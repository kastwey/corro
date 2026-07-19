using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Rules;

namespace CorroServer.Tests;

/// <summary>
/// Regression tests for landing on a tax square: the announcement must say WHERE the
/// player landed (the square name), not only how much was paid, and must be personalized
/// to the actor (first-person <c>tax_paid_self</c>). Before the fix the message was just
/// "{player} paid {amount} in taxes", so a blind player never heard the square.
/// </summary>
public class TaxSquareTests
{
	private static List<Square> BoardWithTaxAt(int index, string name, int amount)
	{
		var squares = new List<Square>(GameConstants.TotalSquares);
		for (int i = 0; i < GameConstants.TotalSquares; i++)
		{
			squares.Add(i == index
				? new Square { Id = i, Name = name, Type = "tax", Amount = amount }
				: new Square { Id = i, Name = $"Square {i}", Type = "property", Price = 100 });
		}
		return squares;
	}

	[Fact]
	public async Task LandingOnTax_AnnouncesSquareName()
	{
		var taxIndex = 4;
		var a = TestFixtures.NewPlayer("a", money: 1500, position: taxIndex);
		var state = TestFixtures.NewState(new[] { a }, bankMoney: 10000,
			squares: BoardWithTaxAt(taxIndex, "Luxury Tax", amount: 100));
		var context = TestFixtures.NewContext(state);

		await new CorroRulebook().ProcessLandingEffectsAsync(a, taxIndex, context);

		var taxPaid = TestFixtures.Announcer(context).Sent
			.FirstOrDefault(x => x.Key == "game.tax_paid");
		Assert.NotNull(taxPaid);
		Assert.True(taxPaid!.Vars.TryGetValue("square", out var square));
		Assert.Equal("Luxury Tax", square);
	}

	[Fact]
	public async Task LandingOnTax_IsPersonalizedToTheActor()
	{
		var taxIndex = 4;
		var a = TestFixtures.NewPlayer("a", money: 1500, position: taxIndex);
		var b = TestFixtures.NewPlayer("b", money: 1500, position: 0);
		var state = TestFixtures.NewState(new[] { a, b }, bankMoney: 10000,
			squares: BoardWithTaxAt(taxIndex, "Luxury Tax", amount: 100));
		var context = TestFixtures.NewContext(state);

		await new CorroRulebook().ProcessLandingEffectsAsync(a, taxIndex, context);

		var announcer = TestFixtures.Announcer(context);
		// Actor hears first person; everyone else hears the third-person base.
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.tax_paid_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.tax_paid"));
	}

	[Fact]
	public async Task LandingOnTax_WhenUnaffordable_AnnouncesDebtWithSquare()
	{
		// Bug 5: even when the tax pushes the player into debt, they must still hear WHERE
		// they landed, not just a generic "debt created" line.
		var taxIndex = 4;
		var a = TestFixtures.NewPlayer("a", money: 50, position: taxIndex);
		var state = TestFixtures.NewState(new[] { a }, bankMoney: 10000,
			squares: BoardWithTaxAt(taxIndex, "Luxury Tax", amount: 100));
		var context = TestFixtures.NewContext(state);

		await new CorroRulebook().ProcessLandingEffectsAsync(a, taxIndex, context);

		var announcer = TestFixtures.Announcer(context);
		Assert.True(announcer.Has(AnnouncementAudience.Player, "a", "game.tax_debt_created_self"));
		Assert.True(announcer.Has(AnnouncementAudience.AllExcept, "a", "game.tax_debt_created"));
		var debt = announcer.Sent.First(x => x.Key == "game.tax_debt_created");
		Assert.Equal("Luxury Tax", debt.Vars["square"]);
	}
}
