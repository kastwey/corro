using CorroServer.Hubs;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Who is here, by account — a different question from the one <see cref="GameSessionRegistry"/>
/// answers. That one knows about seats; this one about people, so somebody signed in and reading
/// the lobby is present without sitting anywhere.
///
/// The property that matters is that a PERSON is one entry however many tabs they have open. A
/// count that rose with tabs would make the room look busier than it is, and one that fell on the
/// first tab closed would blink people out of a list their friends are reading.
/// </summary>
public class PresenceRegistryTests
{
	[Fact]
	public void Somebody_signed_in_is_present_without_sitting_anywhere()
	{
		var presence = new PresenceRegistry();
		Assert.False(presence.IsOnline("u1"));

		presence.Add("u1", "c1");

		Assert.True(presence.IsOnline("u1"));
		Assert.Equal(1, presence.OnlineCount);
	}

	[Fact]
	public void Three_tabs_are_one_person_and_they_leave_with_the_last_one()
	{
		var presence = new PresenceRegistry();
		presence.Add("u1", "c1");
		presence.Add("u1", "c2");
		presence.Add("u1", "c3");
		Assert.Equal(1, presence.OnlineCount);

		presence.Remove("u1", "c1");
		presence.Remove("u1", "c2");
		Assert.True(presence.IsOnline("u1"), "closing a tab is not leaving");

		presence.Remove("u1", "c3");
		Assert.False(presence.IsOnline("u1"));
		Assert.Equal(0, presence.OnlineCount);
	}

	[Fact]
	public void Removing_a_connection_nobody_holds_is_harmless()
	{
		var presence = new PresenceRegistry();
		presence.Remove("ghost", "c1");
		presence.Add("u1", "c1");
		presence.Remove("u1", "never-existed");

		Assert.True(presence.IsOnline("u1"));
	}

	[Fact]
	public void The_room_is_everybody_with_a_live_connection()
	{
		var presence = new PresenceRegistry();
		presence.Add("u1", "c1");
		presence.Add("u2", "c2");
		presence.Add("u2", "c3");

		Assert.Equal(new[] { "u1", "u2" }, presence.OnlineUserIds().OrderBy(id => id));
		Assert.Equal(new[] { "c2", "c3" }, presence.ConnectionsOf("u2").OrderBy(id => id));
		Assert.Empty(presence.ConnectionsOf("nobody"));
	}

	// The status is derived from what the server already knows, so nobody reports their own and
	// nobody can lie about it. The registry below is what the presence endpoint reads.
	[Fact]
	public void Where_a_connection_is_comes_from_the_session_registry()
	{
		var sessions = GameSessionRegistryTests.NewStubRegistry();
		sessions.MapLobbyConnection("at-table", "g1");
		sessions.MapConnectionToGame("on-board", "g1");

		Assert.True(sessions.TryLocateConnection("at-table", out var tableGame, out var tableOnBoard));
		Assert.Equal("g1", tableGame);
		Assert.False(tableOnBoard);

		Assert.True(sessions.TryLocateConnection("on-board", out var boardGame, out var boardOnBoard));
		Assert.Equal("g1", boardGame);
		Assert.True(boardOnBoard);

		// Signed in and reading the lobby: present, but nowhere in particular.
		Assert.False(sessions.TryLocateConnection("just-browsing", out _, out _));
	}

	[Fact]
	public void A_table_with_no_match_running_is_not_playing()
	{
		var sessions = GameSessionRegistryTests.NewStubRegistry();
		Assert.False(sessions.IsMatchRunning("g1"), "a game nobody registered is not running");
	}
}
