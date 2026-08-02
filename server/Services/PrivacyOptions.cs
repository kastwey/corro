namespace CorroServer.Services;

/// <summary>
/// Who answers for the personal data this deployment holds.
///
/// This is NOT branding. Corro stores an email address the moment somebody signs in, and under the
/// GDPR that makes whoever runs the deployment a data controller with a legal obligation to say so
/// — by name, with a way to be reached. That is a fact about the person running the server, not
/// about the software, so it cannot be shipped: every host fills in their own.
///
/// The policy TEXT is not here. It lives as markdown beside the app (see wwwroot/legal), because
/// what Corro does with data is the same wherever it runs; only the identity below changes. The
/// text is rendered with the controller's details substituted in.
///
/// Left empty — the default, and what a fresh clone does — the deployment simply offers no account
/// UI at all, which the accounts feature already treats as a fully supported configuration rather
/// than a degraded one. A server that asks for no personal data owes no notice about it.
/// </summary>
public sealed class PrivacyOptions
{
	public const string SectionName = "Privacy";
	public const int MaxNameLength = 200;
	public const int MaxContactLength = 320; // an email address's maximum length
	public const int MaxJurisdictionLength = 200;

	/// <summary>
	/// The controller's name: the natural person or the organisation who decides what happens to
	/// the data. A pseudonym does not satisfy the obligation — this is the name somebody would sue.
	/// </summary>
	public string? ControllerName { get; init; }

	/// <summary>
	/// Where the controller is established, which is what decides whose data-protection law applies
	/// and which supervisory authority a complaint goes to. "Dublin, Ireland" rather than "the EU".
	/// </summary>
	public string? Jurisdiction { get; init; }

	/// <summary>
	/// How to reach the controller about their data. Usually an email address, and it must be one
	/// somebody actually reads: the right of access has a one-month deadline attached to it.
	/// </summary>
	public string? Contact { get; init; }

	/// <summary>
	/// A deployment that would rather publish its own policy elsewhere points at it here, and the
	/// built-in text is replaced by a link. Useful for a host who already has a privacy page, or
	/// whose lawyer wrote them one.
	/// </summary>
	public string? PolicyUrl { get; init; }

	/// <summary>
	/// Whether this deployment has said who it is. Sign-in should not be offered without it: asking
	/// for an address while refusing to say who receives it is the thing the obligation exists to
	/// prevent.
	/// </summary>
	public bool IsConfigured =>
		!string.IsNullOrWhiteSpace(ControllerName)
		&& !string.IsNullOrWhiteSpace(Jurisdiction)
		&& !string.IsNullOrWhiteSpace(Contact);
}
