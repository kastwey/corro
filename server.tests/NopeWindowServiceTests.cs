using CorroServer.Services;

namespace CorroServer.Tests;

/// <summary>
/// The Nope window's countdown is a pure function (no real timers): the window elapses exactly
/// when the configured span has passed since its authoritative start, and each Nope restarts it
/// by moving that start forward — the same reset-on-last-action shape as the auction bid timer.
/// </summary>
public class NopeWindowServiceTests
{
	private static readonly DateTime Start = new(2026, 7, 7, 12, 0, 0, DateTimeKind.Utc);

	[Fact]
	public void Window_has_not_expired_before_its_span()
		=> Assert.False(NopeWindowService.Expired(Start, 2000, Start.AddMilliseconds(1999)));

	[Fact]
	public void Window_expires_once_the_span_has_passed()
		=> Assert.True(NopeWindowService.Expired(Start, 2000, Start.AddMilliseconds(2000)));

	[Fact]
	public void A_fresh_nope_moves_the_start_forward_and_restarts_the_countdown()
	{
		// At t=1.9s the first window is about to close…
		Assert.False(NopeWindowService.Expired(Start, 2000, Start.AddMilliseconds(1900)));
		// …a Nope lands at t=1.9s, moving the authoritative start there. Now t=3.5s is only
		// 1.6s into the RESTARTED window — still open.
		var afterNope = Start.AddMilliseconds(1900);
		Assert.False(NopeWindowService.Expired(afterNope, 2000, Start.AddMilliseconds(3500)));
		// It finally closes 2s after the Nope.
		Assert.True(NopeWindowService.Expired(afterNope, 2000, afterNope.AddMilliseconds(2000)));
	}

	[Fact]
	public void Remaining_millis_counts_down_and_never_goes_negative()
	{
		Assert.Equal(2000, NopeWindowService.RemainingMillis(Start, 2000, Start));
		Assert.Equal(500, NopeWindowService.RemainingMillis(Start, 2000, Start.AddMilliseconds(1500)));
		Assert.Equal(0, NopeWindowService.RemainingMillis(Start, 2000, Start.AddMilliseconds(9000)));
	}
}
