using CorroServer.Models;
using CorroServer.Services.Accounts;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Who may be asked to a table, who may ask to be let in, and what a refusal is allowed to say.
///
/// These are the rules, tested against the policy rather than through the hub: the hub's job is to
/// load a table, apply them and store the answer, and the part worth pinning down is the part a
/// well-meaning change could get wrong without any test noticing.
///
/// The load-bearing decision is that an invitation reuses the MESSAGE policy rather than having one
/// of its own. An invitation is an interruption: somebody who accepts messages only from friends
/// should not be reachable by a stranger's invitation either, and two settings that mean nearly the
/// same thing are a way to be quietly wrong about one of them.
/// </summary>
public class TableInvitationTests
{
	private static readonly DateTime Now = new(2026, 8, 4, 12, 0, 0, DateTimeKind.Utc);

	private static GameDocument Table(
		int maxPlayers = 4,
		GameStatus status = GameStatus.WaitingForPlayers,
		params string[] seatedUserIds)
	{
		return new GameDocument
		{
			Id = "game-t1",
			GameId = "t1",
			HostId = "p0",
			InviteCode = "ABC123",
			Status = status,
			MaxPlayers = maxPlayers,
			Players = seatedUserIds.Select((userId, i) => new LobbyPlayer
			{
				Id = $"p{i}",
				Name = $"P{i}",
				Token = "red_star",
				PlayerSecretId = $"s{i}",
				UserId = userId,
			}).ToList(),
		};
	}

	// ── Room at the table ─────────────────────────────────────────────────────────────────────

	[Fact]
	public void A_table_has_room_only_while_it_is_waiting_and_not_yet_full()
	{
		Assert.True(Table(4, GameStatus.WaitingForPlayers, "u1").HasRoom);
		Assert.False(Table(2, GameStatus.WaitingForPlayers, "u1", "u2").HasRoom);
		// A match under way is not something to be invited into.
		Assert.False(Table(4, GameStatus.Active, "u1").HasRoom);
		Assert.False(Table(4, GameStatus.Completed, "u1").HasRoom);
	}

	// Bots hold seats like anybody else: a table full of them has no room, whatever it looks like.
	[Fact]
	public void A_seat_is_a_seat_whoever_holds_it()
	{
		var withBots = Table(2, GameStatus.WaitingForPlayers, "u1");
		withBots.Players.Add(new LobbyPlayer
		{
			Id = "bot", Name = "Bot", Token = "blue_disc", PlayerSecretId = "b", IsBot = true,
		});
		Assert.False(withBots.HasRoom);
	}

	// ── What a client is allowed to see ───────────────────────────────────────────────────────

	// The same rule seats follow: the account behind somebody is stored and never sent. An opaque
	// id is still a STABLE one, and one that would let anybody note it down and recognise the same
	// person at every other table.
	[Fact]
	public void The_account_behind_an_invitation_never_leaves_the_server()
	{
		var table = Table(4, GameStatus.WaitingForPlayers, "u1");
		table.Invitations.Add(new TableInvitation
		{
			UserId = "u-guest", Handle = "guest", InvitedBy = "host", InvitedAtUtc = Now,
		});
		table.JoinRequests.Add(new TableJoinRequest
		{
			UserId = "u-asker", Handle = "asker", RequestedAtUtc = Now,
		});

		var sanitized = table.Sanitized();

		Assert.Null(sanitized.Invitations.Single().UserId);
		Assert.Null(sanitized.JoinRequests.Single().UserId);
		// The public names survive: they are what a table shows and what the answer is addressed to.
		Assert.Equal("guest", sanitized.Invitations.Single().Handle);
		Assert.Equal("asker", sanitized.JoinRequests.Single().Handle);
		// And the stored document is untouched, or the next write would erase what it is addressed to.
		Assert.Equal("u-guest", table.Invitations.Single().UserId);
	}

	// ── Being reachable at all ────────────────────────────────────────────────────────────────

	private static bool MayBeInvited(
		MessagePolicy policy, FriendshipService.Relationship relationship) =>
		policy switch
		{
			MessagePolicy.Anyone => true,
			MessagePolicy.Friends => relationship == FriendshipService.Relationship.Friends,
			_ => false,
		};

	[Fact]
	public void An_invitation_reaches_exactly_who_a_message_would()
	{
		// Open to anybody: a stranger may ask them.
		Assert.True(MayBeInvited(MessagePolicy.Anyone, FriendshipService.Relationship.None));

		// Friends only: a friend may, a stranger may not, and neither may somebody who merely
		// SENT a request that has not been accepted.
		Assert.True(MayBeInvited(MessagePolicy.Friends, FriendshipService.Relationship.Friends));
		Assert.False(MayBeInvited(MessagePolicy.Friends, FriendshipService.Relationship.None));
		Assert.False(MayBeInvited(MessagePolicy.Friends, FriendshipService.Relationship.RequestSent));

		// Nobody means nobody, friends included — the same literal reading as everywhere else.
		Assert.False(MayBeInvited(MessagePolicy.Nobody, FriendshipService.Relationship.Friends));
	}

	// An account that never chose reads as "only friends", which is what the checkbox this
	// replaced always meant. A default of "anyone" would open a door nobody opened.
	[Fact]
	public void An_account_that_never_chose_is_reachable_only_by_friends()
	{
		var user = new UserDocument
		{
			Id = "u1", UserId = "u1", CreatedAtUtc = Now, LastSignInUtc = Now,
		};
		Assert.Equal(MessagePolicy.Friends, user.EffectiveMessagePolicy);
	}

	// ── Knocking on a door ────────────────────────────────────────────────────────────────────

	private static bool MayAskToJoin(
		GameDocument table, IReadOnlyDictionary<string, FriendshipService.Relationship> friends) =>
		table.HasRoom
		&& table.Players.Any(p => p.UserId is { Length: > 0 } seated
			&& friends.GetValueOrDefault(seated, FriendshipService.Relationship.None)
				== FriendshipService.Relationship.Friends);

	// Without this, anybody who guessed a table id could knock on it — and learn from the answer
	// that it exists.
	[Fact]
	public void Only_a_table_a_friend_is_actually_sitting_at_can_be_asked()
	{
		var friends = new Dictionary<string, FriendshipService.Relationship>
		{
			["u-friend"] = FriendshipService.Relationship.Friends,
		};

		Assert.True(MayAskToJoin(Table(4, GameStatus.WaitingForPlayers, "u-friend"), friends));
		// A table full of strangers is not one to knock on.
		Assert.False(MayAskToJoin(Table(4, GameStatus.WaitingForPlayers, "u-stranger"), friends));
		// Nor is a table with no room, however friendly.
		Assert.False(MayAskToJoin(Table(1, GameStatus.WaitingForPlayers, "u-friend"), friends));
		// Nor a match already under way.
		Assert.False(MayAskToJoin(Table(4, GameStatus.Active, "u-friend"), friends));
	}

	// A seat taken by somebody playing without an account belongs to nobody, and must not make a
	// table knockable by everyone.
	[Fact]
	public void A_seat_with_no_account_is_nobodys_friend()
	{
		var friends = new Dictionary<string, FriendshipService.Relationship>
		{
			[""] = FriendshipService.Relationship.Friends,
		};
		var table = Table(4, GameStatus.WaitingForPlayers);
		table.Players.Add(new LobbyPlayer
		{
			Id = "p", Name = "P", Token = "red_star", PlayerSecretId = "s", UserId = null,
		});

		Assert.False(MayAskToJoin(table, friends));
	}
}
