using System.Text.Json;
using CorroServer.Controllers;
using CorroServer.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The board keymap is owned by the server (single source of truth): served to the client and used to
/// derive the engine-reserved shortcut letters for package validation. These pin both uses.
/// </summary>
public class EngineKeymapTests
{
	[Fact]
	public void Json_is_the_valid_embedded_keymap()
	{
		using var doc = JsonDocument.Parse(EngineKeymap.Json);
		// A couple of stable bindings prove it's the real keymap.
		Assert.Equal("RollDice", doc.RootElement.GetProperty("space").GetString());
		// C is the per-family "how am I doing?" key (money / squadron / piece colour).
		Assert.Equal("AnnounceMyStatus", doc.RootElement.GetProperty("c").GetString());
	}

	[Fact]
	public void Reserved_letters_are_derived_from_the_bare_single_letter_bindings()
	{
		var reserved = EngineKeymap.ReservedLetters;

		// Engine letters are reserved (a package group key can't steal them).
		Assert.Contains("c", reserved); // cash
		Assert.Contains("m", reserved); // go to me
		Assert.Contains("i", reserved); // who is on square

		// Colour letters — and s/k, freed when station/utility navigation moved to per-group keys —
		// are available for package group keys, so they must NOT be reserved.
		foreach (var freed in new[] { "b", "p", "l", "o", "r", "y", "g", "d", "s", "k" })
		{
			Assert.DoesNotContain(freed, reserved);
		}

		// Modifier combos and multi-char specs are not single-letter reservations.
		Assert.DoesNotContain("space", reserved);
		Assert.DoesNotContain("enter", reserved);
	}

	[Fact]
	public void A_race_family_binding_keeps_its_letter_free_for_property_group_keys()
	{
		// "s" is BOTH the race landmark cycle (engine keymap, family:"race") and the
		// stations group key of every shipped property package. The race-scoped binding
		// must exist for the client — and must NOT reserve the letter, or those packages
		// would fail validation.
		using var doc = JsonDocument.Parse(EngineKeymap.Json);
		var s = doc.RootElement.GetProperty("s");
		Assert.Equal("GoToMyStart", s.GetProperty("cmd").GetString());
		Assert.Equal("race", s.GetProperty("family").GetString());
		Assert.DoesNotContain("s", EngineKeymap.ReservedLetters);

		// An OBJECT binding without a family tag still reserves its letter (m = go to me).
		Assert.Equal("GoToMe", doc.RootElement.GetProperty("m").GetProperty("cmd").GetString());
		Assert.Contains("m", EngineKeymap.ReservedLetters);
	}

	[Fact]
	public void ConfigController_serves_the_keymap_json()
	{
		var result = new ConfigController(NullLogger<ConfigController>.Instance).GetKeymap();

		Assert.Equal("application/json", result.ContentType);
		Assert.Equal(EngineKeymap.Json, result.Content);
	}
}
