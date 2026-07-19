using CorroServer.Services;

namespace CorroServer.Tests;

public class LobbyInputTests
{
	[Theory]
	[InlineData(" Alice ", "Alice")]
	[InlineData("Éowyn", "Éowyn")]
	public void Player_name_is_trimmed_without_restricting_languages(string input, string expected)
	{
		Assert.True(LobbyInput.TryNormalizePlayerName(input, out var normalized));
		Assert.Equal(expected, normalized);
	}

	[Theory]
	[InlineData(null)]
	[InlineData("")]
	[InlineData("   ")]
	[InlineData("Alice\nAdmin")]
	public void Player_name_rejects_empty_and_control_character_values(string? input)
		=> Assert.False(LobbyInput.TryNormalizePlayerName(input, out _));

	[Fact]
	public void Player_name_rejects_values_over_the_limit()
		=> Assert.False(LobbyInput.TryNormalizePlayerName(
			new string('a', LobbyInput.MaxPlayerNameLength + 1), out _));

	[Fact]
	public void Identifiers_are_bounded_and_optional_values_may_be_absent()
	{
		Assert.True(LobbyInput.IsIdentifier("token-1"));
		Assert.True(LobbyInput.IsIdentifier(null, optional: true));
		Assert.False(LobbyInput.IsIdentifier(null));
		Assert.False(LobbyInput.IsIdentifier("", optional: true));
		Assert.False(LobbyInput.IsIdentifier("has spaces"));
		Assert.False(LobbyInput.IsIdentifier("bad\rvalue"));
		Assert.False(LobbyInput.IsIdentifier(new string('x', LobbyInput.MaxIdentifierLength + 1)));
	}

	[Theory]
	[InlineData(" Taller Galáctico ", "Taller Galáctico")]
	[InlineData("Race: North / South", "Race: North / South")]
	public void Display_names_allow_localized_human_readable_text(string input, string expected)
	{
		Assert.True(LobbyInput.TryNormalizeDisplayName(input, out var normalized));
		Assert.Equal(expected, normalized);
	}

	[Fact]
	public void Display_names_remain_bounded_and_reject_control_characters()
	{
		Assert.False(LobbyInput.TryNormalizeDisplayName("Board\nName", out _));
		Assert.False(LobbyInput.TryNormalizeDisplayName(
			new string('a', LobbyInput.MaxDisplayNameLength + 1), out _));
	}

	[Theory]
	[InlineData("es", "es")]
	[InlineData("ES-es", "es")]
	[InlineData("en-US", "en")]
	[InlineData("fr", "en")]
	[InlineData(null, "en")]
	public void Game_language_accepts_supported_primary_locales_and_falls_back_to_English(
		string? input,
		string expected)
		=> Assert.Equal(expected, LobbyInput.NormalizeLanguage(input));

	[Theory]
	[InlineData(1, false)]
	[InlineData(2, true)]
	[InlineData(16, true)]
	[InlineData(17, false)]
	public void Player_count_is_bounded(int count, bool expected)
		=> Assert.Equal(expected, LobbyInput.IsPlayerCount(count));
}
