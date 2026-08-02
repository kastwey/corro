using System.Text.Json;
using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Corro;

/// <summary>
/// The fixed catalog of host-customizable rule codes the engine implements. A package may only
/// choose, default, rename and expose these — it can't invent new mechanics (that's engine code,
/// not data). Codes are generic and brand-agnostic. Property codes map to
/// <see cref="GameSettings"/> fields; journey codes map to <see cref="JourneyRulesConfig"/>
/// fields (each family validates its manifest against ITS code set).
/// </summary>
public static class HouseRuleCatalog
{
	// GameSettings is an init-only record, so each applier returns a new settings via `with`.
	private static readonly Dictionary<string, Func<GameSettings, JsonElement, GameSettings>> Appliers = new()
	{
		["startingMoney"] = (s, v) => s with { StartingMoney = v.GetInt32() },
		["passStartBonus"] = (s, v) => s with { GoBonus = v.GetInt32() },
		["doubleOnExactStart"] = (s, v) => s with { DoubleGoSalary = v.GetBoolean() },
		["bonusDie"] = (s, v) => s with { UseBonusDie = v.GetBoolean() },
		["auctionOnDecline"] = (s, v) => s with { AuctionOnDecline = v.GetBoolean() },
		["limitedBuildings"] = (s, v) => s with { BuildingShortage = v.GetBoolean() },
		["buildEvenly"] = (s, v) => s with { EvenBuildRule = v.GetBoolean() },
		["noBuildBeforeFirstLap"] = (s, v) => s with { NoBuildingFirstLap = v.GetBoolean() },
		["mortgageInterestRate"] = (s, v) => s with { MortgageInterestRate = v.GetInt32() },
		["holdingReleaseCost"] = (s, v) => s with { HoldingReleaseCost = v.GetInt32() },
		["maxHoldingTurns"] = (s, v) => s with { MaxHoldingTurns = v.GetInt32() },
		["collectRentWhileHeld"] = (s, v) => s with { CollectRentWhileHeld = v.GetBoolean() },
		["finesToCenterPot"] = (s, v) => s with { FreeParkingJackpot = v.GetBoolean() },
		["auctionTimeoutSeconds"] = (s, v) => s with { AuctionBidTimeoutSeconds = v.GetInt32() },
	};

	/// <summary>Whether the engine knows this rule code (the validator rejects unknown ones).</summary>
	public static bool IsKnown(string id) => Appliers.ContainsKey(id);

	/// <summary>Returns settings with the rule applied; unknown ids are left unchanged.</summary>
	public static GameSettings Apply(GameSettings settings, string id, JsonElement value)
		=> Appliers.TryGetValue(id, out var apply) ? apply(settings, value) : settings;

	// ── Journey family ────────────────────────────────────────────────────────

	private static readonly Dictionary<string, Func<JourneyRulesConfig, JsonElement, JourneyRulesConfig>> JourneyAppliers = new()
	{
		// 0 = a single hand: first to the goal wins outright (see JourneyRulebook.MatchOver).
		["journeyTargetScore"] = (r, v) => r with { TargetScore = v.GetInt32() },
		["journeyGoalKm"] = (r, v) => r with { GoalKm = v.GetInt32() },
		["journeyStackHazards"] = (r, v) => r with { StackHazards = v.GetBoolean() },
		// 0 disables the bonus, like every scoring field.
		["journeyAllImmunitiesBonus"] = (r, v) => r with { AllImmunitiesBonus = v.GetInt32() },
	};

	/// <summary>Whether the engine knows this JOURNEY rule code.</summary>
	public static bool IsKnownJourney(string id) => JourneyAppliers.ContainsKey(id);

	/// <summary>Returns journey rules with the rule applied; unknown ids are left unchanged.</summary>
	public static JourneyRulesConfig ApplyJourney(JourneyRulesConfig rules, string id, JsonElement value)
		=> JourneyAppliers.TryGetValue(id, out var apply) ? apply(rules, value) : rules;

	// ── Shedding family ───────────────────────────────────────────────────────

	/// <summary>The stacking modes the "sheddingStacking" choice rule accepts.</summary>
	public static readonly IReadOnlySet<string> SheddingStackingModes =
		new HashSet<string> { "none", "sameType", "cross" };

	/// <summary>The scoring directions the "sheddingScoring" choice rule accepts: "collect"
	/// (the round winner banks the rivals' leftovers, highest score wins) or "penalty"
	/// (everyone banks their own leftovers, reaching the target loses).</summary>
	public static readonly IReadOnlySet<string> SheddingScoringModes =
		new HashSet<string> { "collect", "penalty" };

	private static readonly Dictionary<string, Func<SheddingRulesConfig, JsonElement, SheddingRulesConfig>> SheddingAppliers = new()
	{
		["sheddingAllowDoubles"] = (r, v) => r with { AllowDoubles = v.GetBoolean() },
		// A "choice" rule: the value is one of SheddingStackingModes (validated by the family);
		// an unrecognised string is ignored so the classic default stands.
		["sheddingStacking"] = (r, v) => v.ValueKind == JsonValueKind.String
											 && SheddingStackingModes.Contains(v.GetString()!)
			? r with { Stacking = v.GetString()! }
			: r,
		// A "choice" rule, same shape as sheddingStacking: an unrecognised string is ignored so
		// the classic count stands.
		["sheddingScoring"] = (r, v) => v.ValueKind == JsonValueKind.String
										   && SheddingScoringModes.Contains(v.GetString()!)
			? r with { Scoring = v.GetString()! }
			: r,
		["sheddingLastCardCall"] = (r, v) => r with { LastCardCall = v.GetBoolean() },
		["sheddingLastCardPenalty"] = (r, v) => r with { LastCardPenalty = v.GetInt32() },
	};

	/// <summary>Whether the engine knows this SHEDDING rule code.</summary>
	public static bool IsKnownShedding(string id) => SheddingAppliers.ContainsKey(id);

	// ── Choice rules: the values the engine actually accepts ──────────────────

	/// <summary>The value set each CHOICE rule code accepts. A package declares its own options
	/// (ids + labels), so these are what those ids must be drawn from: every applier guards on
	/// membership and silently keeps the default otherwise, which would turn an option the
	/// engine never heard of into a radio that is offered, chosen, stored — and then ignored.</summary>
	public static readonly IReadOnlyDictionary<string, IReadOnlySet<string>> ChoiceValues =
		new Dictionary<string, IReadOnlySet<string>>
		{
			["sheddingStacking"] = SheddingStackingModes,
			["sheddingScoring"] = SheddingScoringModes,
		};

	/// <summary>
	/// Checks a declared house rule against the engine's value set for its code: returns the
	/// problem to report, or null when the rule is coherent. Codes the engine does not gate by
	/// value (toggles, numbers) pass untouched.
	/// </summary>
	public static string? ChoiceProblem(HouseRuleDef rule)
	{
		if (!ChoiceValues.TryGetValue(rule.Id, out var accepted))
		{
			return null;
		}

		var known = string.Join(", ", accepted.OrderBy(v => v, StringComparer.Ordinal));
		if (rule.Type != "choice")
		{
			return $"house rule '{rule.Id}' must be declared as a choice between {known}, not a '{rule.Type}'";
		}

		var declared = (rule.Options ?? new List<HouseRuleOption>()).Select(o => o.Id).ToList();
		if (declared.Count == 0)
		{
			return $"house rule '{rule.Id}' declares no options (the engine accepts {known})";
		}

		var unknown = declared.Where(id => !accepted.Contains(id)).ToList();
		if (unknown.Count > 0)
		{
			return $"house rule '{rule.Id}' offers {string.Join(", ", unknown)}, which the engine would ignore "
				+ $"(it accepts {known})";
		}

		var chosen = rule.Default?.ValueKind == JsonValueKind.String ? rule.Default.Value.GetString() : null;
		if (chosen != null && !declared.Contains(chosen))
		{
			return $"house rule '{rule.Id}' defaults to '{chosen}', which is not one of the options it offers";
		}

		return null;
	}

	/// <summary>Returns shedding rules with the rule applied; unknown ids are left unchanged.</summary>
	public static SheddingRulesConfig ApplyShedding(SheddingRulesConfig rules, string id, JsonElement value)
		=> SheddingAppliers.TryGetValue(id, out var apply) ? apply(rules, value) : rules;
}
