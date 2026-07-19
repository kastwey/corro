using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The CorroPackageLoader reads a .corro package (manifest + board + cards) into a validated
/// GameDefinition. These tests load the real shipped "Imperio Galáctico" package and pin the
/// validation rules, so a malformed board can never reach the game loop.
/// </summary>
public class CorroPackageLoaderTests
{
	[Fact]
	public async Task LoadAsync_reads_the_shipped_Galactic_package()
	{
			 var def = await new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("imperio-galactico"));

		// Identity + currency.
			 Assert.Equal("imperio-galactico", def.Manifest.Id);
		Assert.Equal("₡", def.Manifest.Currency.Symbol);
		Assert.Equal("IMPERIO", def.Manifest.CenterBrand);
		Assert.Equal("terminology.holding", def.Manifest.Terminology["holding"]);
		Assert.Equal("Agujero Negro", def.I18n["es"]["terminology.holding"]);

		// Structure: full 40-square board, 8 colour groups + transit + utility, two decks, 32 cards.
		Assert.Equal(40, def.Board.Count);
		Assert.Equal(10, def.Manifest.Groups.Count);
		Assert.Equal(2, def.Manifest.Decks.Count);
		Assert.Equal(32, def.Cards.Count);

		// A sample property carries its localized name, price, group and a rent table sized to the
		// board's building tiers (base + 5 colonies + 1 metropolis = 7 for the galactic board).
		var sq1 = def.Board.Single(s => s.Id == 1);
		Assert.Equal("property", sq1.Type);
		Assert.Equal("g1", sq1.Group);
		Assert.Equal("squares.1", sq1.NameKey);
		Assert.Equal("Mina Ferro", def.I18n["es"]["squares.1"]); // resolved from the package's own i18n
		Assert.Equal(60, sq1.Price);
		Assert.Equal(5, def.Manifest.Building.Levels);
		Assert.Equal(7, sq1.Rent!.Length); // base + 5 domes + 1 city

		// Rules carry the per-type rent strategy and the starting money.
		Assert.Equal(1500, def.Manifest.Rules.StartingMoney);
		Assert.Equal("ownedCountScale", def.Manifest.Rules.RentStrategies["transit"]);

		// Card targets coerce a JSON number to a string and keep relative targets as-is.
		Assert.Equal("0", def.Cards.Single(c => c.Id == "f1").Effect.Target);
		Assert.Equal("nearest:transit", def.Cards.Single(c => c.Id == "f3").Effect.Target);

		// Token icons live as files (tokens/<id>.svg); the loader inlines their sanitized path-data.
		var ufo = def.Manifest.Tokens.Single(t => t.Id == "ufo");
		Assert.False(string.IsNullOrEmpty(ufo.Svg));
		Assert.DoesNotContain('<', ufo.Svg!); // path-data only — no markup pulled from the file
	}

	[Fact]
	public async Task LoadAsync_rejects_a_square_referencing_an_undefined_group()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [{ "id": "g1" }], "decks": [{ "id": "d1" }] }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "property", "group": "ghost" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("undefined group", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_a_non_contiguous_board()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [], "decks": [] }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 2, "type": "freeparking" } ]""",
			cards: "[]");

		await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
	}

	[Fact]
	public async Task LoadAsync_rejects_an_unknown_card_effect()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [], "decks": [{ "id": "d1" }] }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: """[ { "id": "c1", "deck": "d1", "effect": { "type": "explode" } } ]""");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("unknown effect", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_building_houses_without_colour_groups()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [], "decks": [], "rules": { "rentStrategies": { "property": "buildingTable" } } }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("colour groups", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_an_unknown_house_rule()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [], "decks": [], "houseRules": [{ "id": "teleportRandomly" }] }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("not a known rule code", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_a_package_that_defines_too_few_tokens()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [], "decks": [], "tokens": [{ "id": "ship" }] }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("at least 2", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_a_board_that_is_not_the_ring_size()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [], "decks": [] }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("40 squares", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_a_group_shortcut_key_reserved_by_the_engine()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [{ "id": "g1", "key": "c" }], "decks": [] }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("reserved", ex.Message); // "c" = cash is the engine's
	}

	[Fact]
	public async Task LoadAsync_rejects_duplicate_group_shortcut_keys()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [{ "id": "g1", "key": "b" }, { "id": "g2", "key": "b" }], "decks": [] }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("unique", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_a_non_letter_group_shortcut_key()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [{ "id": "g1", "key": "1" }], "decks": [] }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("single letter", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_a_board_that_allows_fewer_than_two_players()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [], "decks": [], "players": { "min": 1, "max": 4 } }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("players.min", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_a_board_whose_max_players_is_below_its_min()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [], "decks": [], "players": { "min": 4, "max": 3 } }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("players.max", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_a_board_that_allows_more_than_eight_players()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [], "decks": [], "players": { "min": 2, "max": 9 } }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("at most 8", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_max_players_exceeding_the_packages_token_count()
	{
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [], "decks": [], "tokens": [{ "id": "a" }, { "id": "b" }], "players": { "min": 2, "max": 4 } }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "freeparking" } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("number of tokens", ex.Message);
	}

	[Fact]
	public async Task LoadAsync_rejects_a_property_rent_table_that_does_not_match_the_building_levels()
	{
		// building.levels = 5 needs base + 5 small + 1 big = 7 rent entries; a 6-entry table is rejected.
		var dir = WriteTempPackage(
			manifest: """{ "id": "t", "groups": [{ "id": "g1", "color": "red" }], "decks": [], "building": { "levels": 5 }, "rules": { "rentStrategies": { "property": "buildingTable" } } }""",
			board: """[ { "id": 0, "type": "start" }, { "id": 1, "type": "property", "group": "g1", "rent": [2, 10, 30, 90, 160, 250] } ]""",
			cards: "[]");

		var ex = await Assert.ThrowsAsync<InvalidOperationException>(
			() => new CorroPackageLoader().LoadAsync(dir));
		Assert.Contains("rent entries", ex.Message);
	}

	private static string WriteTempPackage(string manifest, string board, string cards)
	{
		var dir = Path.Combine(Path.GetTempPath(), "corro_test_" + Guid.NewGuid().ToString("N"));
		Directory.CreateDirectory(dir);
		File.WriteAllText(Path.Combine(dir, "manifest.json"), manifest);
		File.WriteAllText(Path.Combine(dir, "board.json"), board);
		File.WriteAllText(Path.Combine(dir, "cards.json"), cards);
		return dir;
	}
}
