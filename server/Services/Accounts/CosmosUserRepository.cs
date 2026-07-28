using System.Net;
using CorroServer.Models;
using Microsoft.Azure.Cosmos;

namespace CorroServer.Services.Accounts;

/// <summary>
/// Cosmos-backed account storage, in the same <c>CorroGame</c> database as the games but in two
/// containers of its own.
///
/// The split exists because sign-in and everything else read by DIFFERENT keys. Once a session is
/// established every read starts from the account id, so <c>Users</c> is partitioned by
/// <c>/userId</c>. Sign-in instead arrives with an (issuer, subject) pair, which is not that key —
/// resolving it inside <c>Users</c> would mean a cross-partition query on the hottest path. The
/// <c>Identities</c> container is partitioned by the composite key itself, so both reads are point
/// reads.
/// </summary>
public class CosmosUserRepository : IUserRepository
{
	internal const string DatabaseName = "CorroGame";
	internal const string UsersContainerName = "Users";
	internal const string IdentitiesContainerName = "Identities";

	private readonly Container _users;
	private readonly Container _identities;
	private readonly ILogger<CosmosUserRepository> _logger;

	public CosmosUserRepository(CosmosClient cosmosClient, ILogger<CosmosUserRepository> logger)
	{
		var database = cosmosClient.GetDatabase(DatabaseName);
		_users = database.GetContainer(UsersContainerName);
		_identities = database.GetContainer(IdentitiesContainerName);
		_logger = logger;
	}

	public async Task<UserDocument?> GetUserAsync(string userId, CancellationToken ct = default)
	{
		try
		{
			var response = await _users.ReadItemAsync<UserDocument>(
				id: userId,
				partitionKey: new PartitionKey(userId),
				cancellationToken: ct);
			return response.Resource;
		}
		catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
		{
			return null;
		}
	}

	public async Task<IdentityLinkDocument?> GetIdentityLinkAsync(
		string identityKey,
		CancellationToken ct = default)
	{
		try
		{
			var response = await _identities.ReadItemAsync<IdentityLinkDocument>(
				id: identityKey,
				partitionKey: new PartitionKey(identityKey),
				cancellationToken: ct);
			return response.Resource;
		}
		catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
		{
			return null;
		}
	}

	/// <summary>
	/// Create-if-absent built on Cosmos's own duplicate-id rejection rather than a read-then-write,
	/// which would leave a window for two first-time sign-ins to both decide the identity was new.
	/// A 409 means another request stored it first, so we return THAT document and let the caller
	/// discard the account it was about to create.
	/// </summary>
	public async Task<IdentityLinkDocument> CreateOrGetIdentityLinkAsync(
		IdentityLinkDocument link,
		CancellationToken ct = default)
	{
		try
		{
			var response = await _identities.CreateItemAsync(
				link,
				new PartitionKey(link.IdentityKey),
				cancellationToken: ct);
			return response.Resource;
		}
		catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.Conflict)
		{
			_logger.LogInformation(
				"Identity {IdentityKey} was already linked by a concurrent sign-in; using the stored account.",
				link.IdentityKey);

			// The winner must exist: Cosmos only reports the conflict once the item is durable.
			var existing = await GetIdentityLinkAsync(link.IdentityKey, ct);
			return existing ?? throw new InvalidOperationException(
				$"Identity link '{link.IdentityKey}' reported a conflict but could not be read back.");
		}
	}

	/// <summary>
	/// Writes the account. Two upserts racing to CREATE the same document make one of them fail with
	/// a conflict — Cosmos resolves an upsert of a not-yet-existing item as an insert — which is a
	/// real scenario here: a double-submitted login signs the same account in twice at once. The
	/// retry succeeds because by then the document exists, so the upsert is an ordinary replace.
	/// </summary>
	public async Task<UserDocument> UpsertUserAsync(UserDocument user, CancellationToken ct = default)
	{
		try
		{
			var response = await _users.UpsertItemAsync(
				user,
				new PartitionKey(user.UserId),
				cancellationToken: ct);
			return response.Resource;
		}
		catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.Conflict)
		{
			_logger.LogInformation(
				"Account {UserId} was created concurrently; retrying the write as a replace.",
				user.UserId);

			var retry = await _users.UpsertItemAsync(
				user,
				new PartitionKey(user.UserId),
				cancellationToken: ct);
			return retry.Resource;
		}
	}

	public async Task DeleteUserAsync(string userId, CancellationToken ct = default)
	{
		try
		{
			await _users.DeleteItemAsync<UserDocument>(
				id: userId,
				partitionKey: new PartitionKey(userId),
				cancellationToken: ct);
		}
		catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
		{
			// Already gone: erasure has to be safe to retry.
		}
	}

	public async Task DeleteIdentityLinkAsync(string identityKey, CancellationToken ct = default)
	{
		try
		{
			await _identities.DeleteItemAsync<IdentityLinkDocument>(
				id: identityKey,
				partitionKey: new PartitionKey(identityKey),
				cancellationToken: ct);
		}
		catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
		{
			// Already gone: erasure has to be safe to retry.
		}
	}
}
