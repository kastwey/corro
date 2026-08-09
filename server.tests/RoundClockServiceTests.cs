using CorroServer.Services;

namespace CorroServer.Tests;

public class RoundClockServiceTests
{
	private static readonly DateTime Start = new(2026, 7, 24, 12, 0, 0, DateTimeKind.Utc);

	[Fact]
	public void Countdown_uses_the_authoritative_deadline_and_ceiling_seconds()
	{
		var beginning = RoundClockService.Evaluate(Start, 60, Start);
		var nearlyOneSecond = RoundClockService.Evaluate(Start, 60, Start.AddMilliseconds(999));
		var finalFraction = RoundClockService.Evaluate(Start, 60, Start.AddMilliseconds(59_001));

		Assert.Equal(60, beginning.RemainingSeconds);
		Assert.Equal(60, nearlyOneSecond.RemainingSeconds);
		Assert.Equal(1, finalFraction.RemainingSeconds);
		Assert.False(finalFraction.Expired);
	}

	[Fact]
	public void Countdown_expires_once_and_never_reports_negative_time()
	{
		var exact = RoundClockService.Evaluate(Start, 60, Start.AddSeconds(60));
		var late = RoundClockService.Evaluate(Start, 60, Start.AddMinutes(5));
		var restoredLongAgo = RoundClockService.Evaluate(Start, 60, Start.AddDays(90));

		Assert.True(exact.Expired);
		Assert.Equal(0, exact.RemainingSeconds);
		Assert.True(late.Expired);
		Assert.Equal(0, late.RemainingMilliseconds);
		Assert.True(restoredLongAgo.Expired);
		Assert.Equal(0, restoredLongAgo.RemainingMilliseconds);
	}

	[Fact]
	public void Countdown_never_exceeds_its_duration_when_the_host_clock_moves_backwards()
	{
		var skewed = RoundClockService.Evaluate(Start, 60, Start.AddSeconds(-5));

		Assert.False(skewed.Expired);
		Assert.Equal(60, skewed.RemainingSeconds);
	}

	[Fact]
	public void Shared_countdown_keeps_the_auction_last_second_reset_semantics()
	{
		var now = Start.AddMinutes(3);
		var freshBid = AuctionTimerService.EvaluateBidTick(20, now.AddMilliseconds(-200), now);

		Assert.False(freshBid.Expired);
		Assert.Equal(20, freshBid.RemainingSeconds);
	}
}
