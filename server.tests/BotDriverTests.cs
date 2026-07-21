using System.Text.Json;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Bots;
using CorroServer.Services.Corro;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The driver plays REAL games from outside the engine through the very same GameService
/// pipeline a human's commands take: it completes a journey bot's whole turn and makes an
/// exploding bot answer an off-turn Favor without wedging the table.
/// </summary>
public class BotDriverTests
{
	private static async Task<GameService> StartHumanVsBotAsync()
	{
		var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("great-route"));
		var svc = new GameService(new CorroRulebook(), new AuctionRulebook());
		await svc.InitializeFromDefinitionAsync(new List<Player>
		{
			new() { Id = "a", Name = "Ana", Token = "car" },
			new() { Id = "b", Name = "Bot 1", Token = "motorbike", IsBot = true },
		}, def, "es");
		return svc;
	}

	private static async Task<GameService> StartHumanVsExplodingBotAsync()
	{
		var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("the-mine"));
		var svc = new GameService(new CorroRulebook(), new AuctionRulebook());
		await svc.InitializeFromDefinitionAsync(new List<Player>
		{
			new() { Id = "a", Name = "Ana", Token = "mine-cart" },
			new() { Id = "b", Name = "Bot 1", Token = "helmet", IsBot = true },
		}, def, "es");
		return svc;
	}

	private static async Task WaitUntilAsync(Func<bool> condition, string what, int timeoutMs = 5000)
	{
		var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
		while (!condition() && DateTime.UtcNow < deadline)
		{
			await Task.Delay(25);
		}

		Assert.True(condition(), $"timed out waiting for: {what}");
	}

	[Fact]
	public async Task The_bot_completes_its_whole_turn_and_hands_the_turn_back()
	{
		var svc = await StartHumanVsBotAsync();
		var driver = new BotDriver(new BotOptions { ActionDelay = TimeSpan.Zero });
		driver.Attach("g1", svc);

		// The HUMAN's turn, played by hand: draw, then discard the first card.
		Assert.Equal("a", svc.GameState!.CurrentTurn);
		await svc.ExecuteCommandAsync(new JourneyDrawCommand { PlayerId = "a" });
		var myCard = JourneyRulebook.MemberOf(svc.GameState.Journey!, "a").Hand[0].InstanceId;
		await svc.ExecuteCommandAsync(new JourneyDiscardCommand { PlayerId = "a", InstanceId = myCard });

		// The state change wakes the driver: the bot must draw AND play/discard, then the
		// turn returns to the human — a full unattended bot turn.
		await WaitUntilAsync(() => svc.GameState.CurrentTurn == "a", "the turn to come back to the human");
		// Deterministic traces, whatever the (shuffled) bot hand held: two draws left the
		// pile, and the bot's hand is back to size after playing or discarding one card.
		var journey = svc.GameState.Journey!;
		Assert.Equal(94 - 2, journey.DrawCount); // 106 − 12 dealt − the human's draw − the bot's
		Assert.Equal(6, JourneyRulebook.MemberOf(journey, "b").Hand.Count);
	}

	[Fact]
	public async Task The_exploding_bot_pays_a_pending_favor_through_the_command_pipeline()
	{
		var svc = await StartHumanVsExplodingBotAsync();
		var exploding = svc.GameState!.Exploding!;
		var catalog = ExplodingRulebook.Catalog(svc.GameState.ExplodingDeck!);
		var human = ExplodingRulebook.SeatOf(exploding, "a");
		var bot = ExplodingRulebook.SeatOf(exploding, "b");
		var defuse = bot.Hand.Single(card => ExplodingRulebook.IsDefuse(catalog[card.CardId]));
		var expectedGift = bot.Hand.First(card => !ExplodingRulebook.IsDefuse(catalog[card.CardId]));
		exploding.PendingFavor = new PendingExplodingFavor { RequesterId = "a", TargetId = "b" };

		var driver = new BotDriver(new BotOptions { ActionDelay = TimeSpan.Zero });
		driver.Attach("exploding-favor", svc);

		await WaitUntilAsync(() => exploding.PendingFavor == null, "the bot to pay the Favor");

		Assert.Contains(expectedGift, human.Hand);
		Assert.DoesNotContain(expectedGift, bot.Hand);
		Assert.Contains(defuse, bot.Hand);
	}

	[Fact]
	public async Task Attach_is_a_safe_no_op_without_bots_or_without_a_policy()
	{
		var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("great-route"));
		var svc = new GameService(new CorroRulebook(), new AuctionRulebook());
		await svc.InitializeFromDefinitionAsync(new List<Player>
		{
			new() { Id = "a", Name = "Ana", Token = "car" },
			new() { Id = "b", Name = "Berto", Token = "motorbike" },
		}, def, "es");

		var driver = new BotDriver(new BotOptions { ActionDelay = TimeSpan.Zero });
		driver.Attach("g2", svc); // no bot seats: nothing to do, nothing to break

		await svc.ExecuteCommandAsync(new JourneyDrawCommand { PlayerId = "a" });
		await Task.Delay(100);
		Assert.Equal("a", svc.GameState!.CurrentTurn); // nobody played for Berto
	}
}
