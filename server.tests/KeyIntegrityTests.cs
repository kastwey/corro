using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;

namespace CorroServer.Tests;

/// <summary>
/// Guards every shipped board against a regression where it references an i18n key that resolves in
/// NO locale — the bug class that leaks a raw key to the screen / the announcer (e.g. renaming
/// groups.utility but missing a usage, or a card pointing at a non-existent textKey). Partial
/// translations are fine (names fall back), so this only fails on a truly dangling key.
/// </summary>
public class KeyIntegrityTests
{
	public static IEnumerable<object[]> ShippedBoards()
	{
		   // Every board under server/Packages that ships with the engine (only imperio-galactico is
		// committed; the private espana boards are gitignored, so they're included when present).
		var root = CorroTestPaths.PackagesRoot();
		foreach (var dir in Directory.GetDirectories(root))
		{
			if (File.Exists(Path.Combine(dir, "manifest.json")))
			{
				yield return new object[] { Path.GetFileName(dir) };
			}
		}
	}

	private static readonly IPackageValidator Validator = new PackageValidator();

	[Theory]
	[MemberData(nameof(ShippedBoards))]
	public async Task Shipped_board_references_no_dangling_i18n_key(string boardId)
	{
		var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir(boardId));

		Assert.Empty(Validator.Validate(def)); // no key that resolves in no locale
	}

	[Fact]
	public void A_package_declaring_no_game_family_is_rejected()
	{
		// The .corro format anticipates several game families (property, race…); every
		// package must say which one it targets so the engine never loads it into the
		// wrong rules — and the error tells the author what this version supports.
		var def = new GameDefinition
		{
			Manifest = new Manifest { Locales = new() { "es" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			I18n = new() { ["es"] = new() },
		};

		var problem = Assert.Single(Validator.Validate(def), p => p.Contains("gameType"));
		Assert.Contains("property", problem); // the message lists the supported families
	}

	[Fact]
	public void A_package_from_an_unknown_game_family_is_rejected()
	{
		// e.g. a future family uploaded to an engine version that doesn't implement it yet.
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "deckbuilder", Locales = new() { "es" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			I18n = new() { ["es"] = new() },
		};

		var problem = Assert.Single(Validator.Validate(def), p => p.Contains("gameType"));
		Assert.Contains("deckbuilder", problem);
		Assert.Contains("property", problem);
	}

	[Fact]
	public void The_property_family_is_accepted_case_insensitively()
	{
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "Property", Locales = new() { "es" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			I18n = new() { ["es"] = new() },
		};

		Assert.DoesNotContain(Validator.Validate(def), p => p.Contains("gameType"));
	}

	[Fact]
	public void A_dangling_key_is_caught()
	{
		// A board referencing a square name key that exists in no locale must be flagged.
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "property", Locales = new() { "es", "en" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			Board = new() { new SquareDef { Id = 1, Type = "property", Group = "g1", NameKey = "squares.does_not_exist" } },
			I18n = new() { ["es"] = new() { ["squares.1"] = "Algo" }, ["en"] = new() { ["squares.1"] = "Something" } },
		};

		var problems = Validator.Validate(def);
		Assert.Contains(problems, p => p.Contains("squares.does_not_exist"));
	}

	[Fact]
	public void An_ownable_square_with_no_name_is_rejected()
	{
		// A property/transit/utility (or tax) square must name itself — it has no generic fallback,
		// so a missing nameKey would leave it blank on the board, in trades and as a bus destination.
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "property", Locales = new() { "es", "en" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			Board = new() { new SquareDef { Id = 7, Type = "property", Group = "g1" } }, // no NameKey
			I18n = new() { ["es"] = new(), ["en"] = new() },
		};

		Assert.Contains(Validator.Validate(def), p => p.Contains("square 7") && p.Contains("no name"));
	}

	[Fact]
	public void A_corner_or_card_square_without_a_name_is_allowed()
	{
		// Corners derive their name from the board terminology and card squares from their deck, so
		// an unnamed start/deck square must NOT be flagged (they have fallbacks; ownable squares don't).
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "property", Locales = new() { "es" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			Board = new()
			{
				new SquareDef { Id = 0, Type = "start" },
				new SquareDef { Id = 2, Type = "deck", Deck = "fortune" },
			},
			I18n = new() { ["es"] = new() },
		};

		Assert.DoesNotContain(Validator.Validate(def), p => p.Contains("no name"));
	}

	[Fact]
	public void A_board_with_no_tokens_is_rejected()
	{
		// Every board must ship its own player pieces — the engine has no built-in token set.
		var def = new GameDefinition { Manifest = new Manifest { GameType = "property", Locales = new() { "es" } } };

		Assert.Contains(Validator.Validate(def), p => p.Contains("no tokens"));
	}

	[Fact]
	public void A_partially_translated_key_is_allowed_to_fall_back()
	{
		// Present in es only (en falls back at runtime) — must NOT be flagged.
		var def = new GameDefinition
		{
			Manifest = new Manifest { GameType = "property", Locales = new() { "es", "en" }, Tokens = new() { new TokenDef { Id = "t", Svg = "M0 0z" } } },
			Board = new() { new SquareDef { Id = 1, Type = "property", Group = "g1", NameKey = "squares.1" } },
			I18n = new() { ["es"] = new() { ["squares.1"] = "Calle Mayor" }, ["en"] = new() },
		};

		Assert.Empty(Validator.Validate(def));
	}
}
