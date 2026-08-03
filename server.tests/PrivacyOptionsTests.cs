using CorroServer.Services;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Who answers for the personal data a deployment holds. Tables already contain names, credentials,
/// game records and chat; signing in adds profile and provider data. Whoever runs the server is the
/// controller and must supply their own identity rather than inheriting one from the software.
///
/// The rule these pin is that a notice is either whole or absent. A half-filled one is the worst
/// outcome: it looks like an answer and reaches nobody.
/// </summary>
public class PrivacyOptionsTests
{
	[Fact]
	public void A_deployment_that_has_said_nothing_is_valid_and_simply_has_no_notice()
	{
		// What a fresh clone and local development use. This is a supported runtime state, not a
		// statement that an account-less public deployment processes no personal data.
		Assert.False(new PrivacyOptions().IsConfigured);
	}

	[Fact]
	public void All_three_together_are_what_makes_a_notice()
	{
		var options = new PrivacyOptions
		{
			ControllerName = "Juan José Montiel Pérez",
			Jurisdiction = "Dublin, Ireland",
			Contact = "privacy@example.test",
		};

		Assert.True(options.IsConfigured);
	}

	[Theory]
	// A name with no way to reach it, a contact belonging to nobody, and a name and address with no
	// jurisdiction — which is what decides whose law applies and which authority hears a complaint.
	[InlineData("Someone", "Dublin, Ireland", null)]
	[InlineData(null, "Dublin, Ireland", "privacy@example.test")]
	[InlineData("Someone", null, "privacy@example.test")]
	[InlineData("Someone", "   ", "privacy@example.test")]
	public void A_partial_notice_does_not_count_as_one(string? name, string? jurisdiction, string? contact)
	{
		var options = new PrivacyOptions
		{
			ControllerName = name,
			Jurisdiction = jurisdiction,
			Contact = contact,
		};

		Assert.False(options.IsConfigured);
	}

	[Fact]
	public void A_policy_url_does_not_stand_in_for_saying_who_you_are()
	{
		// Pointing at your own page is fine — but the identity is still owed, because it is what
		// the link is supposed to lead to.
		var options = new PrivacyOptions { PolicyUrl = "https://example.test/privacy" };

		Assert.False(options.IsConfigured);
	}
}
