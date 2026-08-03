using CorroServer.Controllers;
using CorroServer.Hubs;
using CorroServer.Services;
using Microsoft.Extensions.Options;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The one number a deployment may publish about itself: how many tables have somebody at them.
///
/// The interesting case is not the count — <see cref="GameSessionRegistryTests"/> pins that — but
/// the SILENCE. A host who has not turned this on must not be answered with a zero: "we don't say"
/// and "nobody is here" are different facts, and a visitor deciding whether to bother creating a
/// table would read the second one out of the first.
/// </summary>
public class PublicMetricsTests
{
	private static ConfigController Controller(bool show, GameSessionRegistry? sessions)
		=> new(
			Options.Create(new SiteBrandingOptions { Title = "All Welcome" }),
			metrics: Options.Create(new PublicMetricsOptions { ShowActiveTables = show }),
			sessions: sessions);

	private static int? ActiveTables(ConfigController controller)
	{
		var value = controller.GetMetrics().Value!;
		return (int?)value.GetType().GetProperty("ActiveTables")!.GetValue(value);
	}

	[Fact]
	public void A_deployment_that_publishes_the_count_reports_the_live_one()
	{
		var sessions = GameSessionRegistryTests.NewStubRegistry();
		sessions.MapConnectionToGame("c1", "g1");
		sessions.MapConnectionToGame("c2", "g1");
		sessions.MapLobbyConnection("c3", "g2");

		Assert.Equal(2, ActiveTables(Controller(show: true, sessions)));
	}

	[Fact]
	public void A_deployment_that_publishes_nothing_says_nothing_rather_than_zero()
	{
		var sessions = GameSessionRegistryTests.NewStubRegistry();
		sessions.MapConnectionToGame("c1", "g1");

		// The count exists and is 1, and the answer is still "no number".
		Assert.Null(ActiveTables(Controller(show: false, sessions)));
	}

	[Fact]
	public void An_empty_server_that_asked_for_the_number_gets_a_real_zero()
	{
		Assert.Equal(0, ActiveTables(Controller(show: true, GameSessionRegistryTests.NewStubRegistry())));
	}

	// The default is OFF: a fresh clone, and any deployment that never heard of the setting,
	// publishes nothing at all.
	[Fact]
	public void The_setting_is_off_until_a_host_turns_it_on()
	{
		Assert.False(new PublicMetricsOptions().ShowActiveTables);

		var controller = new ConfigController(
			Options.Create(new SiteBrandingOptions { Title = "All Welcome" }),
			sessions: GameSessionRegistryTests.NewStubRegistry());
		Assert.Null(ActiveTables(controller));
	}
}
