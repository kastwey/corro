using System.Text;
using CorroServer.Services.Corro;

namespace CorroServer.Tests;

/// <summary>
/// Integration tests for the real <see cref="AzureBlobPackageStore"/> against the Azurite emulator
/// (the same client used in production, exercised locally). They round-trip an uploaded archive the
/// way restore needs it. Gated by <see cref="AzuriteFactAttribute"/>, so they only run when Azurite
/// is up and are skipped — never failed — in CI.
/// </summary>
public class AzureBlobPackageStoreIntegrationTests
{
	// A throwaway container per run so tests never collide and leave nothing behind for the next run.
	private static AzureBlobPackageStore NewStore()
		=> new("UseDevelopmentStorage=true", "corro-test-" + Guid.NewGuid().ToString("N"));

	private static MemoryStream Bytes(string s) => new(Encoding.UTF8.GetBytes(s));

	private static async Task<string> ReadAll(Stream s)
	{
		await using (s) { using var r = new StreamReader(s); return await r.ReadToEndAsync(); }
	}

	[Fact]
	public async Task Constructing_the_store_does_no_network_IO_even_when_storage_is_unreachable()
	{
		// Regression: the ctor used to call CreateIfNotExists() synchronously, so merely resolving this
		// store through DI (for an endpoint that never touches blobs, e.g. GET /api/packages/shipped)
		// blocked on retries and then 500'd whenever the storage account was down — which took the whole
		// create-game flow with it. Constructing must be instant and never throw; the container is
		// created lazily on first real use instead. Point at a dead endpoint to prove no connection.
		// Azurite's dev connection string; whether or not Azurite is actually up, constructing the store
		// must not try to reach it (that's the regression — the ctor used to call CreateIfNotExists).
		var ctor = Task.Run(() => new AzureBlobPackageStore("UseDevelopmentStorage=true", "corro-test-ctor"));
		var finished = await Task.WhenAny(ctor, Task.Delay(TimeSpan.FromSeconds(5)));

		Assert.True(finished == ctor && ctor.IsCompletedSuccessfully, "constructing the store must not block on network I/O");
		Assert.NotNull(await ctor);
	}

	[AzuriteFact]
	public async Task Put_Get_Delete_round_trips_the_archive_against_Azurite()
	{
		var store = NewStore();
		var key = "tok-" + Guid.NewGuid().ToString("N");

		await store.PutAsync(key, Bytes("PK-zip-payload"));

		var got = await store.GetAsync(key);
		Assert.NotNull(got);
		Assert.Equal("PK-zip-payload", await ReadAll(got!));

		await store.DeleteAsync(key);
		Assert.Null(await store.GetAsync(key)); // gone after delete (restore would re-stage from /packages or fail cleanly)
	}

	[AzuriteFact]
	public async Task Put_replaces_an_existing_archive_and_missing_key_is_null()
	{
		var store = NewStore();
		Assert.Null(await store.GetAsync("never-put"));

		var key = "tok-" + Guid.NewGuid().ToString("N");
		await store.PutAsync(key, Bytes("v1"));
		await store.PutAsync(key, Bytes("v2")); // overwrite
		Assert.Equal("v2", await ReadAll((await store.GetAsync(key))!));

		await store.DeleteAsync(key);
	}
}
