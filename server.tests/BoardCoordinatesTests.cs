using CorroServer.Services;

namespace CorroServer.Tests;

/// <summary>
/// Tests for the pure board geometry helpers. <see cref="BoardCoordinates.DidPassThroughGo"/>
/// is central to the GO-bonus logic, so it is covered carefully.
/// </summary>
public class BoardCoordinatesTests
{
	[Theory]
	[InlineData(0, 0)]
	[InlineData(39, 39)]
	[InlineData(40, 0)]
	[InlineData(41, 1)]
	[InlineData(-1, 39)]
	[InlineData(-40, 0)]
	[InlineData(80, 0)]
	public void NormalizePosition_WrapsAroundFortySquares(int input, int expected)
	{
		Assert.Equal(expected, BoardCoordinates.NormalizePosition(input));
	}

	[Theory]
	// Landing exactly on GO from anywhere else counts as passing GO.
	[InlineData(38, 0, true)]
	[InlineData(35, 0, true)]
	// Wrapping around the board passes GO.
	[InlineData(38, 2, true)]
	[InlineData(39, 5, true)]
	// Forward movement that does not wrap does not pass GO.
	[InlineData(3, 10, false)]
	[InlineData(0, 5, false)]
	// Starting on GO and moving forward does not "pass" GO again.
	[InlineData(0, 0, false)]
	public void DidPassThroughGo_DetectsWrapAndLanding(int from, int to, bool expected)
	{
		Assert.Equal(expected, BoardCoordinates.DidPassThroughGo(from, to));
	}

	[Fact]
	public void Calculate_ReturnsCoordinatesForCorners()
	{
		// GO is the bottom-right corner; index 0 should be a valid coordinate.
		var go = BoardCoordinates.Calculate(0);
		Assert.InRange(go.X, 0, 10);
		Assert.InRange(go.Y, 0, 10);
	}
}
