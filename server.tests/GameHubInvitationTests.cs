using CorroServer.Hubs;
using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Accounts;
using CorroServer.Services.Corro;
using CorroServer.Services.Sounds;
using CorroServer.Tests.Doubles;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The hub methods that get somebody to a table.
///
/// <see cref="TableInvitationTests"/> pins the rules against pure functions; these run the methods
/// that APPLY them, because the interesting failures live in the wiring: a table loaded and not
/// checked, a write that lands twice, an answer that reports success while storing nothing.
///
/// Everything here is about what a caller is allowed to do and what the answer may say. The one
/// rule worth restating: a refusal reports one thing whatever the reason, because telling them
/// apart would turn these methods into a way to learn who exists and who is around.
/// </summary>
public class GameHubInvitationTests
{
	private static readonly DateTime Now = new(2026, 8, 5, 12, 0, 0, DateTimeKind.Utc);

	// ── A world of two accounts and one table ─────────────────────────────────────────────────

	private sealed class World
	{
		public InMemoryUserRepository Users { get; } = new();
		public InMemoryGameRepository Games { get; } = new();
		public PresenceRegistry Presence { get; } = new();
		public FriendshipService Friendships { get; }

		public World()
		{
			Friendships = new FriendshipService(Users);
		}

		/// <summary>An account with a public name, open to being asked by anybody unless told
		/// otherwise.</summary>
		public async Task<UserDocument> PlayerAsync(
			string userId, string handle, MessagePolicy policy = MessagePolicy.Anyone,
			PresenceVisibility visibility = PresenceVisibility.Everyone,
			bool online = false)
		{
			if (online) { Presence.Add(userId, "c-" + userId); }
			var normalized = PlayerHandle.Normalize(handle);
			await Users.CreateOrGetHandleClaimAsync(new HandleClaimDocument
			{
				Id = normalized, Handle = normalized, UserId = userId, ClaimedAtUtc = Now,
			});
			return await Users.UpsertUserAsync(new UserDocument
			{
				Id = userId, UserId = userId, Handle = handle, MessagePolicy = policy,
				// Findable by strangers by default, so these fixtures can befriend each other the
				// ordinary way. A real new account is friends-only, which is right for people and
				// unhelpful for a world of two.
				Visibility = visibility,
				CreatedAtUtc = Now, LastSignInUtc = Now,
			});
		}

		public async Task<GameDocument> TableAsync(
			string gameId, int maxPlayers = 4, GameStatus status = GameStatus.WaitingForPlayers,
			params string[] seatedUserIds)
		{
			var game = new GameDocument
			{
				Id = $"game-{gameId}",
				GameId = gameId,
				HostId = "p0",
				InviteCode = $"CODE{gameId}",
				Status = status,
				MaxPlayers = maxPlayers,
				Players = seatedUserIds.Select((userId, i) => new LobbyPlayer
				{
					Id = $"p{i}", Name = $"P{i}", Token = "red_star",
					PlayerSecretId = $"s{i}", UserId = userId,
				}).ToList(),
			};
			await Games.CreateGameAsync(game);
			return game;
		}

		public Task<GameDocument?> ReadAsync(string gameId) => Games.LoadGameAsync(gameId);

		/// <summary>A hub whose caller is this account, with everything the invitation paths use.</summary>
		public GameHub HubFor(string? signedInUserId)
		{
			var packageStore = new CorroPackageStore(
				new CompositeSoundPackProvider(new DefaultSoundPackProvider()));
			var restorer = TestFixtures.NewPackageRestorer();
			var registry = new GameSessionRegistry(
				new FakeHubContext(), Games, new FakeAuctionTimer(), restorer);
			var hub = new GameHub(
				Games,
				new FakeGameServiceFactory(),
				new FakeAuctionTimer(),
				packageStore,
				restorer,
				registry,
				NullLogger<GameHub>.Instance,
				presence: Presence,
				users: Users,
				friendships: Friendships)
			{
				Clients = new FakeClients(),
				Groups = new FakeGroupManager(),
			};
			hub.Context = new FakeCallerContext(
				"c-" + Guid.NewGuid().ToString("N"),
				signedInUserId is null ? null : SessionPrincipal.For(signedInUserId));
			return hub;
		}
	}

	// ── Inviting ──────────────────────────────────────────────────────────────────────────────

	[Fact]
	public async Task Inviting_stores_the_invitation_on_the_table()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-guest", "guestname");
		await world.TableAsync("t1", seatedUserIds: "u-host");

		var result = await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "guestname" });

		Assert.Equal("INVITED", result.Outcome);
		var stored = (await world.ReadAsync("t1"))!.Invitations.Single();
		Assert.Equal("u-guest", stored.UserId);
		Assert.Equal("hostname", stored.InvitedBy);
	}

	// An invitation to a table you are not at is somebody else's invitation to make.
	[Fact]
	public async Task Only_somebody_seated_may_invite()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-stranger", "strangername");
		await world.PlayerAsync("u-guest", "guestname");
		await world.TableAsync("t1", seatedUserIds: "u-host");

		var result = await world.HubFor("u-stranger").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "guestname" });

		Assert.Equal("REFUSED", result.Outcome);
		Assert.Empty((await world.ReadAsync("t1"))!.Invitations);
	}

	// Somebody who accepts messages only from friends is not reachable by a stranger's invitation
	// either: an invitation IS an interruption.
	[Fact]
	public async Task An_invitation_obeys_the_message_policy()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-quiet", "quietname", MessagePolicy.Friends);
		await world.TableAsync("t1", seatedUserIds: "u-host");

		var refused = await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "quietname" });
		Assert.Equal("REFUSED", refused.Outcome);

		// Once they ARE friends, the same invitation goes through.
		await world.Friendships.RequestAsync("u-host", "quietname", Now);
		await world.Friendships.RespondAsync("u-quiet", "hostname", accept: true, Now);

		var allowed = await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "quietname" });
		Assert.Equal("INVITED", allowed.Outcome);
	}

	// One sentence for both, because telling them apart makes this a way to test which names exist.
	[Fact]
	public async Task An_unknown_name_and_one_that_refuses_you_answer_identically()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-closed", "closedname", MessagePolicy.Nobody);
		await world.TableAsync("t1", seatedUserIds: "u-host");
		var hub = world.HubFor("u-host");

		var closed = await hub.InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "closedname" });
		var unknown = await hub.InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "nobodyatall" });

		Assert.Equal(closed.Outcome, unknown.Outcome);
		Assert.Equal("REFUSED", closed.Outcome);
	}

	[Fact]
	public async Task Inviting_twice_stores_one_invitation()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-guest", "guestname");
		await world.TableAsync("t1", seatedUserIds: "u-host");
		var hub = world.HubFor("u-host");
		var request = new GameHub.TableInviteRequest { GameId = "t1", Handle = "guestname" };

		await hub.InviteToTable(request);
		var again = await hub.InviteToTable(request);

		Assert.Equal("INVITED", again.Outcome);
		Assert.Single((await world.ReadAsync("t1"))!.Invitations);
	}

	[Fact]
	public async Task A_table_with_no_room_cannot_ask_anybody()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-guest", "guestname");
		await world.TableAsync("t1", maxPlayers: 1, seatedUserIds: "u-host");

		var result = await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "guestname" });

		Assert.Equal("TABLE_FULL", result.Outcome);
	}

	[Fact]
	public async Task Somebody_already_seated_is_not_invited_again()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-guest", "guestname");
		await world.TableAsync("t1", 4, GameStatus.WaitingForPlayers, "u-host", "u-guest");

		var result = await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "guestname" });

		Assert.Equal("ALREADY_HERE", result.Outcome);
	}

	[Fact]
	public async Task An_anonymous_caller_invites_nobody()
	{
		var world = new World();
		await world.PlayerAsync("u-guest", "guestname");
		await world.TableAsync("t1", seatedUserIds: "u-host");

		var result = await world.HubFor(null).InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "guestname" });

		Assert.Equal("REFUSED", result.Outcome);
	}

	// ── Knocking on a door ────────────────────────────────────────────────────────────────────

	[Fact]
	public async Task Asking_to_join_needs_a_friend_actually_seated_there()
	{
		var world = new World();
		await world.PlayerAsync("u-asker", "askername");
		await world.PlayerAsync("u-stranger", "strangername");
		await world.TableAsync("t1", seatedUserIds: "u-stranger");

		// A table full of strangers cannot be knocked on — otherwise a guessed id would tell you
		// whether it exists.
		var refused = await world.HubFor("u-asker").RequestToJoinTable(
			new GameHub.TableAnswerRequest { GameId = "t1" });
		Assert.Equal("REFUSED", refused.Outcome);
		Assert.Empty((await world.ReadAsync("t1"))!.JoinRequests);

		await world.Friendships.RequestAsync("u-asker", "strangername", Now);
		await world.Friendships.RespondAsync("u-stranger", "askername", accept: true, Now);

		var asked = await world.HubFor("u-asker").RequestToJoinTable(
			new GameHub.TableAnswerRequest { GameId = "t1" });
		Assert.Equal("ASKED", asked.Outcome);
		Assert.Equal("u-asker", (await world.ReadAsync("t1"))!.JoinRequests.Single().UserId);
	}

	// Accepting admits directly rather than turning into an invitation to confirm: they said what
	// they wanted when they asked.
	[Fact]
	public async Task Letting_somebody_in_clears_the_request_and_opens_the_door()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-asker", "askername");
		await world.TableAsync("t1", seatedUserIds: "u-host");
		await world.Friendships.RequestAsync("u-asker", "hostname", Now);
		await world.Friendships.RespondAsync("u-host", "askername", accept: true, Now);
		await world.HubFor("u-asker").RequestToJoinTable(
			new GameHub.TableAnswerRequest { GameId = "t1" });

		var result = await world.HubFor("u-host").AnswerJoinRequest(
			new GameHub.TableAnswerRequest { GameId = "t1", Handle = "askername" }, accept: true);

		Assert.Equal("ADMITTED", result.Outcome);
		var table = (await world.ReadAsync("t1"))!;
		Assert.Empty(table.JoinRequests);
		Assert.Equal("u-asker", table.Invitations.Single().UserId);
	}

	[Fact]
	public async Task Refusing_somebody_clears_the_request_and_opens_nothing()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-asker", "askername");
		await world.TableAsync("t1", seatedUserIds: "u-host");
		await world.Friendships.RequestAsync("u-asker", "hostname", Now);
		await world.Friendships.RespondAsync("u-host", "askername", accept: true, Now);
		await world.HubFor("u-asker").RequestToJoinTable(
			new GameHub.TableAnswerRequest { GameId = "t1" });

		var result = await world.HubFor("u-host").AnswerJoinRequest(
			new GameHub.TableAnswerRequest { GameId = "t1", Handle = "askername" }, accept: false);

		Assert.Equal("DECLINED", result.Outcome);
		var table = (await world.ReadAsync("t1"))!;
		Assert.Empty(table.JoinRequests);
		Assert.Empty(table.Invitations);
	}

	[Fact]
	public async Task Only_somebody_seated_answers_a_request()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-asker", "askername");
		await world.PlayerAsync("u-stranger", "strangername");
		await world.TableAsync("t1", seatedUserIds: "u-host");
		await world.Friendships.RequestAsync("u-asker", "hostname", Now);
		await world.Friendships.RespondAsync("u-host", "askername", accept: true, Now);
		await world.HubFor("u-asker").RequestToJoinTable(
			new GameHub.TableAnswerRequest { GameId = "t1" });

		var result = await world.HubFor("u-stranger").AnswerJoinRequest(
			new GameHub.TableAnswerRequest { GameId = "t1", Handle = "askername" }, accept: true);

		Assert.Equal("REFUSED", result.Outcome);
		Assert.Single((await world.ReadAsync("t1"))!.JoinRequests);
	}

	// ── Answering an invitation ───────────────────────────────────────────────────────────────

	// The code is what lets the client walk the ordinary join, so it is sent ONLY to somebody who
	// has actually been let in.
	[Fact]
	public async Task Accepting_clears_the_invitation_and_hands_back_the_way_in()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-guest", "guestname");
		await world.TableAsync("t1", seatedUserIds: "u-host");
		await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "guestname" });

		var result = await world.HubFor("u-guest").AcceptTableInvitation(
			new GameHub.TableAnswerRequest { GameId = "t1" });

		Assert.Equal("JOINING", result.Outcome);
		Assert.Equal("CODEt1", result.InviteCode);
		Assert.Empty((await world.ReadAsync("t1"))!.Invitations);
	}

	[Fact]
	public async Task Declining_erases_it_and_hands_back_nothing()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-guest", "guestname");
		await world.TableAsync("t1", seatedUserIds: "u-host");
		await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "guestname" });

		var result = await world.HubFor("u-guest").DeclineTableInvitation(
			new GameHub.TableAnswerRequest { GameId = "t1" });

		Assert.Equal("DECLINED", result.Outcome);
		Assert.Null(result.InviteCode);
		Assert.Empty((await world.ReadAsync("t1"))!.Invitations);
	}

	// Somebody else's invitation is not an answer this caller can give — and the code must not fall
	// out of a refusal, or an invitation to anybody would be a way into any table.
	[Fact]
	public async Task An_invitation_addressed_to_somebody_else_is_not_yours_to_take()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-guest", "guestname");
		await world.PlayerAsync("u-other", "othername");
		await world.TableAsync("t1", seatedUserIds: "u-host");
		await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "guestname" });

		var result = await world.HubFor("u-other").AcceptTableInvitation(
			new GameHub.TableAnswerRequest { GameId = "t1" });

		Assert.Equal("GONE", result.Outcome);
		Assert.Null(result.InviteCode);
		// And the real invitation is untouched.
		Assert.Single((await world.ReadAsync("t1"))!.Invitations);
	}

	// A table filling up between the invitation and the answer is the ordinary case, not an error.
	[Fact]
	public async Task A_table_that_filled_up_says_so_and_stops_offering_itself()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-guest", "guestname");
		await world.TableAsync("t1", maxPlayers: 2, seatedUserIds: "u-host");
		await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "guestname" });

		// Somebody else takes the last seat first.
		var table = (await world.ReadAsync("t1"))!;
		table.Players.Add(new LobbyPlayer
		{
			Id = "px", Name = "Px", Token = "blue_disc", PlayerSecretId = "sx", UserId = "u-late",
		});
		await world.Games.UpdateGameAsync(table);

		var result = await world.HubFor("u-guest").AcceptTableInvitation(
			new GameHub.TableAnswerRequest { GameId = "t1" });

		Assert.Equal("TABLE_FULL", result.Outcome);
		Assert.Null(result.InviteCode);
		// Cleared, so it stops offering something that is no longer there.
		Assert.Empty((await world.ReadAsync("t1"))!.Invitations);
	}

	// ── What is waiting for me ────────────────────────────────────────────────────────────────

	[Fact]
	public async Task The_waiting_list_holds_invitations_and_doors_knocked_on()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-me", "myname");
		await world.TableAsync("t1", seatedUserIds: "u-host");
		await world.TableAsync("t2", seatedUserIds: "u-host");
		await world.Friendships.RequestAsync("u-me", "hostname", Now);
		await world.Friendships.RespondAsync("u-host", "myname", accept: true, Now);

		await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "myname" });
		await world.HubFor("u-me").RequestToJoinTable(
			new GameHub.TableAnswerRequest { GameId = "t2" });

		var waiting = await world.HubFor("u-me").GetMyTableInvitations();

		Assert.Equal(2, waiting.Count);
		var invited = waiting.Single(w => w.GameId == "t1");
		Assert.Equal("hostname", invited.InvitedBy);
		Assert.False(invited.Asked);
		// The door this player knocked on reads as theirs, with nothing to answer.
		Assert.True(waiting.Single(w => w.GameId == "t2").Asked);
	}

	// A table that filled or started is not an answer anybody can act on.
	[Fact]
	public async Task A_table_with_no_room_left_drops_out_of_what_is_waiting()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname");
		await world.PlayerAsync("u-me", "myname");
		await world.TableAsync("t1", maxPlayers: 2, seatedUserIds: "u-host");
		await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "myname" });

		var table = (await world.ReadAsync("t1"))!;
		await world.Games.UpdateGameAsync(table with { Status = GameStatus.Active });

		Assert.Empty(await world.HubFor("u-me").GetMyTableInvitations());
	}

	[Fact]
	public async Task An_anonymous_caller_is_waited_on_by_nothing()
	{
		var world = new World();
		Assert.Empty(await world.HubFor(null).GetMyTableInvitations());
	}

	// ── Who can be asked ──────────────────────────────────────────────────────────────────────
	//
	// The picker's candidates. Two rules decide, in this order: can this caller SEE them, and do
	// they accept being asked. Both are the same rules the refusal applies, from ReachRules, so a
	// name offered here cannot be one the invitation would then turn down.

	[Fact]
	public async Task The_connected_and_willing_are_offered()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname", online: true);
		await world.PlayerAsync("u-a", "aaa", online: true);
		await world.PlayerAsync("u-b", "bbb", online: true);
		await world.TableAsync("t1", seatedUserIds: "u-host");

		var offered = await world.HubFor("u-host").GetInvitablePlayers("t1");

		// Sorted, and never the caller themselves.
		Assert.Equal(new[] { "aaa", "bbb" }, offered);
	}

	[Fact]
	public async Task Somebody_who_is_not_connected_is_not_offered()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname", online: true);
		await world.PlayerAsync("u-away", "awayname");
		await world.TableAsync("t1", seatedUserIds: "u-host");

		Assert.Empty(await world.HubFor("u-host").GetInvitablePlayers("t1"));
	}

	// Seeing comes FIRST and on its own. Somebody hidden from this caller is not offered whatever
	// their message policy says, or the picker would become a way around the presence setting.
	[Fact]
	public async Task Somebody_hidden_from_the_caller_is_not_offered_however_open_they_are()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname", online: true);
		await world.PlayerAsync(
			"u-hidden", "hiddenname",
			policy: MessagePolicy.Anyone, visibility: PresenceVisibility.Nobody, online: true);
		await world.TableAsync("t1", seatedUserIds: "u-host");

		Assert.Empty(await world.HubFor("u-host").GetInvitablePlayers("t1"));
	}

	[Fact]
	public async Task Somebody_who_takes_nothing_from_strangers_is_not_offered_to_one()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname", online: true);
		await world.PlayerAsync("u-picky", "pickyname", policy: MessagePolicy.Friends, online: true);
		await world.PlayerAsync("u-closed", "closedname", policy: MessagePolicy.Nobody, online: true);
		await world.TableAsync("t1", seatedUserIds: "u-host");

		Assert.Empty(await world.HubFor("u-host").GetInvitablePlayers("t1"));
	}

	// …and IS offered to a friend, which is what "only friends" means.
	[Fact]
	public async Task A_friend_only_player_is_offered_to_their_friend()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname", online: true);
		await world.PlayerAsync("u-picky", "pickyname", policy: MessagePolicy.Friends, online: true);
		await world.Friendships.RequestAsync("u-host", "pickyname", Now);
		await world.Friendships.RespondAsync("u-picky", "hostname", accept: true, Now);
		await world.TableAsync("t1", seatedUserIds: "u-host");

		Assert.Equal(new[] { "pickyname" }, await world.HubFor("u-host").GetInvitablePlayers("t1"));
	}

	[Fact]
	public async Task Anybody_already_here_or_already_asked_is_not_offered_again()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname", online: true);
		await world.PlayerAsync("u-seated", "seatedname", online: true);
		await world.PlayerAsync("u-asked", "askedname", online: true);
		await world.TableAsync("t1", 4, GameStatus.WaitingForPlayers, "u-host", "u-seated");
		await world.HubFor("u-host").InviteToTable(
			new GameHub.TableInviteRequest { GameId = "t1", Handle = "askedname" });

		Assert.Empty(await world.HubFor("u-host").GetInvitablePlayers("t1"));
	}

	// The same seat check InviteToTable makes. Without it this answers "who is around and reachable
	// by me" for any table id somebody cared to guess.
	[Fact]
	public async Task Somebody_not_seated_here_is_told_nothing()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname", online: true);
		await world.PlayerAsync("u-stranger", "strangername", online: true);
		await world.PlayerAsync("u-a", "aaa", online: true);
		await world.TableAsync("t1", seatedUserIds: "u-host");

		Assert.Empty(await world.HubFor("u-stranger").GetInvitablePlayers("t1"));
		Assert.Empty(await world.HubFor(null).GetInvitablePlayers("t1"));
		Assert.Empty(await world.HubFor("u-host").GetInvitablePlayers("no-such-table"));
	}

	// Nobody can be invited to a table with no seat left, so nobody is offered.
	[Fact]
	public async Task A_full_table_offers_nobody()
	{
		var world = new World();
		await world.PlayerAsync("u-host", "hostname", online: true);
		await world.PlayerAsync("u-a", "aaa", online: true);
		await world.TableAsync("t1", maxPlayers: 1, seatedUserIds: "u-host");

		Assert.Empty(await world.HubFor("u-host").GetInvitablePlayers("t1"));
	}

	// Whoever has no public name cannot invite at all (NEEDS_PUBLIC_NAME), so there is nobody to
	// offer them — and nobody without one can be offered, since there would be nothing to type.
	[Fact]
	public async Task A_caller_with_no_public_name_is_offered_nobody()
	{
		var world = new World();
		await world.Users.UpsertUserAsync(new UserDocument
		{
			Id = "u-nameless", UserId = "u-nameless", CreatedAtUtc = Now, LastSignInUtc = Now,
			Visibility = PresenceVisibility.Everyone,
		});
		world.Presence.Add("u-nameless", "c-nameless");
		await world.PlayerAsync("u-a", "aaa", online: true);
		await world.TableAsync("t1", seatedUserIds: "u-nameless");

		Assert.Empty(await world.HubFor("u-nameless").GetInvitablePlayers("t1"));
	}
}