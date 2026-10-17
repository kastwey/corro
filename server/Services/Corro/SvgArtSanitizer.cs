using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace CorroServer.Services.Corro;

/// <summary>
/// Reduces package SVG art (token icons and card illustrations) to a closed, re-serialised
/// subset that is safe to inline into the page with <c>innerHTML</c>.
///
/// Packages are uploaded content, so the input is hostile by definition. The approach is an
/// allowlist with re-serialisation, never a denylist: the XML is parsed with DTDs and external
/// resolution disabled, only a fixed set of drawing elements and attributes is accepted, every
/// attribute value must match a closed grammar (number, hex colour, keyword, transform list, path
/// data…) and the output is rebuilt from those validated values. Nothing from the input text is
/// echoed verbatim, so scripts, event handlers, external references, CSS, text, filters, masks and
/// everything else the grammar does not name cannot survive. Editor metadata (foreign namespaces,
/// <c>title</c>/<c>desc</c>, <c>id</c>/<c>class</c>) is dropped silently; anything that would
/// change the drawing if dropped (an unsupported element, a <c>clip-path</c>, a <c>url()</c>
/// reference) rejects the package with a message naming the offending part, so an author sees
/// why their file lost a feature instead of shipping a silently broken picture.
///
/// The client repeats the same grammar on the canonical output as a second barrier.
/// </summary>
public static class SvgArtSanitizer
{
	public enum Profile { Token, Card }

	/// <summary>Both canvases are fixed: tokens draw on 24×24 (other square viewBoxes are rescaled), cards on 64×64.</summary>
	public const int TokenCanvas = 24;
	public const int CardCanvas = 64;
	public const int MaxDepth = 12;
	public const int MaxElements = 4_000;

	private const string SvgNamespace = "http://www.w3.org/2000/svg";

	private static readonly HashSet<string> SkippedElements = new(StringComparer.Ordinal) { "title", "desc", "metadata" };
	private static readonly HashSet<string> DrawingElements = new(StringComparer.Ordinal)
		{ "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon" };

	/// <summary>Geometry attributes per element. Those marked required make the element draw at all.</summary>
	private static readonly Dictionary<string, (string Name, bool Required)[]> Geometry = new(StringComparer.Ordinal)
	{
		["g"] = [],
		["path"] = [("d", true)],
		["rect"] = [("x", false), ("y", false), ("width", true), ("height", true), ("rx", false), ("ry", false)],
		["circle"] = [("cx", false), ("cy", false), ("r", true)],
		["ellipse"] = [("cx", false), ("cy", false), ("rx", true), ("ry", true)],
		["line"] = [("x1", false), ("y1", false), ("x2", false), ("y2", false)],
		["polyline"] = [("points", true)],
		["polygon"] = [("points", true)],
	};

	/// <summary>Presentation attributes accepted on every drawing element (also as CSS declarations in <c>style</c>).</summary>
	private static readonly string[] Presentation =
	[
		"fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
		"stroke-miterlimit", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset", "opacity", "transform",
	];

	/// <summary>Attributes whose silent removal would change the picture or whose presence is an attack: reject.</summary>
	private static readonly HashSet<string> RejectedAttributes = new(StringComparer.Ordinal)
		{ "href", "clip-path", "mask", "filter", "marker-start", "marker-mid", "marker-end" };

	private static readonly Regex Number = new(@"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$", RegexOptions.CultureInvariant);
	private static readonly Regex Length = new(@"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:px)?$", RegexOptions.CultureInvariant);
	private static readonly Regex HexColor = new(@"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", RegexOptions.CultureInvariant);
	private static readonly Regex PathData = new(@"^[MmZzLlHhVvCcSsQqTtAa0-9.,+\-eE\s]+$", RegexOptions.CultureInvariant);
	private static readonly Regex NumberList = new(@"^[0-9.eE+\-\s,]+$", RegexOptions.CultureInvariant);
	private static readonly Regex TransformFunction = new(
		@"\G\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*([+\-0-9.eE\s,]*?)\s*\)\s*,?",
		RegexOptions.CultureInvariant);
	private static readonly Regex Whitespace = new(@"\s+", RegexOptions.CultureInvariant);
	private static readonly Regex ListSeparators = new(@"[\s,]+", RegexOptions.CultureInvariant);

	/// <summary>Parse and sanitise one SVG file. <paramref name="display"/> names it in error messages.</summary>
	public static string SanitizeFile(string file, Profile profile, string display, long maxCharacters)
	{
		var settings = new XmlReaderSettings
		{
			DtdProcessing = DtdProcessing.Prohibit,
			XmlResolver = null,
			MaxCharactersInDocument = maxCharacters,
		};
		XDocument document;
		try
		{
			using var reader = XmlReader.Create(file, settings);
			document = XDocument.Load(reader, LoadOptions.None);
		}
		catch (XmlException ex)
		{
			throw new InvalidOperationException($"SVG asset '{display}' is not well-formed XML: {ex.Message}");
		}
		return Sanitize(document.Root, profile, display);
	}

	/// <summary>Sanitise an already parsed SVG document root into canonical inner markup.</summary>
	public static string Sanitize(XElement? root, Profile profile, string display)
	{
		if (root is null || root.Name.LocalName != "svg")
		{
			throw new InvalidOperationException($"SVG asset '{display}' has no <svg> root.");
		}

		var viewBox = ReadViewBox(root, profile, display);
		var output = new StringBuilder();
		var count = new ElementCount();
		foreach (var child in root.Elements())
		{
			EmitElement(child, output, depth: 1, count, display);
		}
		if (count.Drawn == 0)
		{
			throw new InvalidOperationException($"SVG asset '{display}' contains no drawing (path, rect, circle, ellipse, line, polyline or polygon).");
		}

		// A token drawn on another square canvas is rescaled onto the 24×24 the client renders.
		if (viewBox is { } box && profile == Profile.Token
		    && (box.MinX != 0 || box.MinY != 0 || Math.Abs(box.Size - TokenCanvas) > 0.0001))
		{
			var scale = TokenCanvas / box.Size;
			var transform = $"scale({Fmt(scale)}) translate({Fmt(-box.MinX)} {Fmt(-box.MinY)})";
			return $"<g transform=\"{transform}\">{output}</g>";
		}
		return output.ToString();
	}

	/// <summary>
	/// Back-compat for a manifest token that carries inline path data instead of an asset file:
	/// the same path grammar, wrapped in the one element it stands for.
	/// </summary>
	public static string FromPathData(string pathData, string display)
	{
		var d = ValidatePathData(pathData, display, "d");
		return $"<path d=\"{d}\"/>";
	}

	private readonly record struct ViewBox(double MinX, double MinY, double Size);

	private static ViewBox? ReadViewBox(XElement root, Profile profile, string display)
	{
		var raw = root.Attributes().FirstOrDefault(a => a.Name.LocalName == "viewBox")?.Value;
		if (raw is null)
		{
			if (profile == Profile.Card)
			{
				throw new InvalidOperationException($"card illustration '{display}' must use viewBox=\"0 0 {CardCanvas} {CardCanvas}\".");
			}
			return null;
		}
		var parts = ListSeparators.Split(raw.Trim());
		if (parts.Length != 4 || !parts.All(p => Number.IsMatch(p)))
		{
			throw new InvalidOperationException($"SVG asset '{display}' has an invalid viewBox \"{Clip(raw)}\".");
		}
		var values = parts.Select(p => double.Parse(p, NumberStyles.Float, CultureInfo.InvariantCulture)).ToArray();
		if (profile == Profile.Card)
		{
			if (values[0] != 0 || values[1] != 0 || Math.Abs(values[2] - CardCanvas) > 0.0001 || Math.Abs(values[3] - CardCanvas) > 0.0001)
			{
				throw new InvalidOperationException($"card illustration '{display}' must use viewBox=\"0 0 {CardCanvas} {CardCanvas}\".");
			}
			return new ViewBox(0, 0, CardCanvas);
		}
		if (values[2] <= 0 || Math.Abs(values[2] - values[3]) > 0.0001)
		{
			throw new InvalidOperationException($"token icon '{display}' must use a square viewBox (for example \"0 0 {TokenCanvas} {TokenCanvas}\").");
		}
		return new ViewBox(values[0], values[1], values[2]);
	}

	private sealed class ElementCount
	{
		public int Total;
		public int Drawn;
	}

	private static void EmitElement(XElement element, StringBuilder output, int depth, ElementCount count, string display)
	{
		var ns = element.Name.NamespaceName;
		if (ns.Length != 0 && ns != SvgNamespace)
		{
			return; // editor metadata (inkscape:, sodipodi:, …) is not part of the drawing
		}
		var name = element.Name.LocalName;
		if (SkippedElements.Contains(name))
		{
			return;
		}
		if (!DrawingElements.Contains(name))
		{
			throw new InvalidOperationException(
				$"SVG asset '{display}' uses <{Clip(name)}>, which package art does not allow; only g, path, rect, circle, ellipse, line, polyline and polygon are drawn.");
		}
		if (depth > MaxDepth)
		{
			throw new InvalidOperationException($"SVG asset '{display}' nests groups deeper than {MaxDepth} levels.");
		}
		if (++count.Total > MaxElements)
		{
			throw new InvalidOperationException($"SVG asset '{display}' has more than {MaxElements} elements.");
		}
		if (name != "g")
		{
			count.Drawn++;
		}

		var attributes = CollectAttributes(element, name, display);
		output.Append('<').Append(name);
		foreach (var (attribute, value) in attributes)
		{
			output.Append(' ').Append(attribute).Append("=\"").Append(value).Append('"');
		}
		if (name == "g")
		{
			output.Append('>');
			foreach (var child in element.Elements())
			{
				EmitElement(child, output, depth + 1, count, display);
			}
			output.Append("</g>");
		}
		else
		{
			output.Append("/>");
		}
	}

	/// <summary>Validated (name, value) pairs in a fixed order: geometry first, then presentation.</summary>
	private static List<(string Name, string Value)> CollectAttributes(XElement element, string name, string display)
	{
		var raw = new Dictionary<string, string>(StringComparer.Ordinal);
		foreach (var attribute in element.Attributes())
		{
			var local = attribute.Name.LocalName;
			if (RejectedAttributes.Contains(local) || local.StartsWith("on", StringComparison.OrdinalIgnoreCase))
			{
				throw new InvalidOperationException(
					$"SVG asset '{display}' uses the attribute '{Clip(local)}' on <{name}>, which package art does not allow.");
			}
			if (attribute.IsNamespaceDeclaration || attribute.Name.NamespaceName.Length != 0)
			{
				continue; // xmlns, xml:space, inkscape:label… carry nothing the drawing needs
			}
			if (local == "style")
			{
				foreach (var (property, value) in ParseStyle(attribute.Value, display))
				{
					raw.TryAdd(property, value); // a real attribute wins over the CSS declaration
				}
				continue;
			}
			raw[local] = attribute.Value;
		}

		var result = new List<(string, string)>();
		foreach (var (attribute, required) in Geometry[name])
		{
			if (raw.TryGetValue(attribute, out var value))
			{
				result.Add((attribute, ValidateGeometry(attribute, value, display)));
			}
			else if (required)
			{
				throw new InvalidOperationException($"SVG asset '{display}' has a <{name}> without its '{attribute}' attribute.");
			}
		}
		foreach (var attribute in Presentation)
		{
			if (raw.TryGetValue(attribute, out var value))
			{
				result.Add((attribute, ValidatePresentation(attribute, value, display)));
			}
		}
		return result;
	}

	private static IEnumerable<(string Property, string Value)> ParseStyle(string style, string display)
	{
		if (style.Contains("url(", StringComparison.OrdinalIgnoreCase) || style.Contains("expression(", StringComparison.OrdinalIgnoreCase))
		{
			throw new InvalidOperationException($"SVG asset '{display}' references external content from a style attribute, which package art does not allow.");
		}
		foreach (var declaration in style.Split(';', StringSplitOptions.RemoveEmptyEntries))
		{
			var colon = declaration.IndexOf(':');
			if (colon <= 0)
			{
				continue;
			}
			var property = declaration[..colon].Trim();
			var value = declaration[(colon + 1)..].Trim();
			if (Presentation.Contains(property, StringComparer.Ordinal) && property != "transform")
			{
				yield return (property, value);
			}
		}
	}

	private static string ValidateGeometry(string attribute, string value, string display)
	{
		var v = value.Trim();
		switch (attribute)
		{
			case "d":
				return ValidatePathData(v, display, attribute);
			case "points":
			{
				var numbers = ListSeparators.Split(v).Where(p => p.Length > 0).ToArray();
				if (numbers.Length < 4 || numbers.Length % 2 != 0 || !numbers.All(n => Number.IsMatch(n)))
				{
					throw Invalid(display, attribute, value);
				}
				return string.Join(' ', numbers.Chunk(2).Select(pair => pair[0] + "," + pair[1]));
			}
			default:
				if (!Length.IsMatch(v))
				{
					throw Invalid(display, attribute, value);
				}
				return v.EndsWith("px", StringComparison.Ordinal) ? v[..^2] : v;
		}
	}

	private static string ValidatePathData(string value, string display, string attribute)
	{
		var v = Whitespace.Replace(value.Trim(), " ");
		if (v.Length == 0 || !PathData.IsMatch(v) || (v[0] != 'M' && v[0] != 'm') || !v.Any(char.IsDigit))
		{
			throw Invalid(display, attribute, value);
		}
		return v;
	}

	private static string ValidatePresentation(string attribute, string value, string display)
	{
		var v = value.Trim();
		switch (attribute)
		{
			case "fill":
			case "stroke":
				if (v == "none" || v == "currentColor")
				{
					return v;
				}
				if (HexColor.IsMatch(v))
				{
					return v.ToLowerInvariant();
				}
				throw Invalid(display, attribute, value, "use #rgb, #rrggbb, none or currentColor");
			case "fill-rule":
				return Keyword(v, display, attribute, value, "nonzero", "evenodd");
			case "stroke-linecap":
				return Keyword(v, display, attribute, value, "butt", "round", "square");
			case "stroke-linejoin":
				return Keyword(v, display, attribute, value, "miter", "round", "bevel");
			case "opacity":
			case "fill-opacity":
			case "stroke-opacity":
			{
				if (!Number.IsMatch(v) || double.Parse(v, NumberStyles.Float, CultureInfo.InvariantCulture) is < 0 or > 1)
				{
					throw Invalid(display, attribute, value, "use a number between 0 and 1");
				}
				return v;
			}
			case "stroke-width":
			case "stroke-miterlimit":
			case "stroke-dashoffset":
				if (!Length.IsMatch(v))
				{
					throw Invalid(display, attribute, value);
				}
				return v.EndsWith("px", StringComparison.Ordinal) ? v[..^2] : v;
			case "stroke-dasharray":
			{
				if (v == "none")
				{
					return v;
				}
				var numbers = ListSeparators.Split(v).Where(p => p.Length > 0).ToArray();
				if (numbers.Length == 0 || !numbers.All(n => Length.IsMatch(n)))
				{
					throw Invalid(display, attribute, value);
				}
				return string.Join(' ', numbers.Select(n => n.EndsWith("px", StringComparison.Ordinal) ? n[..^2] : n));
			}
			case "transform":
				return ValidateTransform(v, display, value);
			default:
				throw new InvalidOperationException($"SVG asset '{display}': unexpected attribute '{attribute}'.");
		}
	}

	private static string Keyword(string v, string display, string attribute, string value, params string[] allowed)
	{
		var match = allowed.FirstOrDefault(k => string.Equals(k, v, StringComparison.OrdinalIgnoreCase));
		return match ?? throw Invalid(display, attribute, value, "use " + string.Join(", ", allowed));
	}

	/// <summary>A transform list is re-emitted function by function from its parsed numbers.</summary>
	private static string ValidateTransform(string v, string display, string original)
	{
		var functions = new List<string>();
		var index = 0;
		while (index < v.Length)
		{
			var match = TransformFunction.Match(v, index);
			if (!match.Success)
			{
				throw Invalid(display, "transform", original, "use matrix, translate, scale, rotate, skewX and skewY with numeric arguments");
			}
			var name = match.Groups[1].Value;
			var args = ListSeparators.Split(match.Groups[2].Value.Trim()).Where(a => a.Length > 0).ToArray();
			var expected = name switch
			{
				"matrix" => new[] { 6 },
				"translate" => [1, 2],
				"scale" => [1, 2],
				"rotate" => [1, 3],
				_ => [1],
			};
			if (!expected.Contains(args.Length) || !args.All(a => Number.IsMatch(a)))
			{
				throw Invalid(display, "transform", original, $"{name} takes {string.Join(" or ", expected)} numeric arguments");
			}
			functions.Add($"{name}({string.Join(' ', args)})");
			index = match.Index + match.Length;
		}
		if (functions.Count == 0)
		{
			throw Invalid(display, "transform", original);
		}
		return string.Join(' ', functions);
	}

	private static InvalidOperationException Invalid(string display, string attribute, string value, string? hint = null)
		=> new($"SVG asset '{display}' has an invalid {attribute} value \"{Clip(value)}\"" + (hint is null ? "." : $": {hint}."));

	private static string Clip(string value)
	{
		var flat = Whitespace.Replace(value, " ");
		return flat.Length <= 40 ? flat : flat[..40] + "…";
	}

	private static string Fmt(double value) => (value == 0 ? 0 : value).ToString("0.####", CultureInfo.InvariantCulture);
}
