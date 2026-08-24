using CorroServer.Models;

namespace CorroServer.Services.Accounts;

/// <summary>
/// The two questions every social surface asks about one player on behalf of another: may I SEE
/// them, and may I REACH them?
///
/// They were open-coded in five places between the presence list, direct messages and invitations,
/// which is four chances for one of them to drift. A softened copy would not fail a test — it would
/// quietly publish somebody who chose not to be published, which is the kind of bug nobody reports
/// because the person it happens to never finds out.
///
/// Both are pure and take the relationship as an argument, so a caller reads the friendships ONCE
/// and answers a whole roomful of rows with it.
/// </summary>
public static class ReachRules
{
	/// <summary>
	/// Whether this player's presence setting lets that reader see they are connected.
	///
	/// Each option means exactly what it says: <see cref="PresenceVisibility.Nobody"/> hides them
	/// from their friends too. An option that quietly did not apply to some people would be worse
	/// than not offering it.
	/// </summary>
	public static bool IsVisibleTo(UserDocument user, FriendshipService.Relationship relationship)
		=> user.EffectiveVisibility switch
		{
			PresenceVisibility.Everyone => true,
			PresenceVisibility.Friends => relationship == FriendshipService.Relationship.Friends,
			_ => false,
		};

	/// <summary>
	/// Whether this player accepts being written to — or invited — by that sender.
	///
	/// One rule for both because an invitation IS an interruption: somebody who does not want
	/// strangers writing to them does not want strangers asking them to a table either. Being
	/// findable and being interruptible stay separate questions (see <see cref="IsVisibleTo"/>);
	/// this is only the second one.
	/// </summary>
	public static bool AcceptsFrom(UserDocument user, FriendshipService.Relationship relationship)
		=> user.EffectiveMessagePolicy switch
		{
			MessagePolicy.Anyone => true,
			MessagePolicy.Friends => relationship == FriendshipService.Relationship.Friends,
			_ => false,
		};
}
