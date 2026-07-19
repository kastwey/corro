using CorroServer.Models;
using CorroServer.Services;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Save→restore round-trip for the HIDDEN-INFORMATION card families (journey, assembly,
/// draft, shedding, exploding). A game's full state is persisted to Cosmos as JSON via
/// <see cref="SystemTextJsonCosmosSerializer"/>; if a state record's SHAPE changes (a
/// renamed property, a restructured seat), an in-flight game silently fails to restore.
/// Before this test no card family was covered — these pin that each family's sub-state,
/// its private hands and its piles survive the exact production serialization, so any
/// shape change (e.g. a chassis refactor) trips a fast unit test, not a live restore.
/// </summary>
public class CardFamilyPersistenceTests
{
	private static readonly SystemTextJsonCosmosSerializer Serializer = new();

	/// <summary>Round-trip a state through the production Cosmos serializer.</summary>
	private static GameState RoundTrip(GameState state)
	{
		using var stream = Serializer.ToStream(state);
		return Serializer.FromStream<GameState>(stream);
	}

	private static List<Player> Players() => new()
	{
		TestFixtures.NewPlayer("a"), TestFixtures.NewPlayer("b"),
	};

	[Fact]
	public void Journey_game_survives_the_cosmos_round_trip()
	{
		var state = new GameState
		{
			GameType = "journey",
			Players = Players(),
			CurrentTurn = "a",
			Journey = new JourneyState
			{
				Round = 2,
				HasDrawn = true,
				Seats =
				{
					new JourneySeatState
					{
						PlayerId = "a",
						Members = { new JourneyMemberState { PlayerId = "a", Hand = { new JourneyCardInstance { InstanceId = "d25#0", CardId = "d25" } } } },
						Km = 125, Hazards = { "stop" }, Immunities = { "priority" }, Score = 300,
					},
				},
				DrawPile = { new JourneyCardInstance { InstanceId = "go#0", CardId = "go" } },
				DiscardPile = { new JourneyCardInstance { InstanceId = "d25#1", CardId = "d25" } },
				PendingCoup = new PendingJourneyCoup
				{
					VictimId = "a",
					AttackerId = "b",
					HazardKind = "stop",
					ImmunityInstanceId = "priority#0",
				},
			},
		};

		var back = RoundTrip(state).Journey!;
		Assert.Equal("journey", RoundTrip(state).GameType);
		Assert.Equal(2, back.Round);
		Assert.True(back.HasDrawn);
		var seat = Assert.Single(back.Seats);
		Assert.Equal(125, seat.Km);
		Assert.Equal(new[] { "stop" }, seat.Hazards);
		Assert.Equal("d25#0", Assert.Single(Assert.Single(seat.Members).Hand).InstanceId);
		Assert.Equal("go#0", Assert.Single(back.DrawPile).InstanceId);
		Assert.Equal("priority#0", back.PendingCoup!.ImmunityInstanceId);
	}

	[Fact]
	public void Assembly_game_survives_the_cosmos_round_trip()
	{
		var state = new GameState
		{
			GameType = "assembly",
			Players = Players(),
			CurrentTurn = "a",
			Assembly = new AssemblyState
			{
				Seats =
				{
					new AssemblySeatState
					{
						PlayerId = "a",
						Hand = { new AssemblyCardInstance { InstanceId = "reactor#0", CardId = "reactor" } },
						Slots =
						{
							new AssemblySlot
							{
								Color = "red",
								Piece = new AssemblyCardInstance { InstanceId = "reactor#1", CardId = "reactor" },
								Afflictions = { new AssemblyCardInstance { InstanceId = "sobrecarga#0", CardId = "sobrecarga" } },
							},
						},
					},
					new AssemblySeatState { PlayerId = "b", Retired = true },
				},
				DrawPile = { new AssemblyCardInstance { InstanceId = "nucleo#0", CardId = "nucleo" } },
				DiscardPile = { new AssemblyCardInstance { InstanceId = "grieta#0", CardId = "grieta" } },
			},
		};

		var back = RoundTrip(state).Assembly!;
		var seat = back.Seats.Single(s => s.PlayerId == "a");
		Assert.Equal("reactor#0", Assert.Single(seat.Hand).InstanceId);
		var slot = Assert.Single(seat.Slots);
		Assert.Equal("red", slot.Color);
		Assert.Equal("sobrecarga#0", Assert.Single(slot.Afflictions).InstanceId);
		Assert.True(back.Seats.Single(s => s.PlayerId == "b").Retired);
		Assert.Equal("nucleo#0", Assert.Single(back.DrawPile).InstanceId);
	}

	[Fact]
	public void Draft_game_survives_the_cosmos_round_trip()
	{
		var state = new GameState
		{
			GameType = "draft",
			Players = Players(),
			CurrentTurn = null, // the simultaneous family holds no turn
			Draft = new DraftState
			{
				Round = 2,
				Trick = 3,
				Seats =
				{
					new DraftSeatState
					{
						PlayerId = "a",
						Hand = { new DraftCardInstance { InstanceId = "gamba#0", CardId = "gamba" } },
						CommittedInstanceId = "gamba#0", HasPicked = true,
						Table = { new DraftTableSlot { Card = new DraftCardInstance { InstanceId = "salsa#0", CardId = "salsa" } } },
						Desserts = { new DraftCardInstance { InstanceId = "flan#0", CardId = "flan" } },
						Score = 21, RoundScores = { 9, 12 },
					},
				},
				DrawPile = { new DraftCardInstance { InstanceId = "flan#1", CardId = "flan" } },
			},
		};

		var back = RoundTrip(state).Draft!;
		Assert.Equal(3, back.Trick);
		var seat = Assert.Single(back.Seats);
		Assert.Equal("gamba#0", Assert.Single(seat.Hand).InstanceId);
		Assert.Equal("gamba#0", seat.CommittedInstanceId);
		Assert.True(seat.HasPicked);
		Assert.Equal("salsa#0", Assert.Single(seat.Table).Card.InstanceId);
		Assert.Equal("flan#0", Assert.Single(seat.Desserts).InstanceId);
		Assert.Equal(new[] { 9, 12 }, seat.RoundScores);
	}

	[Fact]
	public void Shedding_game_survives_the_cosmos_round_trip()
	{
		var state = new GameState
		{
			GameType = "shedding",
			Players = Players(),
			CurrentTurn = "a",
			Shedding = new SheddingState
			{
				Round = 2,
				CurrentColor = "azul",
				Direction = -1,
				Seats =
				{
					new SheddingSeatState
					{
						PlayerId = "a",
						Hand = { new SheddingCardInstance { InstanceId = "azul-5#0", CardId = "azul-5" } },
						Score = 40, RoundScores = { 40 },
					},
				},
				DrawPile = { new SheddingCardInstance { InstanceId = "rojo-7#0", CardId = "rojo-7" } },
				DiscardPile = { new SheddingCardInstance { InstanceId = "azul-2#0", CardId = "azul-2" } },
				PendingDrawnPlay = new PendingDrawnPlay { PlayerId = "a", InstanceId = "azul-5#0" },
			},
		};

		var back = RoundTrip(state).Shedding!;
		Assert.Equal("azul", back.CurrentColor);
		Assert.Equal(-1, back.Direction);
		var seat = Assert.Single(back.Seats);
		Assert.Equal("azul-5#0", Assert.Single(seat.Hand).InstanceId);
		Assert.Equal(40, seat.Score);
		Assert.Equal("rojo-7#0", Assert.Single(back.DrawPile).InstanceId);
		Assert.Equal("azul-2#0", Assert.Single(back.DiscardPile).InstanceId);
		Assert.Equal("azul-5#0", back.PendingDrawnPlay!.InstanceId);
	}

	[Fact]
	public void Exploding_game_survives_the_cosmos_round_trip()
	{
		var state = new GameState
		{
			GameType = "exploding",
			Players = Players(),
			CurrentTurn = "a",
			Exploding = new ExplodingState
			{
				DrawsOwed = 2, // the current player is under an Attack
				Seats =
				{
					new ExplodingSeatState
					{
						PlayerId = "a",
						Hand = { new ExplodingCardInstance { InstanceId = "defuse#0", CardId = "defuse" } },
					},
					new ExplodingSeatState { PlayerId = "b", Retired = true }, // exploded, out of play
                },
				DrawPile = { new ExplodingCardInstance { InstanceId = "bomb#0", CardId = "bomb" } },
				DiscardPile = { new ExplodingCardInstance { InstanceId = "skip#0", CardId = "skip" } },
				PendingAction = new PendingExplodingAction
				{
					ActorId = "a",
					CardId = "attack",
					TargetId = null,
					NopeCount = 1,
				},
				PendingFavor = new PendingExplodingFavor { RequesterId = "a", TargetId = "b" },
			},
		};

		var back = RoundTrip(state).Exploding!;
		Assert.Equal(2, back.DrawsOwed);
		Assert.Equal("b", back.PendingFavor!.TargetId);
		var seat = back.Seats.Single(s => s.PlayerId == "a");
		Assert.Equal("defuse#0", Assert.Single(seat.Hand).InstanceId);
		Assert.True(back.Seats.Single(s => s.PlayerId == "b").Retired);
		Assert.Equal("bomb#0", Assert.Single(back.DrawPile).InstanceId); // the ordered pile survives
		Assert.Equal("skip#0", Assert.Single(back.DiscardPile).InstanceId);
		Assert.Equal("attack", back.PendingAction!.CardId);
		Assert.Equal(1, back.PendingAction!.NopeCount);
	}
}
