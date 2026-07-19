using CorroServer.Extensions;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Pins how the DI layer decides to relax the CosmosClient to Gateway mode (and accept a self-signed
/// cert): only for the local EMULATOR, never for a real account. The emulator is recognised by a
/// localhost/127.0.0.1 endpoint OR its fixed well-known key — the latter is what lets the containerised
/// app (whose endpoint host is the "cosmos" compose service, not localhost) still switch to Gateway.
/// </summary>
public class CosmosEmulatorDetectionTests
{
	private const string EmulatorKey = ServiceCollectionExtensions.CosmosEmulatorAccountKey;

	[Fact]
	public void Localhost_endpoint_is_the_emulator()
	{
		Assert.True(ServiceCollectionExtensions.IsCosmosEmulator(
			$"AccountEndpoint=http://localhost:8081/;AccountKey={EmulatorKey}"));
	}

	[Fact]
	public void Loopback_ip_endpoint_is_the_emulator()
	{
		Assert.True(ServiceCollectionExtensions.IsCosmosEmulator(
			$"AccountEndpoint=http://127.0.0.1:8081/;AccountKey={EmulatorKey}"));
	}

	[Fact]
	public void Compose_service_host_is_recognised_by_the_well_known_key()
	{
		// Inside the Docker network the host is "cosmos", not localhost — the emulator key is what
		// still identifies it so the client switches to Gateway mode.
		Assert.True(ServiceCollectionExtensions.IsCosmosEmulator(
			$"AccountEndpoint=http://cosmos:8081/;AccountKey={EmulatorKey}"));
	}

	[Fact]
	public void A_real_account_is_never_treated_as_the_emulator()
	{
		Assert.False(ServiceCollectionExtensions.IsCosmosEmulator(
			"AccountEndpoint=https://corro-prod.documents.azure.com:443/;AccountKey=Zm9vYmFyRXhhbXBsZVJlYWxLZXk9PQ=="));
	}
}
