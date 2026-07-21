using System.Text;
using CorroServer.Services.Corro;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The filesystem package blob store round-trips an uploaded archive durably (so a package game can
/// be restored), replaces on re-put, deletes, and reports a missing key as null.
/// </summary>
public class PackageBlobStoreTests
{
	private static LocalFilePackageBlobStore NewStore()
		=> new(Path.Combine(Path.GetTempPath(), "corro_blob_" + Guid.NewGuid().ToString("N")));

	private static MemoryStream Bytes(string s) => new(Encoding.UTF8.GetBytes(s));

	private static async Task<string> ReadAll(Stream s)
	{
		await using (s) { using var r = new StreamReader(s); return await r.ReadToEndAsync(); }
	}

	private static async Task<List<PackageBlobInfo>> ListAll(IPackageBlobStore store)
	{
		var result = new List<PackageBlobInfo>();
		await foreach (var blob in store.ListAsync())
		{
			result.Add(blob);
		}
		return result;
	}

	[Fact]
	public async Task Put_then_Get_round_trips_the_archive_bytes()
	{
		var store = NewStore();
		await store.PutAsync("tok1", Bytes("PK-zip-payload"));

		var got = await store.GetAsync("tok1");
		Assert.NotNull(got);
		Assert.Equal("PK-zip-payload", await ReadAll(got!));
	}

	[Fact]
	public async Task Get_returns_null_for_a_missing_key()
		=> Assert.Null(await NewStore().GetAsync("nope"));

	[Fact]
	public async Task Put_replaces_an_existing_archive()
	{
		var store = NewStore();
		await store.PutAsync("tok", Bytes("first"));
		await store.PutAsync("tok", Bytes("second"));

		Assert.Equal("second", await ReadAll((await store.GetAsync("tok"))!));
	}

	[Fact]
	public async Task Delete_removes_the_archive_and_is_a_no_op_when_absent()
	{
		var store = NewStore();
		await store.PutAsync("tok", Bytes("x"));

		await store.DeleteAsync("tok");
		Assert.Null(await store.GetAsync("tok"));

		await store.DeleteAsync("tok"); // absent now: must not throw
	}

	[Fact]
	public async Task List_reports_stored_keys_and_last_modification_times()
	{
		var store = NewStore();
		var before = DateTimeOffset.UtcNow.AddSeconds(-1);
		await store.PutAsync("tok-a", Bytes("a"));
		await store.PutAsync("tok-b", Bytes("b"));

		var listed = await ListAll(store);

		Assert.Equal(new[] { "tok-a", "tok-b" }, listed.Select(blob => blob.Key).OrderBy(key => key));
		Assert.All(listed, blob => Assert.True(blob.LastModified >= before));
	}

	[Fact]
	public async Task Keys_that_differ_only_by_unsafe_characters_do_not_collide_into_traversal()
	{
		// The key is sanitized to a file name; a traversal-looking key still stays inside the folder.
		var store = NewStore();
		await store.PutAsync("../escape", Bytes("contained"));

		Assert.Equal("contained", await ReadAll((await store.GetAsync("../escape"))!));
	}
}
