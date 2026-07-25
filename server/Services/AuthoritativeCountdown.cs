namespace CorroServer.Services;

/// <summary>Pure deadline arithmetic shared by every real-time server clock. The mutable game
/// state owns the UTC start; services only sample it, so a command that advances the timestamp
/// wins immediately over an old timer tick.</summary>
internal static class AuthoritativeCountdown
{
	internal readonly record struct Decision(int RemainingMilliseconds, bool Expired)
	{
		public int RemainingSeconds => Math.Max(0, (int)Math.Ceiling(RemainingMilliseconds / 1000d));
	}

	internal static Decision Evaluate(DateTime startedAtUtc, int durationMilliseconds, DateTime nowUtc)
	{
		var duration = Math.Max(0, durationMilliseconds);
		// A restored timestamp may be days or months old, far beyond Int32 milliseconds.
		// Keep the arithmetic in double until the bounded remainder is known. Clamp negative
		// elapsed time too: modest host clock skew must not display more than a full window.
		var elapsed = Math.Max(0d, (nowUtc - startedAtUtc).TotalMilliseconds);
		var remaining = Math.Max(0d, duration - elapsed);
		return new Decision(
			(int)Math.Ceiling(remaining),
			elapsed >= duration);
	}
}
