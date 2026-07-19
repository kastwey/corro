namespace CorroServer.Models;

/// <summary>One player's piece on the track. Square 0 = not on the board yet (the classic
/// game starts OFF the board; the first roll enters at its value).</summary>
public record TrackPlayerPosition
{
	public required string PlayerId { get; init; }
	public int Square { get; set; }
}

/// <summary>Everything track-specific inside GameState (null in other families).</summary>
public record TrackState
{
	public List<TrackPlayerPosition> Positions { get; init; } = new();
}
