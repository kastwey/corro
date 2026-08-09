using System.Globalization;
using System.Text;

namespace CorroServer.Services.Rules;

/// <summary>
/// How the engine compares two pieces of player- or package-written text when it must decide
/// whether they are "the same word": the forbidden family checking a deck for duplicate targets,
/// the categories family gathering identical answers and testing them against the round's letter.
///
/// The comparison is deliberately generous about typing and strict about letters. Case, accents,
/// punctuation and repeated spaces are noise a player should never lose a point over. Ñ is NOT:
/// in Spanish it is its own letter, it can BE the round's letter, and folding it into N would
/// both mis-match the letter check and offer "nu" and "ñu" as the same answer.
/// </summary>
public static class AnswerText
{
	// Ñ/ñ survive the diacritic strip by stepping out of the decomposition and back in after it.
	// U+E000 is a private-use code point: it can never occur in real text, so it cannot collide.
	private const char EnyeLower = '\uE000';
	private const char EnyeUpper = '\uE001';

	/// <summary>Lower-case, accent-free (except Ñ), punctuation-free, single-spaced text. Empty
	/// for null, blank or punctuation-only input — callers treat that as "no answer".</summary>
	public static string Normalize(string? value)
	{
		var guarded = (value ?? string.Empty).Trim()
			.Replace('ñ', EnyeLower)
			.Replace('Ñ', EnyeUpper);
		var decomposed = guarded.ToLowerInvariant().Normalize(NormalizationForm.FormD);
		var builder = new StringBuilder(decomposed.Length);
		foreach (var character in decomposed)
		{
			if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
			{
				continue;
			}
			if (character is EnyeLower or EnyeUpper)
			{
				builder.Append('ñ');
			}
			else if (char.IsLetterOrDigit(character))
			{
				builder.Append(character);
			}
			else if (char.IsWhiteSpace(character))
			{
				builder.Append(' ');
			}
		}
		return string.Join(' ', builder.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
	}

	/// <summary>Whether an answer begins with the round's letter. Comparing NORMALIZED forms on
	/// both sides means "Álvaro" answers A and "ñu" answers Ñ, and it also lets a package declare
	/// a digraph (Spanish "CH", "LL") as one letter without any special case here.</summary>
	public static bool StartsWithLetter(string? value, string? letter)
	{
		var normalizedLetter = Normalize(letter);
		if (normalizedLetter.Length == 0)
		{
			return false;
		}
		var normalized = Normalize(value);
		return normalized.Length > 0 && normalized.StartsWith(normalizedLetter, StringComparison.Ordinal);
	}
}
