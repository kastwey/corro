namespace CorroServer.Services;

/// <summary>
/// Pure static helper for calculating board coordinates.
/// The board is an 11x11 grid where squares are on the perimeter (40 squares).
/// </summary>
public static class BoardCoordinates
{
	private const int BoardSize = 40;

	/// <summary>
	/// Calculates the (X, Y) coordinates for a board position (0-39).
	/// Coordinates: 0-10 for CSS grid.
	/// </summary>
	public static (int X, int Y) Calculate(int position)
	{
		return (CalculateX(position), CalculateY(position));
	}

	/// <summary>
	/// Normalizes a position to stay within board bounds (0-39).
	/// </summary>
	public static int NormalizePosition(int position)
	{
		return ((position % BoardSize) + BoardSize) % BoardSize;
	}

	/// <summary>
	/// Determines if a player passed through GO when moving from one position to another.
	/// </summary>
	public static bool DidPassThroughGo(int fromPosition, int toPosition)
	{
		return fromPosition > toPosition || (fromPosition != 0 && toPosition == 0);
	}

	/// <summary>
	/// Calculates the X coordinate for a board position (0-39).
	/// </summary>
	private static int CalculateX(int position)
	{
		return position switch
		{
			// BOTTOM side: positions 0-10 (GO is at bottom right corner)
			// X decreases from right (10) to left (0): GO(10), 1(9), 2(8)... Holding(0)
			>= 0 and <= 10 => 10 - position,

			// LEFT side: positions 11-19 (going up from Holding)
			// X fixed at 0 (left column)
			>= 11 and <= 19 => 0,

			// TOP side: positions 20-30 (Free Parking is at top left corner)
			// X increases from left (0) to right (10): Parking(0), 21(1), 22(2)... SendToHolding(10)
			>= 20 and <= 30 => position - 20,

			// RIGHT side: positions 31-39 (going down towards GO)
			// X fixed at 10 (right column)
			>= 31 and <= 39 => 10,

			_ => 10 // Fallback
		};
	}

	/// <summary>
	/// Calculates the Y coordinate for a board position (0-39).
	/// Coordinates: 0-10 for CSS grid (Y=0 at top, Y=10 at bottom).
	/// </summary>
	private static int CalculateY(int position)
	{
		return position switch
		{
			// BOTTOM side: positions 0-10 (GO → Holding)
			// Y fixed at 10 (bottom row)
			>= 0 and <= 10 => 10,

			// LEFT side: positions 11-19 (going up from Holding)
			// Y decreases from bottom to top: 11→Y=9, 12→Y=8, ... 19→Y=1
			>= 11 and <= 19 => 10 - (position - 10),

			// TOP side: positions 20-30 (Free Parking → Go To Holding)
			// Y fixed at 0 (top row)
			>= 20 and <= 30 => 0,

			// RIGHT side: positions 31-39 (going down towards GO)
			// Y increases from top to bottom: 31→Y=1, 32→Y=2, ... 39→Y=9
			>= 31 and <= 39 => position - 30,

			_ => 10 // Fallback
		};
	}
}
