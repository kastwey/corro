using CorroServer.Models;
using CorroServer.Services.Accounts;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Asking, answering and undoing.
///
/// Most of these are about the person being ASKED rather than the person asking, because that is
/// where a friend list can go wrong: a "no" that only means "not tonight" leaves somebody able to
/// ask every evening, and the only escape would be to stop being listed at all. So the refusal is
/// remembered, it is not reported back, and it cannot be reset by the person who was refused.
/// </summary>
public class FriendshipServiceTests
{
	private static readonly DateTime Now = new(2026, 8, 4, 12, 0, 0, DateTimeKind.Utc);

	private sealed class World
	{
		public InMemoryUserRepository Repository { get; } = new();
		public FriendshipService Friendships { get; }

		public World()
		{
			Friendships = new FriendshipService(Repository);
		}

		/// <summary>An account with a claimed handle, listed unless asked otherwise.</summary>
		public async Task<UserDocument> PlayerAsync(string userId, string handle, bool listed = true)
		{
			var normalized = PlayerHandle.Normalize(handle);
			await Repository.CreateOrGetHandleClaimAsync(new HandleClaimDocument
			{
				Id = normalized,
				Handle = normalized,
				UserId = userId,
				ClaimedAtUtc = Now,
			});
			return await Repository.UpsertUserAsync(new UserDocument
			{
				Id = userId,
				UserId = userId,
				Handle = handle,
				ListedPublicly = listed,
				CreatedAtUtc = Now,
				LastSignInUtc = Now,
			});
		}

		public Task<FriendshipDocument?> PairAsync(string a, string b) =>
			Repository.GetFriendshipAsync(FriendshipKey.For(a, b));
	}

	// ── The key ───────────────────────────────────────────────────────────────────────────────

	[Fact]
	public void A_pair_has_one_key_whichever_side_asks()
	{
		Assert.Equal(FriendshipKey.For("ana", "berto"), FriendshipKey.For("berto", "ana"));
		Assert.Equal(("ana", "berto"), FriendshipKey.Order("berto", "ana"));
		Assert.NotEqual(FriendshipKey.For("ana", "berto"), FriendshipKey.For("ana", "cora"));
	}

	[Fact]
	public void The_other_side_of_a_pair_is_null_for_somebody_who_is_not_in_it()
	{
		Assert.Equal("berto", FriendshipKey.Other("ana", "berto", "ana"));
		Assert.Equal("ana", FriendshipKey.Other("ana", "berto", "berto"));
		Assert.Null(FriendshipKey.Other("ana", "berto", "cora"));
	}

	// ── Asking ────────────────────────────────────────────────────────────────────────────────

	[Fact]
	public async Task Asking_stores_one_request_pointed_at_the_asker()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");

		var outcome = await world.Friendships.RequestAsync("u-ana", "berto", Now);

		Assert.Equal(FriendshipService.RequestOutcome.Sent, outcome);
		var pair = await world.PairAsync("u-ana", "u-berto");
		Assert.NotNull(pair);
		Assert.Equal(FriendshipState.Pending, pair!.State);
		Assert.Equal("u-ana", pair.RequestedBy);
	}

	[Fact]
	public async Task The_handle_is_matched_however_it_is_typed()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "Berto");

		Assert.Equal(
			FriendshipService.RequestOutcome.Sent,
			await world.Friendships.RequestAsync("u-ana", "  BERTO ", Now));
	}

	[Fact]
	public async Task Asking_twice_changes_nothing_and_still_reads_as_sent()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");

		await world.Friendships.RequestAsync("u-ana", "berto", Now);
		var again = await world.Friendships.RequestAsync("u-ana", "berto", Now.AddHours(1));

		Assert.Equal(FriendshipService.RequestOutcome.Sent, again);
		var pair = await world.PairAsync("u-ana", "u-berto");
		Assert.Equal(Now, pair!.RequestedAtUtc);
	}

	// Two people who ask each other in the same second must not each end up waiting for the other.
	[Fact]
	public async Task Asking_somebody_who_already_asked_you_is_agreeing_with_them()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");

		await world.Friendships.RequestAsync("u-berto", "ana", Now);
		var outcome = await world.Friendships.RequestAsync("u-ana", "berto", Now.AddSeconds(1));

		Assert.Equal(FriendshipService.RequestOutcome.AcceptedTheirs, outcome);
		Assert.Equal(FriendshipState.Accepted, (await world.PairAsync("u-ana", "u-berto"))!.State);
	}

	[Fact]
	public async Task Nobody_asks_themselves()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");

		Assert.Equal(
			FriendshipService.RequestOutcome.Self,
			await world.Friendships.RequestAsync("u-ana", "ana", Now));
	}

	// Being unfindable and not existing are ONE answer, or this endpoint becomes a way to test
	// which handles are taken.
	[Fact]
	public async Task An_unlisted_player_and_an_unknown_one_answer_identically()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-hidden", "hidden", listed: false);

		Assert.Equal(
			FriendshipService.RequestOutcome.NoSuchPlayer,
			await world.Friendships.RequestAsync("u-ana", "hidden", Now));
		Assert.Equal(
			FriendshipService.RequestOutcome.NoSuchPlayer,
			await world.Friendships.RequestAsync("u-ana", "nobody-at-all", Now));
		Assert.Null(await world.PairAsync("u-ana", "u-hidden"));
	}

	// ── Answering ─────────────────────────────────────────────────────────────────────────────

	[Fact]
	public async Task Accepting_makes_it_mutual()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");
		await world.Friendships.RequestAsync("u-ana", "berto", Now);

		var outcome = await world.Friendships.RespondAsync("u-berto", "ana", accept: true, Now);

		Assert.Equal(FriendshipService.RespondOutcome.Accepted, outcome);
		var pair = await world.PairAsync("u-ana", "u-berto");
		Assert.Equal(FriendshipState.Accepted, pair!.State);
		Assert.Equal(Now, pair.RespondedAtUtc);
		// Symmetric: neither side owns it.
		Assert.Equal(
			FriendshipService.Relationship.Friends,
			FriendshipService.RelationshipFor(pair, "u-ana"));
		Assert.Equal(
			FriendshipService.Relationship.Friends,
			FriendshipService.RelationshipFor(pair, "u-berto"));
	}

	[Fact]
	public async Task Nobody_answers_their_own_request()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");
		await world.Friendships.RequestAsync("u-ana", "berto", Now);

		Assert.Equal(
			FriendshipService.RespondOutcome.NoRequest,
			await world.Friendships.RespondAsync("u-ana", "berto", accept: true, Now));
		Assert.Equal(FriendshipState.Pending, (await world.PairAsync("u-ana", "u-berto"))!.State);
	}

	[Fact]
	public async Task Answering_a_request_that_was_never_made_is_refused()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");

		Assert.Equal(
			FriendshipService.RespondOutcome.NoRequest,
			await world.Friendships.RespondAsync("u-berto", "ana", accept: true, Now));
	}

	// ── What a refusal means ──────────────────────────────────────────────────────────────────

	[Fact]
	public async Task A_refusal_is_remembered_so_the_same_request_cannot_return()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");
		await world.Friendships.RequestAsync("u-ana", "berto", Now);
		await world.Friendships.RespondAsync("u-berto", "ana", accept: false, Now);

		// Ana asks again a week later. She is told it was sent…
		var again = await world.Friendships.RequestAsync("u-ana", "berto", Now.AddDays(7));
		Assert.Equal(FriendshipService.RequestOutcome.Sent, again);

		// …and nothing moved: Berto is not asked a second time.
		var pair = await world.PairAsync("u-ana", "u-berto");
		Assert.Equal(FriendshipState.Declined, pair!.State);
		Assert.Equal(FriendshipService.RespondOutcome.NoRequest,
			await world.Friendships.RespondAsync("u-berto", "ana", accept: true, Now.AddDays(7)));
	}

	[Fact]
	public async Task A_refusal_is_never_reported_to_the_person_refused()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");
		await world.Friendships.RequestAsync("u-ana", "berto", Now);
		await world.Friendships.RespondAsync("u-berto", "ana", accept: false, Now);

		var pair = await world.PairAsync("u-ana", "u-berto");

		// Ana still sees what she did — that she asked. What became of it is Berto's business.
		Assert.Equal(
			FriendshipService.Relationship.RequestSent,
			FriendshipService.RelationshipFor(pair!, "u-ana"));
		// And Berto is not carrying it around: for him there is nothing there.
		Assert.Equal(
			FriendshipService.Relationship.None,
			FriendshipService.RelationshipFor(pair!, "u-berto"));

		Assert.Contains(await world.Friendships.ListAsync("u-ana"),
			view => view.Handle == "berto"
				&& view.Relationship == FriendshipService.Relationship.RequestSent);
		Assert.Empty(await world.Friendships.ListAsync("u-berto"));
	}

	// The loophole this closes: cancel-then-ask-again would reset a refusal and make it meaningless.
	// Which is why nothing can cancel a request at all — a cancel that worked on a pending request
	// and failed on a refused one would announce the refusal by failing.
	[Fact]
	public async Task Nothing_can_take_a_request_back_whether_it_was_answered_or_not()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");
		await world.PlayerAsync("u-cora", "cora");

		await world.Friendships.RequestAsync("u-ana", "berto", Now);
		await world.Friendships.RespondAsync("u-berto", "ana", accept: false, Now);
		await world.Friendships.RequestAsync("u-ana", "cora", Now);

		// Refused and still unanswered give the SAME answer, which is the whole point: the asker
		// cannot tell the two apart by what the button does.
		Assert.False(await world.Friendships.RemoveFriendAsync("u-ana", "berto"));
		Assert.False(await world.Friendships.RemoveFriendAsync("u-ana", "cora"));
		Assert.Equal(FriendshipState.Declined, (await world.PairAsync("u-ana", "u-berto"))!.State);
		Assert.Equal(FriendshipState.Pending, (await world.PairAsync("u-ana", "u-cora"))!.State);
	}

	// A refusal binds the refuser to nothing: changing your mind later is the ordinary way back.
	[Fact]
	public async Task The_person_who_refused_may_still_ask_the_other_later()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");
		await world.Friendships.RequestAsync("u-ana", "berto", Now);
		await world.Friendships.RespondAsync("u-berto", "ana", accept: false, Now);

		var outcome = await world.Friendships.RequestAsync("u-berto", "ana", Now.AddDays(30));

		Assert.Equal(FriendshipService.RequestOutcome.Sent, outcome);
		var pair = await world.PairAsync("u-ana", "u-berto");
		Assert.Equal(FriendshipState.Pending, pair!.State);
		Assert.Equal("u-berto", pair.RequestedBy);
		Assert.Null(pair.RespondedAtUtc);
		// And now Ana is the one with something to answer.
		Assert.Equal(FriendshipService.RespondOutcome.Accepted,
			await world.Friendships.RespondAsync("u-ana", "berto", accept: true, Now.AddDays(30)));
	}

	// ── Undoing ───────────────────────────────────────────────────────────────────────────────

	[Fact]
	public async Task Either_friend_can_end_a_friendship_and_both_are_free_afterwards()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");
		await world.Friendships.RequestAsync("u-ana", "berto", Now);
		await world.Friendships.RespondAsync("u-berto", "ana", accept: true, Now);

		Assert.True(await world.Friendships.RemoveFriendAsync("u-berto", "ana"));
		Assert.Null(await world.PairAsync("u-ana", "u-berto"));
		Assert.Empty(await world.Friendships.ListAsync("u-ana"));
	}

	// ── Listing ───────────────────────────────────────────────────────────────────────────────

	[Fact]
	public async Task The_list_names_friends_and_both_directions_of_request_in_one_order()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");
		await world.PlayerAsync("u-cora", "cora");
		await world.PlayerAsync("u-dani", "dani");

		await world.Friendships.RequestAsync("u-ana", "cora", Now);            // Ana asked Cora
		await world.Friendships.RespondAsync("u-cora", "ana", accept: true, Now);
		await world.Friendships.RequestAsync("u-ana", "dani", Now);            // waiting on Dani
		await world.Friendships.RequestAsync("u-berto", "ana", Now);           // Berto asked Ana

		var list = await world.Friendships.ListAsync("u-ana");

		Assert.Equal(new[] { "berto", "cora", "dani" }, list.Select(v => v.Handle));
		Assert.Equal(new[]
		{
			FriendshipService.Relationship.RequestReceived,
			FriendshipService.Relationship.Friends,
			FriendshipService.Relationship.RequestSent,
		}, list.Select(v => v.Relationship));
	}

	// The online list asks this question once for a screen full of people.
	[Fact]
	public async Task Relationships_come_back_keyed_by_account_for_a_whole_list_at_once()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");
		await world.PlayerAsync("u-cora", "cora");
		await world.Friendships.RequestAsync("u-ana", "berto", Now);

		var relationships = await world.Friendships.RelationshipsForAsync("u-ana");

		Assert.Equal(FriendshipService.Relationship.RequestSent, relationships["u-berto"]);
		// Somebody they have never had anything to do with is simply absent.
		Assert.False(relationships.ContainsKey("u-cora"));
	}

	[Fact]
	public async Task Somebody_who_gave_up_their_handle_drops_out_of_the_list_rather_than_appearing_nameless()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		var berto = await world.PlayerAsync("u-berto", "berto");
		await world.Friendships.RequestAsync("u-ana", "berto", Now);
		await world.Friendships.RespondAsync("u-berto", "ana", accept: true, Now);

		await world.Repository.UpsertUserAsync(berto with { Handle = null });

		Assert.Empty(await world.Friendships.ListAsync("u-ana"));
	}

	// ── Erasure ───────────────────────────────────────────────────────────────────────────────

	// Half a friendship left behind would keep naming somebody who asked to be gone, on a list they
	// can no longer reach.
	[Fact]
	public async Task Erasing_an_account_takes_its_friendships_with_it()
	{
		var world = new World();
		await world.PlayerAsync("u-ana", "ana");
		await world.PlayerAsync("u-berto", "berto");
		await world.PlayerAsync("u-cora", "cora");
		await world.Friendships.RequestAsync("u-ana", "berto", Now);
		await world.Friendships.RespondAsync("u-berto", "ana", accept: true, Now);
		await world.Friendships.RequestAsync("u-cora", "ana", Now);

		var accounts = new UserAccountService(
			world.Repository,
			Microsoft.Extensions.Logging.Abstractions.NullLogger<UserAccountService>.Instance);
		await accounts.DeleteAccountAsync("u-ana");

		Assert.Null(await world.PairAsync("u-ana", "u-berto"));
		Assert.Null(await world.PairAsync("u-ana", "u-cora"));
		Assert.Empty(await world.Friendships.ListAsync("u-berto"));
		Assert.Empty(await world.Friendships.ListAsync("u-cora"));
	}
}
