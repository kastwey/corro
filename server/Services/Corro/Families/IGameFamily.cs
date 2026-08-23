using System.Text.Json;
using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Commands;

namespace CorroServer.Services.Corro.Families;

/// <summary>
/// One game family (a board topology + rules dialect: property, race, track…). The registry
/// (<see cref="GameFamilies"/>) is the only place families are enumerated — the package loader,
/// the content validator, game start/restore and the dice dispatch all ask it — so adding a
/// family means writing one class and registering it, not touching those call sites.
/// </summary>
public interface IGameFamily
{
	/// <summary>The manifest/state gameType this family implements (e.g. "race").</summary>
	string GameType { get; }

	/// <summary>Read the family's board.json shape (and cards, when the family has decks) into a definition.</summary>
	Task<GameDefinition> LoadDefinitionAsync(string packageDir, Manifest manifest,
		Dictionary<string, Dictionary<string, string>> i18n);

	/// <summary>Structural checks of the family's definition. Throws with a clear reason on the first problem.</summary>
	void ValidateDefinition(GameDefinition definition);

	/// <summary>Build the initial game: the state, the family runtime, and what the service should adopt.</summary>
	FamilyGame CreateGame(FamilyStartContext start);

	/// <summary>The family's runtime (board + rules) from freshly (re-)staged package files.</summary>
	IFamilyRuntime? CreateRuntime(GameDefinition definition);

	/// <summary>Runtime derived from the persisted snapshot. For most families the snapshot
	/// carries the board but not the rules (which then take the family defaults), so this is a
	/// fallback for a restored game whose package wasn't re-attached. A family whose snapshot
	/// DOES carry its effective rules says so via <see cref="SnapshotCarriesRules"/> and this
	/// becomes authoritative on restore.</summary>
	IFamilyRuntime? RuntimeFromState(GameState state);

	/// <summary>
	/// True when the persisted snapshot carries the family's FULL runtime inputs (deck/board +
	/// the EFFECTIVE rules, house-rule choices applied). Restoring then prefers
	/// <see cref="RuntimeFromState"/> over a runtime rebuilt from the re-staged package, whose
	/// manifest only knows the DEFAULTS the host may have overridden in the lobby.
	/// </summary>
	bool SnapshotCarriesRules => false;

	/// <summary>The family's own dice flow, or null when the shared property flow applies.
	/// <paramref name="rollSingleDie"/> is a thunk so families that never roll a single die
	/// don't consume randomness.</summary>
	Task<ServerResponse>? ProcessRoll(Func<int> rollSingleDie, Player player, GameContext context);

	/// <summary>
	/// The authoritative countdown this state is currently running, or null when nothing is
	/// timed. The session registry samples it on every state change and drives the one shared
	/// <see cref="IRoundClockService"/> from the answer, so a family with a clock never needs
	/// its own timer service, its own broadcast or its own branch in the hub.
	/// </summary>
	RoundClock? RoundClock(GameState state) => null;

	/// <summary>
	/// The server-issued command that resolves an expired <see cref="RoundClock"/>, or null when
	/// the family has no clock. It travels the ordinary command pipeline, so the rules and the
	/// spoken voice of a timeout live in a handler like every other outcome.
	/// </summary>
	GameCommand? ExpireRoundCommand(GameState state) => null;

	/// <summary>
	/// True when the family hides per-player information (hands, deck order…). State updates
	/// are then projected per player and sent per connection (see <see cref="GameStateFanout"/>)
	/// — never broadcast whole, which would hand every client the others' secrets.
	/// </summary>
	bool HasHiddenInformation => false;

	/// <summary>
	/// The view of the state <paramref name="playerId"/> is allowed to see. Identity by default
	/// (nothing hidden — the same instance goes out). A null playerId asks for the PUBLIC view
	/// (an unauthenticated connection, a document embedded in a lobby payload): only what every
	/// player may see. Persistence always stores the FULL state; projection is a wire concern.
	/// </summary>
	GameState ProjectFor(GameState state, string? playerId) => state;

	/// <summary>
	/// The languages this package's CONTENT is written in, when that content is language-split and
	/// the host must pick ONE deck for the whole table (forbidden's word decks, trivia's question
	/// decks). Empty — the default — means the family's content is not language-split at all, and
	/// the lobby simply offers no choice.
	///
	/// This is NOT the interface language: every player still reads and hears the UI in their own.
	/// It is the language of the words being guessed or the questions being asked, which the whole
	/// table necessarily shares. The lobby offers the picker whenever this returns more than one,
	/// so a family adopting language-split content needs no lobby change.
	/// </summary>
	IReadOnlyList<string> ContentLanguages(GameDefinition definition) => Array.Empty<string>();

	/// <summary>
	/// What this match took from its deck. The table remembers it (see
	/// <see cref="FamilyStartContext.AlreadyDealt"/>) so the next match on the same table deals
	/// what nobody has seen yet.
	///
	/// <see cref="MatchDeal.None"/> — the default — opts a family out entirely: no memory is kept
	/// and nothing changes. A family whose content is language-split keeps one memory per content
	/// language, because two decks share no cards.
	/// </summary>
	MatchDeal CardsDealt(GameState state) => MatchDeal.None;

	/// <summary>
	/// The number of teams this family REQUIRES the lobby to arrange, or null (the default) when
	/// team play is optional and the host picks. A family that answers N is only playable as N
	/// equal teams: the lobby rejects any other team count, and any table size that cannot split
	/// evenly into N. The forbidden family answers 2 — a clue-giver needs an opposing monitor, so
	/// a lone player or an odd table has no legal seating at all.
	///
	/// Lives here rather than as a gameType check in the hub, so the lobby asks the registry the
	/// same way every other family dispatch does.
	/// </summary>
	int? RequiredTeamCount => null;

	/// <summary>
	/// The spoken line when a player leaves the game for good (the "leave game"
	/// flow). Only the property family has an estate to forfeit — its override keeps the
	/// bankruptcy wording; everywhere else leaving is a plain retirement.
	/// </summary>
	string LeaveAnnouncementKey => "game.player_retired";

	/// <summary>
	/// A player just left the game (marked bankrupt/out by the shared leave flow) and the
	/// game CONTINUES for the others: the family folds their seat so play never stalls on
	/// them. The draft family needs this badly — a ghost seat that never picks would block
	/// every reveal forever. No-op by default (turn-based families already skip the fallen
	/// through <see cref="GameStateHelper.NextTurn"/>).
	/// </summary>
	Task OnPlayerRetiredAsync(Player player, GameContext context) => Task.CompletedTask;
}

/// <summary>
/// What one match took from its deck: the cards it actually DEALT, by package id — not the whole
/// deck it shuffled — and the size of the deck they came from.
///
/// The two travel together on purpose. The size is what tells the table it has been round the
/// entire deck and its memory should start a new cycle; a family that reported the cards and
/// forgot the size would saturate its memory and then reshuffle everything for every match after
/// that, which is the repetition the memory exists to stop. Answering one without the other is
/// not possible here.
/// </summary>
public readonly record struct MatchDeal(IReadOnlyList<string> CardIds, int DeckSize)
{
	/// <summary>A match that dealt nothing — and the answer of a family that keeps no memory.</summary>
	public static MatchDeal None => new(Array.Empty<string>(), 0);
}

/// <summary>Marker for the per-family runtime (board + rules) carried by
/// <see cref="GameContext.FamilyRuntime"/>. Each family defines its own record.</summary>
public interface IFamilyRuntime { }

/// <summary>A live authoritative countdown: when it started and how long it runs. The remaining
/// time is never stored — it is always recomputed from these two, so a reconnecting player, a
/// restored game and every other client agree on the same deadline.</summary>
public readonly record struct RoundClock(DateTime? StartedAt, int DurationSeconds);

/// <summary>Everything a family gets to build a new game.</summary>
public sealed record FamilyStartContext
{
	public required List<Player> Players { get; init; }
	public required GameDefinition Definition { get; init; }

	/// <summary>Language used to resolve server-side square names (property family).</summary>
	public string Lang { get; init; } = "en";

	/// <summary>The lobby's customized settings; null means the package's own defaults.</summary>
	public GameSettings? Settings { get; init; }

	/// <summary>Race-family lobby option: play 2v2 with opposite seats as partners.</summary>
	public bool RaceTeams { get; init; }

	/// <summary>Journey-family team seating (host-arranged in the lobby): each inner list is
	/// one team's members in turn order. Null/empty = individual play (one seat per player).</summary>
	public List<List<string>>? Teams { get; init; }

	/// <summary>The host's chosen house-rule values (catalog code → value), for families whose
	/// rules live OUTSIDE <see cref="GameSettings"/> (journey). Null/empty = package defaults.
	/// (The property family receives its rules pre-applied through <see cref="Settings"/>.)</summary>
	public Dictionary<string, JsonElement>? RuleValues { get; init; }

	/// <summary>The game's randomness source, for families that shuffle piles at start
	/// (journey decks). Null falls back to real randomness; the E2E environment's scripted
	/// source shuffles as the identity, keeping decks in cards.json order there.</summary>
	public Services.Rules.IRandomSource? Random { get; init; }

	/// <summary>
	/// Card ids this TABLE has already been dealt from this deck, across earlier matches. A family
	/// that shuffles a content deck deals the unseen ones first, so a group playing several matches
	/// in a row stops meeting the same cards. Empty for a table that has never played this deck.
	/// </summary>
	public IReadOnlyCollection<string> AlreadyDealt { get; init; } = Array.Empty<string>();
}

/// <summary>What a family hands back at game start. Null members keep the service defaults.</summary>
public sealed record FamilyGame
{
	public required GameState State { get; init; }

	/// <summary>The family's board + rules for command handlers; null for the property family,
	/// whose board and rent rules travel in first-class slots (GameState.Squares / RentRules).</summary>
	public IFamilyRuntime? Runtime { get; init; }

	/// <summary>Settings the service should adopt (property fills them from the package).</summary>
	public GameSettings? Settings { get; init; }

	/// <summary>Rent rules the service should adopt (property family only).</summary>
	public RulesConfig? RentRules { get; init; }

	/// <summary>Announcements after the shared "game started" line (e.g. race team pairings).
	/// Receives the service's announce function (key, vars).</summary>
	public Func<Func<string, Dictionary<string, object>?, Task>, Task>? PostStartAsync { get; init; }
}
