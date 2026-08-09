using CorroServer.Services.Rules;

namespace CorroServer.Tests;

public class AnswerTextTests
{
	[Theory]
	[InlineData("  Rose  ", "rose")]
	[InlineData("ROSE", "rose")]
	[InlineData("Álvaro", "alvaro")]
	[InlineData("l'été", "lete")]
	[InlineData("New   York", "new york")]
	[InlineData("¡Sí!", "si")]
	[InlineData("   ", "")]
	[InlineData("...", "")]
	[InlineData(null, "")]
	public void Normalize_forgives_case_accents_punctuation_and_spacing(string? input, string expected)
		=> Assert.Equal(expected, AnswerText.Normalize(input));

	[Fact]
	public void Enye_survives_normalization_because_it_is_a_letter_of_its_own()
	{
		// Folding ñ into n would offer "nu" and "ñu" as the same answer, and would answer the
		// letter Ñ with a word that does not start with it.
		Assert.Equal("ñu", AnswerText.Normalize("Ñu"));
		Assert.NotEqual(AnswerText.Normalize("nu"), AnswerText.Normalize("ñu"));
	}

	[Theory]
	[InlineData("rose", "R", true)]
	[InlineData("Álvaro", "A", true)]
	[InlineData("ñu", "Ñ", true)]
	[InlineData("ñu", "N", false)]
	[InlineData("nutria", "Ñ", false)]
	[InlineData("chocolate", "CH", true)]
	[InlineData("casa", "CH", false)]
	[InlineData("", "R", false)]
	[InlineData("rose", "", false)]
	[InlineData("rose", null, false)]
	public void StartsWithLetter_compares_normalized_forms_on_both_sides(
		string? answer,
		string? letter,
		bool expected)
		=> Assert.Equal(expected, AnswerText.StartsWithLetter(answer, letter));
}
