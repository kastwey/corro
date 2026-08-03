namespace CorroServer.Services;

/// <summary>
/// Who answers for the personal data this deployment holds.
///
/// This is NOT branding. Even without accounts, Corro processes chosen player names, seat
/// credentials, game records, chat and technical connection data. Signing in adds profile and
/// provider data. Under the GDPR that makes whoever runs the deployment a data controller with a
/// legal obligation to identify themselves and provide a way to be reached. That identity belongs
/// to the host, not to the software, so every host fills in their own.
///
/// The policy TEXT is not here. It lives as markdown beside the app (see server/Legal), because
/// what Corro does with data is the same wherever it runs; only the identity below changes. The
/// text is rendered with the controller's details substituted in.
///
/// Left empty — the default for a fresh clone and local development — the endpoint reports that no
/// notice is configured and the footer hides its link. That is a supported runtime state, not a
/// claim that the deployment processes no personal data. A public host should configure this even
/// when external sign-in is disabled.
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
	/// Whether this deployment has supplied enough identity details to serve its built-in notice.
	/// </summary>
	public bool IsConfigured =>
		!string.IsNullOrWhiteSpace(ControllerName)
		&& !string.IsNullOrWhiteSpace(Jurisdiction)
		&& !string.IsNullOrWhiteSpace(Contact);
}
