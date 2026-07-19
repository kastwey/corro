namespace CorroServer.Services.Commands;

/// <summary>
/// Transient rent adjustment for a single landing, set by movement cards that
/// change how much rent is due (e.g. "advance to nearest railway: pay double",
/// "advance to nearest utility: pay 10× a dice throw"). It is consumed by the rent
/// calculation and cleared by the card right after the landing resolves, so it
/// never leaks into a later, unrelated landing.
/// </summary>
public sealed record RentModifier
{
	/// <summary>Multiplies the normally-due rent (e.g. 2 for the railway card).</summary>
	public int Multiplier { get; init; } = 1;

	/// <summary>
	/// When true, utility rent is charged as 10× a fresh dice throw instead of the
	/// ownership-based amount (the "advance to nearest utility" card rule).
	/// </summary>
	public bool UtilityTenTimesDice { get; init; }

	/// <summary>
	/// The total of the explicit dice throw made for the utility card rule. Rolled and
	/// announced by the rent flow (only when rent is actually due) so the extra throw is
	/// visible to players, then consumed by the rent calculation as the 10× multiplicand.
	/// </summary>
	public int? UtilityDiceTotal { get; init; }
}
