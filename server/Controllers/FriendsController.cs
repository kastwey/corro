using CorroServer.Services.Accounts;
using Microsoft.AspNetCore.Mvc;

namespace CorroServer.Controllers;

/// <summary>
/// Asking to be friends, answering, and undoing either.
///
/// Everything here needs a session, and every route names the other player by HANDLE — the only
/// name the asker can see. Account ids never appear on the wire.
///
/// Not one of these is a GET, including the ones that only undo something. The session cookie is
/// <c>SameSite=Lax</c>, which means a plain link from anywhere on the web arrives with it attached:
/// a GET that changed a relationship could be fired by an image tag in a forum post. The reads are
/// GETs; everything that writes is a POST or a DELETE, which that rule does not carry.
///
/// The refusal policy lives in <see cref="FriendshipService"/> — read its summary before changing
/// what any of these report, because two of the outcomes are deliberately vague and it explains who
/// that protects.
/// </summary>
[ApiController]
[Route("api/friends")]
public class FriendsController : ControllerBase
{
	private readonly FriendshipService _friendships;

	public FriendsController(FriendshipService friendships)
	{
		_friendships = friendships;
	}

	/// <summary>One entry in the player's own list.</summary>
	public sealed record FriendEntry(string Handle, string Relationship);

	/// <summary>The other player, named the way the asker sees them.</summary>
	public sealed record HandleRequest(string Handle);

	/// <summary>
	/// This player's friends and unanswered requests, in one list with each entry saying which it
	/// is. One list rather than three arrays because the client renders one roster: sorting people
	/// into buckets is a decision about layout, and this is not the place for it.
	/// </summary>
	[HttpGet]
	public async Task<ActionResult<object>> GetFriends(CancellationToken ct)
	{
		if (SessionPrincipal.UserId(User) is not { Length: > 0 } userId) return Unauthorized();

		var entries = await _friendships.ListAsync(userId, ct);
		return new
		{
			Friends = entries
				.Select(entry => new FriendEntry(entry.Handle, entry.Relationship.ToString()))
				.ToList(),
		};
	}

	/// <summary>
	/// Asks somebody to be friends. Answers the same way whether the handle is unknown or belongs to
	/// somebody who chose not to be listed: telling them apart would make this a way to test which
	/// handles exist.
	/// </summary>
	[HttpPost("requests")]
	public async Task<IActionResult> Request([FromBody] HandleRequest request, CancellationToken ct)
	{
		if (SessionPrincipal.UserId(User) is not { Length: > 0 } userId) return Unauthorized();

		var outcome = await _friendships.RequestAsync(
			userId, request?.Handle ?? string.Empty, DateTime.UtcNow, ct);

		return outcome switch
		{
			FriendshipService.RequestOutcome.NoSuchPlayer
				=> NotFound(new { code = "NO_SUCH_PLAYER" }),
			FriendshipService.RequestOutcome.Self
				=> BadRequest(new { code = "SELF" }),
			// Sent, AcceptedTheirs and Unchanged all leave the asker in a state their own list can
			// describe, so the client re-reads rather than being told a story here.
			_ => Ok(new { outcome = outcome.ToString() }),
		};
	}

	/// <summary>Says yes to a request addressed to this player.</summary>
	[HttpPost("requests/accept")]
	public Task<IActionResult> Accept([FromBody] HandleRequest request, CancellationToken ct) =>
		Respond(request, accept: true, ct);

	/// <summary>
	/// Says no. The other player is not told — see <see cref="FriendshipService"/> — and the refusal
	/// is remembered, so the same request cannot arrive again tomorrow.
	/// </summary>
	[HttpPost("requests/decline")]
	public Task<IActionResult> Decline([FromBody] HandleRequest request, CancellationToken ct) =>
		Respond(request, accept: false, ct);

	/// <summary>
	/// Ends a friendship, from either side. Friendships only — a request that has been sent cannot
	/// be taken back, for the reason spelled out on <see cref="FriendshipService.RemoveFriendAsync"/>.
	/// </summary>
	[HttpDelete("{handle}")]
	public async Task<IActionResult> RemoveFriend(string handle, CancellationToken ct)
	{
		if (SessionPrincipal.UserId(User) is not { Length: > 0 } userId) return Unauthorized();

		return await _friendships.RemoveFriendAsync(userId, handle, ct)
			? NoContent()
			: NotFound(new { code = "NO_SUCH_FRIENDSHIP" });
	}

	private async Task<IActionResult> Respond(
		HandleRequest? request, bool accept, CancellationToken ct)
	{
		if (SessionPrincipal.UserId(User) is not { Length: > 0 } userId) return Unauthorized();

		var outcome = await _friendships.RespondAsync(
			userId, request?.Handle ?? string.Empty, accept, DateTime.UtcNow, ct);

		return outcome == FriendshipService.RespondOutcome.NoRequest
			? NotFound(new { code = "NO_REQUEST" })
			: NoContent();
	}
}
