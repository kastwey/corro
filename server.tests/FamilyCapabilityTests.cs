using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;

namespace CorroServer.Tests;

/// <summary>
/// The lobby used to decide two things by asking <c>gameType == "forbidden"</c> — in the hub, and
/// again in the browser, which additionally hardcoded "even tables only". Both are now capabilities
/// the family answers, so the lobby (server and client) asks the registry like every other family
/// dispatch and a new family declaring either needs no lobby change.
///
/// These tests pin the DEFAULTS as much as the override: a capability that silently turned itself
/// on for every family would quietly restrict boards that never asked for it.
/// </summary>
public class FamilyCapabilityTests
{
	private static GameDefinition ForbiddenWith(params string[] wordLocales)
		=> new()
		{
			Manifest = new Manifest { GameType = "forbidden", Locales = wordLocales.ToList() },
			ForbiddenWords = wordLocales.ToDictionary(
				locale => locale,
				_ => new List<ForbiddenWordDef>(),
				StringComparer.OrdinalIgnoreCase),
		};

	[Fact]
	public void Only_a_team_only_family_requires_a_team_count()
	{
		Assert.Equal(2, GameFamilies.For("forbidden").RequiredTeamCount);

		// Everyone else leaves team play to the host — including the families that CAN play in
		// teams (journey, race) but do not demand it.
		foreach (var gameType in new[] { "property", "race", "track", "journey", "assembly", "draft", "shedding", "exploding", "trivia" })
		{
			Assert.Null(GameFamilies.For(gameType).RequiredTeamCount);
		}
	}

	[Fact]
	public void Content_languages_are_the_decks_a_package_actually_ships()
	{
		var family = GameFamilies.For("forbidden");

		Assert.Equal(new[] { "en", "es" }, family.ContentLanguages(ForbiddenWith("en", "es")));
		// One deck is still a content language: creation must submit that sole valid deck rather
		// than silently borrowing whatever locale the host's interface happens to be in.
		Assert.Equal(new[] { "es" }, family.ContentLanguages(ForbiddenWith("es")));
	}

	[Fact]
	public void A_locale_the_manifest_lists_but_ships_no_words_for_is_not_a_choice()
	{
		// The package is translated into French (UI strings) but only carries English words.
		var definition = ForbiddenWith("en");
		definition = definition with { Manifest = definition.Manifest with { Locales = new() { "en", "fr" } } };

		Assert.Equal(new[] { "en" }, GameFamilies.For("forbidden").ContentLanguages(definition));
	}

	[Fact]
	public void A_family_whose_content_is_not_language_split_offers_no_choice()
	{
		// The default. A property or shedding board's cards are translated per player like the rest
		// of the UI, so there is no one deck for the table to agree on.
		foreach (var gameType in new[] { "property", "race", "track", "journey", "assembly", "draft", "shedding", "exploding" })
		{
			Assert.Empty(GameFamilies.For(gameType).ContentLanguages(new GameDefinition { Manifest = new Manifest() }));
		}
	}
}
