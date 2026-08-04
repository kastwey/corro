using System.Reflection;
using CorroServer.Extensions;
using CorroServer.Services;
using CorroServer.Services.Accounts;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The startup provisioning must know about every container the code reads.
///
/// This is a regression test for a failure with no symptom. Production held only <c>Games</c>: the
/// three containers accounts need had never been created there, because the provisioning ran in
/// Development only and nothing else provisioned them. Cosmos does not complain about a container
/// until somebody writes to one, so signing in simply did not work — for months, silently, while
/// every test and every local run passed.
///
/// Two things now hold it together. The provisioning runs in every environment (Program.cs), and the
/// container list is DATA that this test compares against the repositories themselves — so adding a
/// container without provisioning it fails here rather than in production.
/// </summary>
public class CosmosContainerProvisioningTests
{
	/// <summary>
	/// Every <c>*ContainerName</c> constant the repositories declare. Found by reflection on purpose:
	/// a hand-written list here would rot exactly the way the provisioning did.
	/// </summary>
	private static IEnumerable<(string Owner, string Name)> DeclaredContainers() =>
		new[] { typeof(CosmosUserRepository), typeof(CosmosGameRepository) }
			.SelectMany(type => type
				.GetFields(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
				.Where(field => field.IsLiteral
					&& field.FieldType == typeof(string)
					&& field.Name.EndsWith("ContainerName", StringComparison.Ordinal))
				.Select(field => (type.Name, (string)field.GetRawConstantValue()!)));

	[Fact]
	public void Every_container_the_repositories_open_is_created_at_startup()
	{
		var provisioned = ServiceCollectionExtensions.CosmosContainers
			.Select(container => container.Name)
			.ToHashSet(StringComparer.Ordinal);

		var missing = DeclaredContainers()
			.Where(declared => !provisioned.Contains(declared.Name))
			.Select(declared => $"{declared.Name} (used by {declared.Owner})")
			.ToList();

		Assert.True(missing.Count == 0,
			"These containers are read by the code but never created at startup, which fails only "
			+ "once somebody writes to one — in production, invisibly: "
			+ string.Join(", ", missing));
	}

	[Fact]
	public void Nothing_is_created_that_no_repository_reads()
	{
		var declared = DeclaredContainers().Select(c => c.Name).ToHashSet(StringComparer.Ordinal);

		var orphans = ServiceCollectionExtensions.CosmosContainers
			.Select(container => container.Name)
			.Where(name => !declared.Contains(name))
			.ToList();

		Assert.True(orphans.Count == 0,
			"Created at startup but read by nothing — a leftover from a removed feature: "
			+ string.Join(", ", orphans));
	}

	// The whole design rests on each container being partitioned by the key it is queried with: that
	// is what makes its lookup a point read and lets its duplicate-id rejection guard a race.
	[Fact]
	public void Every_container_is_partitioned_by_one_plain_top_level_key()
	{
		foreach (var (name, path) in ServiceCollectionExtensions.CosmosContainers)
		{
			Assert.StartsWith("/", path, StringComparison.Ordinal);
			Assert.DoesNotContain('/', path[1..]);
			Assert.DoesNotContain('*', path);
			Assert.False(path.EndsWith('/'), $"{name} partition key path has a trailing slash");
		}
	}

	[Fact]
	public void The_list_names_each_container_once()
	{
		var names = ServiceCollectionExtensions.CosmosContainers.Select(c => c.Name).ToList();
		Assert.Equal(names.Count, names.Distinct(StringComparer.Ordinal).Count());
	}

	// Named so a reader of the deployment docs can check what a database should hold against
	// something that cannot drift from the code.
	[Fact]
	public void The_containers_are_the_five_this_build_expects()
	{
		Assert.Equal(
			new[] { "Friendships", "Games", "Handles", "Identities", "Users" },
			ServiceCollectionExtensions.CosmosContainers
				.Select(container => container.Name)
				.OrderBy(name => name, StringComparer.Ordinal));
	}
}
