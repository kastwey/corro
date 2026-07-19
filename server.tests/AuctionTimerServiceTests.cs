using CorroServer.Services;

namespace CorroServer.Tests;

/// <summary>
/// Tests for the auction countdown. Auctions have no global duration cap: the announced
/// "seconds left" is simply the time remaining in the current bid window, which resets on
/// every bid. The auction ends only when a bid window elapses with no new bid (or everyone
/// passes), so an actively contested auction is never cut off mid-bidding.
/// </summary>
public class AuctionTimerServiceTests
{
	[Fact]
	public void RemainingCountsDownTheBidWindow()
	{
		// 5s into a 20s bid window → 15s left.
		Assert.Equal(15, AuctionTimerService.ComputeRemainingSeconds(20, 5));
	}

	[Fact]
	public void AFreshBidGetsTheFullWindow_NoMatterHowLongTheAuctionHasRun()
	{
		// Right after a bid (0s elapsed) the countdown always starts at the full bid window,
		// even very late in a long auction — there is no cap clipping it.
		Assert.Equal(20, AuctionTimerService.ComputeRemainingSeconds(20, 0));
	}

	[Fact]
	public void ReachesZeroAtTheEndOfTheBidWindow()
	{
		Assert.Equal(0, AuctionTimerService.ComputeRemainingSeconds(20, 20));
	}

	[Fact]
	public void NeverNegative()
	{
		Assert.Equal(0, AuctionTimerService.ComputeRemainingSeconds(20, 25));
	}

	// ── EvaluateBidTick: the per-tick decision read from the shared auction state ──

	[Fact]
	public void Tick_MidWindow_ReportsRemaining_NotExpired()
	{
		var now = new DateTime(2026, 1, 1, 0, 0, 12, DateTimeKind.Utc);
		var phaseStart = now.AddSeconds(-5); // 5s into a 20s window

		var decision = AuctionTimerService.EvaluateBidTick(20, phaseStart, now);

		Assert.Equal(15, decision.RemainingSeconds);
		Assert.False(decision.Expired);
	}

	[Fact]
	public void Tick_AfterWindowElapsed_IsExpired_WithZeroRemaining()
	{
		var now = new DateTime(2026, 1, 1, 0, 0, 30, DateTimeKind.Utc);
		var phaseStart = now.AddSeconds(-20); // exactly a full 20s window with no new bid

		var decision = AuctionTimerService.EvaluateBidTick(20, phaseStart, now);

		Assert.Equal(0, decision.RemainingSeconds);
		Assert.True(decision.Expired);
	}

	[Fact]
	public void Tick_LastSecondBid_RestartsTheCountdown_AndDoesNotExpire()
	{
		// Regression: a bid landing in the final second used to lose a race because the timer
		// read a phase-start copy that the Hub only reset AFTER persisting the bid, so the
		// timeout tick fired first and ended the auction. The countdown now reads the auction's
		// CurrentPhaseStartedAt, which the rulebook moves forward the instant the bid is
		// accepted — so even though wall-clock is far past the original window start, the tick
		// sees a fresh window and never expires.
		var now = new DateTime(2026, 1, 1, 0, 5, 0, DateTimeKind.Utc);
		var phaseStartAfterBid = now.AddMilliseconds(-200); // bid just reset the window

		var decision = AuctionTimerService.EvaluateBidTick(20, phaseStartAfterBid, now);

		Assert.Equal(20, decision.RemainingSeconds);
		Assert.False(decision.Expired);
	}
}
