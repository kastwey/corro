using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using CorroServer.Services.Rules;
using CorroServer.Services.Sounds;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Pins the SHIPPED "La Mina" exploding deck (mining theme): the card composition, the
/// validations and the rules — and the E2E dealing contract. The identity shuffle deals the
/// deck's declaration order, so the two-player opening hands, the draw count and the first
/// draws are KNOWN. Reordering cards.json changes them (and would break e2e/tests/exploding.spec.ts).
/// </summary>
public class LaMinaPackageTests
{
	private static readonly Task<GameDefinition> Loaded =
		new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("la-mina"));

	[Fact]
	public async Task The_deck_has_the_mining_composition()
	{
		var def = await Loaded;
		var deck = def.ExplodingDeck!;

		Assert.Equal(56, deck.Sum(c => c.Count));
		Assert.Equal(4, deck.Where(c => c.Type == "bomb").Sum(c => c.Count));
		Assert.Equal(6, deck.Where(c => c.Type == "defuse").Sum(c => c.Count));
		Assert.Equal(4, deck.Where(c => c.Type == "skip").Sum(c => c.Count));
		Assert.Equal(4, deck.Where(c => c.Type == "attack").Sum(c => c.Count));
		Assert.Equal(5, deck.Where(c => c.Type == "seeFuture").Sum(c => c.Count));
		Assert.Equal(4, deck.Where(c => c.Type == "shuffle").Sum(c => c.Count));
		Assert.Equal(4, deck.Where(c => c.Type == "favor").Sum(c => c.Count));
		Assert.Equal(5, deck.Where(c => c.Type == "nope").Sum(c => c.Count));
		Assert.Equal(20, deck.Where(c => c.Type == "cat").Sum(c => c.Count));
	}

	[Fact]
	public async Task The_package_passes_structural_and_content_validation()
	{
		var def = await Loaded; // the loader already ran the family's structural validation
		Assert.Empty(new PackageValidator().Validate(def)); // incl. every card nameKey
	}

	[Fact]
	public async Task The_rules_ship_as_configured_defaults()
	{
		var def = await Loaded;
		var rules = def.Manifest.ExplodingRules!;

		Assert.Equal(7, rules.HandSize);
		Assert.Equal(1, rules.DefusesPerPlayer);
		Assert.Equal(3, rules.SeeFutureCount);
		Assert.Equal(2, rules.AttackDraws);
		Assert.Equal(1000, rules.NopeWindowMillis);

		Assert.Equal(5, def.Manifest.Tokens.Count);
		Assert.All(def.Manifest.Tokens, t => Assert.False(string.IsNullOrEmpty(t.Svg)));
		Assert.Equal(2, def.Manifest.Players.Min);
		Assert.Equal(5, def.Manifest.Players.Max);
		Assert.Empty(def.Manifest.HouseRules); // the exploding family exposes none yet
	}

	[Fact]
	public async Task The_identity_shuffle_two_player_deal_is_the_known_E2E_contract()
	{
		var def = await Loaded;
		var state = ExplodingRulebook.CreateInitialState(
			new[] { "ana", "berto" }, def.ExplodingDeck!, def.Manifest.ExplodingRules!,
			new ScriptedRandomSource());

		// Each hand: a guaranteed defuse (dealt first) + 7 others, round-robin from the tail —
		// seat 0 takes the even copies, seat 1 the odd, exactly like the shedding contract.
		Assert.Equal(
			new[]
			{
				"cortar-mecha#0", "salir-pozo#0", "salir-pozo#2",
				"derrumbe#0", "derrumbe#2", "canario#0", "canario#2", "canario#4",
			},
			state.Seats[0].Hand.Select(c => c.InstanceId));
		Assert.Equal(
			new[]
			{
				"cortar-mecha#1", "salir-pozo#1", "salir-pozo#3",
				"derrumbe#1", "derrumbe#3", "canario#1", "canario#3", "revuelto#0",
			},
			state.Seats[1].Hand.Select(c => c.InstanceId));

		// No bomb reaches a hand; exactly one (players − 1) is planted, and — inherent to the
		// deal — it sits on TOP, so ana's first draw is the bomb (she holds a defuse for it).
		Assert.All(state.Seats, s => Assert.DoesNotContain(s.Hand, c => c.CardId == "grisu"));
		Assert.Equal(37, state.DrawCount);
		Assert.Equal("grisu#0", state.DrawPile[^1].InstanceId);     // drawn next
		Assert.Equal("cortar-mecha#5", state.DrawPile[^2].InstanceId);
	}

	[Fact]
	public void The_sound_pack_maps_the_exploding_earcons_to_shipped_ogg_files()
	{
		var soundsDir = System.IO.Path.Combine(CorroTestPaths.PackageDir("la-mina"), "sounds");
		var events = new DefaultSoundPackProvider(soundsDir).ResolveEvents(null);

		// The eight bomb-specific earcons — including the boom. Reshuffling and PLAYING a card
		// are NOT among them: reshuffle reuses cards.shuffle, and a play lands on the discard
		// pile so it reuses the shared card.discard cue.
		Assert.Equal("exploding-boom.ogg", events["exploding.boom"][0]);
		Assert.Equal(8, events.Keys.Count(k => k.StartsWith("exploding.")));
		Assert.False(events.ContainsKey("exploding.shuffle"), "reshuffle uses the shared cue");
		Assert.False(events.ContainsKey("exploding.played"), "a play reuses the shared card.discard cue");
		Assert.Equal("shuffle.ogg", events["cards.shuffle"][0]);   // the shared generics
		Assert.Equal("draw.ogg", events["card.draw"][0]);
		Assert.Equal("discard.ogg", events["card.discard"][0]);

		// Every file the pack references actually ships in the package.
		foreach (var (_, files) in events)
		{
			foreach (var file in files)
			{
				Assert.True(System.IO.File.Exists(System.IO.Path.Combine(soundsDir, file)),
					$"missing sound file: {file}");
			}
		}
	}
}
