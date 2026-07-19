namespace CorroServer.Services.Rules;

// Shared result types for card effects. The package card pipeline (CardOutcomeApplier ->
// ICardActions) produces a CardEffect describing what a card did, and DrawCardAsync returns a
// CardDrawResult. (These used to live alongside the now-removed hardcoded card classes.)

public record CardDrawResult
{
	public bool Success { get; init; }
	public string? Error { get; init; }
	public string? CardId { get; init; }
	public CardEffect? Effect { get; init; }
}

public record CardEffect
{
	public required string Type { get; init; } // "move", "money", "holding", "releasePass", "unknown"
	public string? Description { get; init; }
	public int? Amount { get; init; }
	public int? MovedTo { get; init; }
	public bool PassedGo { get; init; } = false;
	public bool CardHeld { get; init; } = false;
	public bool DebtCreated { get; init; } = false;
}
