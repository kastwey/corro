using CorroServer.Controllers;
using CorroServer.Services;
using Microsoft.Extensions.Options;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// What a deployment may publish about itself: how many tables have somebody at them and how many
/// people are connected.
///
/// The interesting case is not the counts — <see cref="GameSessionRegistryTests"/> pins those —
/// but the SILENCE. A host who has not turned this on must not be answered with zeros: "we don't
/// say" and "nobody is here" are different facts, and a visitor deciding whether to bother
/// creating a table would read the second one out of the first.
/// </summary>
public class PublicMetricsTests
{
	private static ConfigController Controller(bool show, CorroServer.Hubs.GameSessionRegistry? sessions)
		=> new(
			Options.Create(new SiteBrandingOptions { Title = "All Welcome" }),
			metrics: Options.Create(new PublicMetricsOptions { ShowActivity = show }),
			sessions: sessions);

	private static (int? Tables, int? Players) Activity(ConfigController controller)
	{
		var value = controller.GetMetrics().Value!;
		var type = value.GetType();
		return (
			(int?)type.GetProperty("ActiveTables")!.GetValue(value),
			(int?)type.GetProperty("ConnectedPlayers")!.GetValue(value));
	}

	[Fact]
	public void A_deployment_that_publishes_its_activity_reports_the_live_numbers()
	{
		var sessions = GameSessionRegistryTests.NewStubRegistry();
		// Two people at one table (one of them with a second tab open), one at another.
		sessions.AuthenticateConnection("c1", "a"); sessions.MapConnectionToGame("c1", "g1");
		sessions.AuthenticateConnection("c2", "a"); sessions.MapConnectionToGame("c2", "g1");
		sessions.AuthenticateConnection("c3", "b"); sessions.MapConnectionToGame("c3", "g1");
		sessions.AuthenticateConnection("c4", "c"); sessions.MapLobbyConnection("c4", "g2");

		Assert.Equal((2, 3), Activity(Controller(show: true, sessions)));
	}

	[Fact]
	public void A_deployment_that_publishes_nothing_says_nothing_rather_than_zero()
	{
		var sessions = GameSessionRegistryTests.NewStubRegistry();
		sessions.AuthenticateConnection("c1", "a");
		sessions.MapConnectionToGame("c1", "g1");

		// The numbers exist and are 1 and 1, and the answer is still "no numbers".
		Assert.Equal((null, null), Activity(Controller(show: false, sessions)));
	}

	[Fact]
	public void An_empty_server_that_asked_for_the_numbers_gets_real_zeros()
	{
		Assert.Equal((0, 0), Activity(Controller(show: true, GameSessionRegistryTests.NewStubRegistry())));
	}

	// The default is OFF: a fresh clone, and any deployment that never heard of the setting,
	// publishes nothing at all.
	[Fact]
	public void The_setting_is_off_until_a_host_turns_it_on()
	{
		Assert.False(new PublicMetricsOptions().ShowActivity);

		var controller = new ConfigController(
			Options.Create(new SiteBrandingOptions { Title = "All Welcome" }),
			sessions: GameSessionRegistryTests.NewStubRegistry());
		Assert.Equal((null, null), Activity(controller));
	}
}
