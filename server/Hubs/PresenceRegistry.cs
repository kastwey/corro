namespace CorroServer.Hubs;

using System.Collections.Concurrent;

/// <summary>
/// Who is here right now, by ACCOUNT.
///
/// Deliberately a different question from the one <see cref="GameSessionRegistry"/> already
/// answers. That one knows about seats: which connection is which player of which game. This one
/// knows about people — somebody signed in and reading the lobby is present, and has no seat
/// anywhere. Conflating them would mean a player is only "here" once they sit down, which is the
/// opposite of what a list of who is around is for.
///
/// Keyed by account and holding a SET of connections, because one person with three tabs open is
/// one person. They go when the last of those connections does.
///
/// In memory, per process. That is honest rather than ideal: a deployment scaled to two instances
/// would show each half of the room to the other half's half. Worth knowing before that day, and
/// not worth a backplane before it.
/// </summary>
public sealed class PresenceRegistry
{
	private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> _byUser = new();

	/// <summary>What somebody is doing, coarsely. It exists so people know whether they are about
	/// to interrupt something — never to say WHICH game, which would turn a friendly list into a
	/// way to find and follow a stranger's table.</summary>
	public enum Activity
	{
		/// <summary>Signed in, not at a table.</summary>
		InLobby,
		/// <summary>At a table whose match has not started.</summary>
		AtTable,
		/// <summary>In a running match.</summary>
		Playing,
	}

	public void Add(string userId, string connectionId) =>
		_byUser.GetOrAdd(userId, _ => new ConcurrentDictionary<string, byte>())[connectionId] = 0;

	/// <summary>Drop one connection. The person only leaves with their last one.</summary>
	public void Remove(string userId, string connectionId)
	{
		if (!_byUser.TryGetValue(userId, out var connections))
		{
			return;
		}

		connections.TryRemove(connectionId, out _);
		if (connections.IsEmpty)
		{
			_byUser.TryRemove(userId, out _);
		}
	}

	public bool IsOnline(string userId) => _byUser.ContainsKey(userId);

	public int OnlineCount => _byUser.Count;

	/// <summary>Every account with at least one live connection.</summary>
	public IReadOnlyCollection<string> OnlineUserIds() => _byUser.Keys.ToList();

	/// <summary>The connections one account currently holds, so their activity can be derived.</summary>
	public IReadOnlyCollection<string> ConnectionsOf(string userId) =>
		_byUser.TryGetValue(userId, out var connections) ? connections.Keys.ToList() : Array.Empty<string>();
}
