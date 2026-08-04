namespace CorroServer.Services.Accounts;

/// <summary>
/// The identity of a PAIR of accounts, independent of who is asking.
///
/// A friendship is one fact about two people, so it is stored once. That only works if both sides
/// compute the same key, which is what ordering the two ids buys: whoever reads it — the person who
/// asked, the person who was asked — arrives at the same document.
///
/// Ordinal comparison, deliberately: account ids are opaque generated strings, and a
/// culture-sensitive comparison could order the same pair differently on two machines and split one
/// friendship into two documents that disagree.
/// </summary>
public static class FriendshipKey
{
	private const char Separator = '|';

	/// <summary>The two ids in their fixed order, lower first.</summary>
	public static (string Low, string High) Order(string first, string second) =>
		string.CompareOrdinal(first, second) <= 0 ? (first, second) : (second, first);

	/// <summary>The pair's document id, the same string from either side.</summary>
	public static string For(string first, string second)
	{
		var (low, high) = Order(first, second);
		return $"{low}{Separator}{high}";
	}

	/// <summary>
	/// The OTHER member of a pair, seen from one side. Null when the id given is not part of it —
	/// the caller is then reading somebody else's relationship and must be refused rather than
	/// guessed at.
	/// </summary>
	public static string? Other(string userA, string userB, string forUserId)
	{
		if (forUserId == userA) return userB;
		if (forUserId == userB) return userA;
		return null;
	}
}
