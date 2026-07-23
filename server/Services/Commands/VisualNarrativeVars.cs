namespace CorroServer.Services.Commands;

/// <summary>
/// Adds presentation-only metadata to an authoritative announcement. The translated key remains
/// the complete spoken/visible sentence; these reserved flat variables only tell the client how
/// to illustrate the same mechanic without parsing localized prose or branching on package ids.
/// Hidden card identities must only be added to audience-specific dictionaries that already reveal
/// that identity in their announcement.
/// </summary>
internal static class VisualNarrativeVars
{
	public static Dictionary<string, object> Add(
		Dictionary<string, object> vars,
		string kind,
		string? sourcePlayerId = null,
		string? targetPlayerId = null,
		string? cardId = null,
		string? cardType = null,
		int? count = null,
		string? tone = null)
	{
		vars["visualKind"] = kind;
		if (!string.IsNullOrEmpty(sourcePlayerId))
		{
			vars["visualSourcePlayerId"] = sourcePlayerId;
		}
		if (!string.IsNullOrEmpty(targetPlayerId))
		{
			vars["visualTargetPlayerId"] = targetPlayerId;
		}
		if (!string.IsNullOrEmpty(cardId))
		{
			vars["visualCardId"] = cardId;
		}
		if (!string.IsNullOrEmpty(cardType))
		{
			vars["visualCardType"] = cardType;
		}
		if (count is not null)
		{
			vars["visualCount"] = count.Value;
		}
		if (!string.IsNullOrEmpty(tone))
		{
			vars["visualTone"] = tone;
		}
		return vars;
	}

	public static void AddPrivateCardIds(Dictionary<string, object> vars, IEnumerable<string> cardIds)
	{
		var index = 1;
		foreach (var cardId in cardIds)
		{
			vars[$"visualCard{index}Id"] = cardId;
			index++;
		}
	}
}
