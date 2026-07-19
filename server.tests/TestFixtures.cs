using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Commands;

namespace CorroServer.Tests;

/// <summary>
/// Helpers to build lightweight game state and a <see cref="GameContext"/> for
/// rulebook/handler unit tests without spinning up SignalR or Cosmos.
/// </summary>
internal static class TestFixtures
{
	/// <summary>A PackageRestorer wired with throwaway local stores, for tests that build a GameHub but
	/// don't exercise package restore (the hub requires one as a dependency).</summary>
	public static CorroServer.Services.Corro.PackageRestorer NewPackageRestorer()
		=> new(
			new CorroServer.Services.Corro.CorroPackageStore(
				new CorroServer.Services.Sounds.CompositeSoundPackProvider(
					new CorroServer.Services.Sounds.DefaultSoundPackProvider())),
			new CorroServer.Services.Corro.ShippedPackageProvider(CorroTestPaths.PackagesRoot()),
			new CorroServer.Services.Corro.LocalFilePackageBlobStore());

	/// <summary>Announcer test double that records every announcement (and its audience) for assertions.</summary>
	public sealed class FakeAnnouncer : IGameAnnouncer
	{
		public List<Announced> Sent { get; } = new();

		public Task ToAll(string key, Dictionary<string, object>? vars = null, AnnouncementPhase phase = AnnouncementPhase.Resolve)
		{
			Sent.Add(new Announced(AnnouncementAudience.All, null, key, vars ?? new(), phase));
			return Task.CompletedTask;
		}

		public Task ToPlayer(string playerId, string key, Dictionary<string, object>? vars = null, AnnouncementPhase phase = AnnouncementPhase.Resolve)
		{
			Sent.Add(new Announced(AnnouncementAudience.Player, playerId, key, vars ?? new(), phase));
			return Task.CompletedTask;
		}

		public Task ToAllExcept(string playerId, string key, Dictionary<string, object>? vars = null, AnnouncementPhase phase = AnnouncementPhase.Resolve)
		{
			Sent.Add(new Announced(AnnouncementAudience.AllExcept, playerId, key, vars ?? new(), phase));
			return Task.CompletedTask;
		}

		/// <summary>True if any announcement matching the given audience/player/key was sent.</summary>
		public bool Has(AnnouncementAudience audience, string? playerId, string key)
			=> Sent.Any(a => a.Audience == audience && a.PlayerId == playerId && a.Key == key);
	}

	/// <summary>A single recorded announcement.</summary>
	public sealed record Announced(AnnouncementAudience Audience, string? PlayerId, string Key, Dictionary<string, object> Vars, AnnouncementPhase Phase = AnnouncementPhase.Resolve);

	/// <summary>
	/// Presenter test double that records every client-facing notification so tests can
	/// assert on state refreshes, square repaints and card reveals. An optional callback
	/// lets a test react to a card reveal (kept for back-compat with NewContext).
	/// </summary>
	public sealed class CapturingPresenter : IGamePresenter
	{
		private readonly Func<CardDrawnNotification, Task>? _onCardDrawn;

		public CapturingPresenter(Func<CardDrawnNotification, Task>? onCardDrawn = null) => _onCardDrawn = onCardDrawn;

		public int StateChangeCount { get; private set; }
		public int CheckpointCount { get; private set; }
		public List<Square> SquareChanges { get; } = new();
		public List<CardDrawnNotification> CardsDrawn { get; } = new();

		public Task NotifyStateChangedAsync()
		{
			StateChangeCount++;
			return Task.CompletedTask;
		}

		public Task CheckpointTurnSegmentAsync()
		{
			// A checkpoint flushes a segment and pushes the current state, so it counts as a
			// state change too — mirroring the live GameService.
			CheckpointCount++;
			StateChangeCount++;
			return Task.CompletedTask;
		}

		public Task NotifySquareChangedAsync(Square square)
		{
			SquareChanges.Add(square);
			return Task.CompletedTask;
		}

		public Task NotifyCardDrawnAsync(CardDrawnNotification notification)
		{
			CardsDrawn.Add(notification);
			return _onCardDrawn?.Invoke(notification) ?? Task.CompletedTask;
		}
	}

	public static Player NewPlayer(string id, int money = 1500, int position = 0, string token = "disc")
		=> new() { Id = id, Name = id, Token = token, Money = money, Position = position };

	/// <summary>Creates a minimal game state with the given players and bank balance.</summary>
	public static GameState NewState(IEnumerable<Player> players, int bankMoney = 10000, List<Square>? squares = null)
		=> new()
		{
			Players = players.ToList(),
			Bank = new BankInfo { Money = bankMoney },
			CurrentTurn = players.FirstOrDefault()?.Id,
			Squares = squares ?? new List<Square>()
		};

	/// <summary>Builds a GameContext over the given state with inert announce/notify callbacks.</summary>
	public static GameContext NewContext(
		GameState state,
		GameSettings? settings = null,
		Func<Player, int, GameContext, Task>? processLanding = null,
		Func<CardDrawnNotification, Task>? notifyCardDrawn = null,
		CorroServer.Models.Corro.RulesConfig? rentRules = null,
		CorroServer.Models.Corro.RaceBoardDef? raceBoard = null,
		CorroServer.Models.Corro.RaceRulesConfig? raceRules = null,
		CorroServer.Models.Corro.TrackBoardDef? trackBoard = null,
		CorroServer.Models.Corro.TrackRulesConfig? trackRules = null,
		CorroServer.Models.Corro.TriviaBoardDef? triviaBoard = null,
		CorroServer.Models.Corro.TriviaRulesConfig? triviaRules = null)
	{
		var helper = new GameStateHelper(state);
		var announcer = new FakeAnnouncer();
		return new GameContext
		{
			GameState = state,
			Helper = helper,
			Settings = settings ?? new GameSettings(),
			RentRules = rentRules ?? CorroServer.Models.Corro.RulesConfig.ClassicRules,
			// Same shape the families publish at game start: board + rules (rules defaulted).
			FamilyRuntime =
				raceBoard is not null
					? new CorroServer.Services.Corro.Families.RaceRuntime(raceBoard, raceRules ?? new CorroServer.Models.Corro.RaceRulesConfig())
				: trackBoard is not null
					? new CorroServer.Services.Corro.Families.TrackRuntime(trackBoard, trackRules ?? new CorroServer.Models.Corro.TrackRulesConfig())
				: triviaBoard is not null
					? new CorroServer.Services.Corro.Families.TriviaRuntime(triviaBoard, triviaRules ?? new CorroServer.Models.Corro.TriviaRulesConfig())
				: null,
			// Same personalization convention the server uses (actorId -> _self).
			Announce = (key, vars) => announcer.Announce(key, vars),
			Announcer = announcer,
			Presenter = new CapturingPresenter(notifyCardDrawn),
			ProcessLanding = processLanding
		};
	}

	/// <summary>Returns the recording announcer behind a context built by <see cref="NewContext"/>.</summary>
	public static FakeAnnouncer Announcer(GameContext context) => (FakeAnnouncer)context.Announcer;

	/// <summary>Returns the recording presenter behind a context built by <see cref="NewContext"/>.</summary>
	public static CapturingPresenter Presenter(GameContext context) => (CapturingPresenter)context.Presenter;

	/// <summary>Total money held by all players plus the bank. Should be invariant for closed transfers.</summary>
	public static int TotalMoney(GameState state)
		=> state.Players.Sum(p => p.Money) + state.Bank.Money;

	/// <summary>
	/// A full standard-size board with railroads at 5/15/25/35 and utilities at
	/// 12/28; every other square is a generic property. Used by tests that resolve
	/// squares from the live board layout instead of hardcoded indices.
	/// </summary>
	public static List<Square> StandardBoard()
	{
		var railroads = new HashSet<int> { 5, 15, 25, 35 };
		var utilities = new HashSet<int> { 12, 28 };
		var squares = new List<Square>(GameConstants.TotalSquares);
		for (int i = 0; i < GameConstants.TotalSquares; i++)
		{
			var type = railroads.Contains(i) ? "railroad"
				: utilities.Contains(i) ? "utility"
				: "property";
			squares.Add(new Square { Id = i, Name = $"Square {i}", Type = type });
		}
		return squares;
	}
}
