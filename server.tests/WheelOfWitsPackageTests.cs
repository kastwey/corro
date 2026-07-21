using System.Linq;
using System.Threading.Tasks;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Pins the shipped "The Wheel of Wits" trivia package: the wheel shape, the CC0 question
/// deck covering every category in both locales, and structural + content validation. Loading
/// the package already runs the family's structural validation, so this also guards the board.
/// </summary>
public class WheelOfWitsPackageTests
{
	private static readonly Task<GameDefinition> Loaded =
		new CorroPackageLoader().LoadAsync(CorroTestPaths.PackageDir("wheel-of-wits"));

	[Fact]
	public async Task The_wheel_has_six_wedges_one_per_category()
	{
		var def = await Loaded;
		var board = def.TriviaBoard!;
		Assert.Equal(3, board.SpokeLength);
		Assert.Equal(6, board.Ring.Count(s => s.Wedge));
		Assert.Equal(new[] { 0, 1, 2, 3, 4, 5 },
			board.Ring.Where(s => s.Wedge).Select(s => s.Category).OrderBy(c => c).ToArray());
	}

	[Fact]
	public async Task Both_locales_cover_every_category()
	{
		var def = await Loaded;
		Assert.Equal(2, def.TriviaQuestions!.Count);
		foreach (var (_, qs) in def.TriviaQuestions)
		{
			for (var c = 0; c < TriviaCategories.Count; c++)
			{
				Assert.Contains(qs, q => q.Category == c);
			}
		}
	}

	[Fact]
	public async Task The_package_passes_structural_and_content_validation()
	{
		var def = await Loaded;
		Assert.Empty(new PackageValidator().Validate(def));
	}

	[Fact]
	public async Task The_rules_players_and_tokens_ship_as_configured()
	{
		var def = await Loaded;
		var rules = def.Manifest.TriviaRules!;
		Assert.Equal("judge", rules.AnswerMode);
		Assert.Equal("rotating", rules.JudgeMode);
		Assert.True(rules.ExactFinish);
		Assert.True(rules.CenterWild);

		Assert.Equal(2, def.Manifest.Players.Min);
		Assert.Equal(6, def.Manifest.Players.Max);
		Assert.Equal(6, def.Manifest.Tokens.Count);
		Assert.All(def.Manifest.Tokens, t => Assert.False(string.IsNullOrEmpty(t.Svg)));
	}
}
