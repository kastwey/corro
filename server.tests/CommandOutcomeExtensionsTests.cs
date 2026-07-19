using CorroServer.Services.Commands;
using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Tests for the shared command-handler guard helpers. AsError centralizes the failed-outcome →
/// ErrorResponse mapping that ~15 handlers used to repeat, so its behaviour is pinned here.
/// </summary>
public class CommandOutcomeExtensionsTests
{
	[Fact]
	public void AsError_returns_null_for_a_successful_outcome()
	{
		IOutcome ok = new PropertyManagementOutcome { Success = true };
		Assert.Null(ok.AsError());
	}

	[Fact]
	public void AsError_maps_a_failed_outcome_to_its_error_message_and_code()
	{
		IOutcome failed = new PropertyManagementOutcome { Success = false, Error = "Cannot mortgage", ErrorCode = "ALREADY_MORTGAGED" };

		var error = failed.AsError();

		Assert.NotNull(error);
		Assert.Equal("Cannot mortgage", error!.Message);
		Assert.Equal("ALREADY_MORTGAGED", error.Code);
	}

	[Fact]
	public void AsError_never_yields_null_message_or_code_for_a_failure()
	{
		IOutcome failed = new HoldingOutcome { Success = false }; // Error/ErrorCode left unset

		var error = failed.AsError();

		Assert.NotNull(error);
		Assert.Equal(string.Empty, error!.Message);
		Assert.Equal(string.Empty, error.Code);
	}
}
