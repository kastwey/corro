using CorroServer.Hubs;

namespace CorroServer.Tests;

/// <summary>
/// When the re-entry code is worth showing.
///
/// It answers one question — how somebody gets back to their seat after losing the browser data
/// holding it — and an account answers it better, from a device that has never seen the table. So
/// a signed-in player is not asked to note down a string nothing will ever ask them for.
///
/// The code is never DELETED for this, and the decision is made per caller rather than per seat:
/// signing out has to give it back, or leaving an account would quietly become a way to lose a
/// table forever.
/// </summary>
public class RejoinCodeVisibilityTests
{
	[Fact]
	public void An_anonymous_player_is_given_their_code()
	{
		Assert.Equal("A2B3C4D5", GameHub.RejoinCodeToShow(null, null, "A2B3C4D5"));
	}

	[Fact]
	public void A_signed_in_player_sitting_in_their_own_seat_is_not()
	{
		Assert.Null(GameHub.RejoinCodeToShow("user-1", "user-1", "A2B3C4D5"));
	}

	// The seat is held through the browser, and the account is gone: the code is the only way back.
	[Fact]
	public void Signing_out_gives_it_back()
	{
		Assert.Equal("A2B3C4D5", GameHub.RejoinCodeToShow(null, "user-1", "A2B3C4D5"));
	}

	// A seat taken anonymously and never adopted is NOT found by GetMyTables, so hiding the code
	// there would strand somebody who has no other way home.
	[Fact]
	public void A_signed_in_player_in_a_seat_that_carries_no_account_still_gets_it()
	{
		Assert.Equal("A2B3C4D5", GameHub.RejoinCodeToShow("user-1", null, "A2B3C4D5"));
		Assert.Equal("A2B3C4D5", GameHub.RejoinCodeToShow("user-1", "", "A2B3C4D5"));
	}

	// Two accounts at one table: the other person's seat is not this caller's way back.
	[Fact]
	public void Another_accounts_seat_is_not_this_callers_recovery()
	{
		Assert.Equal("A2B3C4D5", GameHub.RejoinCodeToShow("user-1", "user-2", "A2B3C4D5"));
	}

	[Fact]
	public void Nothing_to_show_stays_nothing()
	{
		Assert.Null(GameHub.RejoinCodeToShow(null, null, null));
	}
}
