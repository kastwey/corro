using CorroServer.Models;
using CorroServer.Services.Commands;
using CorroServer.Services.Rules;

namespace CorroServer.Tests.Integration;

/// <summary>
/// A deterministic, in-memory integration harness for whole-turn scenarios.
///
/// It wires a real <see cref="CorroRulebook"/> (with a <see cref="ScriptedRandomSource"/>)
/// to a <see cref="GameContext"/> exactly the way <c>GameService</c> does — including
/// <c>ProcessLanding</c>, so card teleports re-trigger landing effects — but with no
/// SignalR or Cosmos. You stack the decks, script the dice, make a player roll, and then
/// assert against the resulting <see cref="GameState"/> and recorded announcements.
///
/// Build the board however the scenario needs: a generic <see cref="TestFixtures.StandardBoard"/>
/// or a hand-made <see cref="List{Square}"/> with owners, rent tables, chance squares, etc.
/// </summary>
internal sealed class GameHarness
{
	public GameState State { get; }
	public GameContext Context { get; }
	public CorroRulebook Rulebook { get; }
	public ScriptedRandomSource Random { get; } = new();

	/// <summary>Records every announcement the rules emit, for assertions.</summary>
	public TestFixtures.FakeAnnouncer Announcer => TestFixtures.Announcer(Context);

	public GameHarness(
		IEnumerable<Player> players,
		List<Square> squares,
		GameSettings? settings = null,
		int bankMoney = 10000,
		CorroServer.Models.Corro.RulesConfig? rentRules = null)
	{
		Rulebook = new CorroRulebook(randomSource: Random);
		State = TestFixtures.NewState(players, bankMoney, squares);
		Context = TestFixtures.NewContext(
			State,
			settings,
			rentRules: rentRules,
			// Mirror GameService: card effects that move a player ("go back 3 spaces",
			// "advance to nearest railroad") re-enter the landing pipeline through this.
			processLanding: (p, idx, ctx) => Rulebook.ProcessLandingEffectsAsync(p, idx, ctx));
	}

	public Player Player(string id) => State.Players.First(p => p.Id == id);

	/// <summary>
	/// Roll the two dice for the given player and resolve the whole turn:
	/// movement, landing effects, rent/debt, card draws and turn progression.
	/// </summary>
	public Task<DiceRollOutcome> RollAsync(string playerId, int die1, int die2)
	{
		Random.Enqueue(die1, die2);
		return Rulebook.ProcessDiceRollAsync(Player(playerId), Context);
	}

	/// <summary>Stack the Chance deck so the given card IDs are drawn from the top, in order. Cards are
	/// the classic deck expressed as the package fixture's generic cards (drawn via the package path).</summary>
	public void StackChanceDeck(params string[] cardIds) => StackPackageDeck("chance", cardIds);

	/// <summary>Stack the Treasury deck so the given card IDs are drawn from the top, in order.</summary>
	public void StackCommunityDeck(params string[] cardIds) => StackPackageDeck("community", cardIds);

	private void StackPackageDeck(string deckId, string[] cardIds)
	{
		// Seeding PackageCards routes draws through the generic package path (the only one now).
		State.PackageCards ??= ClassicPackageDeck.Value;
		State.PackageDecks[deckId] = StackedDeck(cardIds);
	}

	private static CardDeck StackedDeck(IEnumerable<string> cardIds)
		=> new() { Cards = cardIds.ToList(), HeldCards = new List<string>(), IsInitialized = true };

	/// <summary>The classic board's deck as generic package cards (from the corro-classic fixture).</summary>
	private static readonly Lazy<List<CorroServer.Models.Corro.CardDef>> ClassicPackageDeck = new(() =>
		new CorroServer.Services.Corro.CorroPackageLoader()
			.LoadAsync(CorroTestPaths.FixtureDir("corro-classic")).GetAwaiter().GetResult().Cards);
}
