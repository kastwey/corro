using System.Xml.Linq;
using CorroServer.Services.Corro;

namespace CorroServer.Tests;

/// <summary>
/// Package art is uploaded content that the client inlines with innerHTML, so the sanitiser is an
/// allowlist with re-serialisation: these tests pin what survives (the drawing subset, colours,
/// strokes, groups, transforms, CSS declarations the editors emit), what is dropped silently
/// (editor metadata) and what rejects the package (scripts, references, text, unknown elements).
/// </summary>
public class SvgArtSanitizerTests
{
	private static string Card(string inner, string viewBox = "0 0 64 64")
		=> SvgArtSanitizer.Sanitize(XElement.Parse($"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{viewBox}\">{inner}</svg>"), SvgArtSanitizer.Profile.Card, "assets/cards/x.svg");

	private static string Token(string inner, string? viewBox = "0 0 24 24")
	{
		var attr = viewBox is null ? "" : $" viewBox=\"{viewBox}\"";
		return SvgArtSanitizer.Sanitize(XElement.Parse($"<svg{attr}>{inner}</svg>"), SvgArtSanitizer.Profile.Token, "assets/tokens/x.svg");
	}

	[Fact]
	public void Keeps_the_drawing_subset_with_colours_strokes_groups_and_transforms()
	{
		var inner = "<g transform=\"translate(2, 3) rotate(45 32 32)\" opacity=\"0.9\">"
			+ "<path d=\"M1 1h62v62z\" fill=\"#B33434\" stroke=\"#fff\" stroke-width=\"2\" stroke-linejoin=\"round\"/>"
			+ "<circle cx=\"32\" cy=\"32\" r=\"10\" fill=\"currentColor\" fill-opacity=\".5\"/>"
			+ "<rect x=\"4\" y=\"4\" width=\"20px\" height=\"10\" rx=\"3\" fill=\"none\" stroke=\"#1769AA\" stroke-dasharray=\"4, 2\"/>"
			+ "<ellipse cx=\"40\" cy=\"40\" rx=\"5\" ry=\"3\" stroke-linecap=\"ROUND\"/>"
			+ "<line x1=\"0\" y1=\"0\" x2=\"64\" y2=\"64\" stroke=\"#000\" stroke-width=\"1.5\"/>"
			+ "<polyline points=\"0,0 10,10 20,0\" fill=\"none\" stroke=\"#000\"/>"
			+ "<polygon points=\"0 0, 10 10, 20 0\" fill-rule=\"evenodd\"/>"
			+ "</g>";
		var result = Card(inner);
		Assert.Equal(
			"<g opacity=\"0.9\" transform=\"translate(2 3) rotate(45 32 32)\">"
			+ "<path d=\"M1 1h62v62z\" fill=\"#b33434\" stroke=\"#fff\" stroke-width=\"2\" stroke-linejoin=\"round\"/>"
			+ "<circle cx=\"32\" cy=\"32\" r=\"10\" fill=\"currentColor\" fill-opacity=\".5\"/>"
			+ "<rect x=\"4\" y=\"4\" width=\"20\" height=\"10\" rx=\"3\" fill=\"none\" stroke=\"#1769aa\" stroke-dasharray=\"4 2\"/>"
			+ "<ellipse cx=\"40\" cy=\"40\" rx=\"5\" ry=\"3\" stroke-linecap=\"round\"/>"
			+ "<line x1=\"0\" y1=\"0\" x2=\"64\" y2=\"64\" stroke=\"#000\" stroke-width=\"1.5\"/>"
			+ "<polyline points=\"0,0 10,10 20,0\" fill=\"none\" stroke=\"#000\"/>"
			+ "<polygon points=\"0,0 10,10 20,0\" fill-rule=\"evenodd\"/>"
			+ "</g>",
			result);
	}

	[Fact]
	public void Drops_editor_metadata_but_keeps_presentation_declared_in_style()
	{
		var inner = "<sodipodi:namedview xmlns:sodipodi=\"http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd\" id=\"base\"/>"
			+ "<title>Heart</title><desc>drawn in Inkscape</desc><metadata><x/></metadata>"
			+ "<path id=\"path1\" class=\"st0\" inkscape:label=\"heart\" xmlns:inkscape=\"http://www.inkscape.org/namespaces/inkscape\""
			+ " d=\"M1 1h62v62z\" style=\"fill:#ff0000;stroke:#000000;stroke-width:1.2px;display:inline;fill-opacity:1\"/>";
		Assert.Equal("<path d=\"M1 1h62v62z\" fill=\"#ff0000\" fill-opacity=\"1\" stroke=\"#000000\" stroke-width=\"1.2\"/>", Card(inner));
	}

	[Fact]
	public void A_real_attribute_wins_over_the_same_property_in_style()
	{
		Assert.Equal("<path d=\"M1 1h2v2z\" fill=\"#00ff00\"/>", Card("<path d=\"M1 1h2v2z\" fill=\"#00ff00\" style=\"fill:#ff0000\"/>"));
	}

	[Theory]
	[InlineData("<script>alert(1)</script>", "<script>")]
	[InlineData("<style>path{fill:red}</style>", "<style>")]
	[InlineData("<text x=\"1\" y=\"1\">hi</text>", "<text>")]
	[InlineData("<image href=\"https://evil/x.png\"/>", "<image>")]
	[InlineData("<use href=\"#x\"/>", "<use>")]
	[InlineData("<use xlink:href=\"#x\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"/>", "<use>")]
	[InlineData("<foreignObject><div/></foreignObject>", "<foreignObject>")]
	[InlineData("<defs><linearGradient id=\"g\"/></defs>", "<defs>")]
	[InlineData("<a href=\"https://evil\"><path d=\"M1 1h2v2z\"/></a>", "<a>")]
	[InlineData("<g href=\"#x\"><path d=\"M1 1h2v2z\"/></g>", "href")]
	[InlineData("<g xlink:href=\"#x\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><path d=\"M1 1h2v2z\"/></g>", "href")]
	[InlineData("<animate attributeName=\"x\"/>", "<animate>")]
	[InlineData("<path d=\"M1 1h2v2z\" onload=\"alert(1)\"/>", "onload")]
	[InlineData("<path d=\"M1 1h2v2z\" onclick=\"alert(1)\"/>", "onclick")]
	[InlineData("<path d=\"M1 1h2v2z\" clip-path=\"url(#c)\"/>", "clip-path")]
	[InlineData("<path d=\"M1 1h2v2z\" mask=\"url(#m)\"/>", "mask")]
	[InlineData("<path d=\"M1 1h2v2z\" filter=\"url(#f)\"/>", "filter")]
	[InlineData("<path d=\"M1 1h2v2z\" marker-end=\"url(#m)\"/>", "marker-end")]
	[InlineData("<path d=\"M1 1h2v2z\" fill=\"url(#g)\"/>", "fill")]
	[InlineData("<path d=\"M1 1h2v2z\" fill=\"red\"/>", "fill")]
	[InlineData("<path d=\"M1 1h2v2z\" fill=\"#12345\"/>", "fill")]
	[InlineData("<path d=\"M1 1h2v2z\" style=\"fill:url(#g)\"/>", "style")]
	[InlineData("<path d=\"M1 1h2v2z\" stroke=\"javascript:alert(1)\"/>", "stroke")]
	[InlineData("<path d=\"M1 1h2v2z\" transform=\"translate(1) url(x)\"/>", "transform")]
	[InlineData("<path d=\"M1 1h2v2z\" transform=\"matrix(1 2 3)\"/>", "transform")]
	[InlineData("<path d=\"M1 1h2v2z\" opacity=\"2\"/>", "opacity")]
	[InlineData("<path d=\"javascript:1\"/>", "d")]
	[InlineData("<path d=\"M1 1h2v2z\" stroke-linecap=\"inherit\"/>", "stroke-linecap")]
	[InlineData("<rect x=\"1\" y=\"1\" width=\"50%\" height=\"2\"/>", "width")]
	[InlineData("<polygon points=\"1,2 3\"/>", "points")]
	[InlineData("<circle cx=\"1\" cy=\"1\"/>", "'r'")]
	[InlineData("<path fill=\"#fff\"/>", "'d'")]
	public void Rejects_anything_outside_the_allowlist_naming_the_culprit(string inner, string culprit)
	{
		var error = Assert.Throws<InvalidOperationException>(() => Card(inner));
		Assert.Contains("assets/cards/x.svg", error.Message);
		Assert.Contains(culprit, error.Message);
	}

	[Fact]
	public void Nothing_from_the_input_text_is_echoed_outside_the_grammar()
	{
		// Every emitted attribute value comes from a validated token, so quotes and angle brackets can
		// never appear in the output even when XML lets them through as data.
		var result = Card("<path d=\"M1 1 h2 v2 z\" fill=\"#ABC\"/>");
		Assert.Equal("<path d=\"M1 1 h2 v2 z\" fill=\"#abc\"/>", result);
		Assert.DoesNotContain("ABC", result);
	}

	[Fact]
	public void Requires_a_drawing_and_the_card_canvas()
	{
		Assert.Contains("no drawing", Assert.Throws<InvalidOperationException>(() => Card("<title>empty</title>")).Message);
		Assert.Contains("no drawing", Assert.Throws<InvalidOperationException>(() => Card("<g><g/></g>")).Message);
		Assert.Contains("viewBox=\"0 0 64 64\"", Assert.Throws<InvalidOperationException>(() => Card("<path d=\"M1 1h2v2z\"/>", "0 0 24 24")).Message);
		var noViewBox = XElement.Parse("<svg><path d=\"M1 1h2v2z\"/></svg>");
		Assert.Contains("viewBox", Assert.Throws<InvalidOperationException>(() => SvgArtSanitizer.Sanitize(noViewBox, SvgArtSanitizer.Profile.Card, "c.svg")).Message);
	}

	[Fact]
	public void Rescales_a_token_drawn_on_another_square_canvas_onto_24()
	{
		Assert.Equal("<path d=\"M1 1h2v2z\"/>", Token("<path d=\"M1 1h2v2z\"/>"));
		Assert.Equal("<path d=\"M1 1h2v2z\"/>", Token("<path d=\"M1 1h2v2z\"/>", viewBox: null));
		Assert.Equal("<g transform=\"scale(0.375) translate(0 0)\"><path d=\"M1 1h2v2z\"/></g>", Token("<path d=\"M1 1h2v2z\"/>", "0 0 64 64"));
		Assert.Equal("<g transform=\"scale(1.5) translate(-4 -8)\"><circle r=\"1\"/></g>", Token("<circle r=\"1\"/>", "4 8 16 16"));
		Assert.Contains("square viewBox", Assert.Throws<InvalidOperationException>(() => Token("<path d=\"M1 1h2v2z\"/>", "0 0 24 32")).Message);
	}

	[Fact]
	public void Legacy_inline_path_data_becomes_the_one_path_it_stands_for()
	{
		Assert.Equal("<path d=\"M3 14 h18 a9 5 0 0 0 -18 0 z\"/>", SvgArtSanitizer.FromPathData("  M3 14 h18   a9 5 0 0 0 -18 0 z ", "token 'ufo'"));
		Assert.Contains("token 'ufo'", Assert.Throws<InvalidOperationException>(() => SvgArtSanitizer.FromPathData("M1 1\"/><script>", "token 'ufo'")).Message);
		Assert.Throws<InvalidOperationException>(() => SvgArtSanitizer.FromPathData("h10", "token 'ufo'"));
	}

	[Fact]
	public void Bounds_nesting_and_element_count()
	{
		var deep = string.Concat(Enumerable.Repeat("<g>", SvgArtSanitizer.MaxDepth + 1)) + "<path d=\"M1 1h2v2z\"/>" + string.Concat(Enumerable.Repeat("</g>", SvgArtSanitizer.MaxDepth + 1));
		Assert.Contains("deeper", Assert.Throws<InvalidOperationException>(() => Card(deep)).Message);
		var many = string.Concat(Enumerable.Repeat("<circle r=\"1\"/>", SvgArtSanitizer.MaxElements + 1));
		Assert.Contains("more than", Assert.Throws<InvalidOperationException>(() => Card(many)).Message);
	}

	[Fact]
	public void SanitizeFile_refuses_doctypes_and_external_entities()
	{
		var file = Path.Combine(Path.GetTempPath(), "corro_svg_" + Guid.NewGuid().ToString("N") + ".svg");
		File.WriteAllText(file, "<!DOCTYPE svg [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><svg viewBox=\"0 0 64 64\"><path d=\"M1 1h2v2z\"/>&x;</svg>");
		try
		{
			var error = Assert.Throws<InvalidOperationException>(
				() => SvgArtSanitizer.SanitizeFile(file, SvgArtSanitizer.Profile.Card, "assets/cards/x.svg", 1024 * 1024));
			Assert.Contains("not well-formed", error.Message);
		}
		finally
		{
			File.Delete(file);
		}
	}
}
