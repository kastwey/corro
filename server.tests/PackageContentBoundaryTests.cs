using System.Text.Json;
using System.Text.RegularExpressions;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// Architectural guard: package ids, card ids and token ids are content. Shared production code
/// may consume those ids as data but must never name one as a literal to select a drawing/branch.
/// Generic engine vocabulary is explicitly allowed even when a package happens to reuse it.
/// </summary>
public class PackageContentBoundaryTests
{
	private static readonly HashSet<string> GenericEngineLiterals = new(StringComparer.Ordinal)
	{
		// Family mechanics / command vocabulary.
		"attack", "defuse", "favor", "nope", "shuffle", "skip",
		// Engine UI / internal routing identifiers that happen to collide with content ids.
		"f6", "b1", "b2",
	};

	[Fact]
	public void Shared_engine_sources_do_not_hardcode_shipped_package_card_or_token_ids()
	{
		var packagesRoot = CorroTestPaths.PackagesRoot();
		var repositoryRoot = Directory.GetParent(Directory.GetParent(packagesRoot)!.FullName)!.FullName;
		var contentIds = ShippedContentIds(packagesRoot);
		contentIds.ExceptWith(GenericEngineLiterals);

		var sources = Directory.GetFiles(Path.Combine(repositoryRoot, "frontend", "src"), "*.ts", SearchOption.AllDirectories)
			.Concat(Directory.GetFiles(Path.Combine(repositoryRoot, "frontend", "css"), "*.css", SearchOption.AllDirectories))
			.Append(Path.Combine(repositoryRoot, "frontend", "styles.css"))
			.Concat(Directory.GetFiles(Path.Combine(repositoryRoot, "server"), "*.cs", SearchOption.AllDirectories)
				.Where(path => !Inside(path, "Packages") && !Inside(path, "bin") && !Inside(path, "obj") && !Inside(path, "wwwroot")));
		var leaks = new List<string>();
		foreach (var path in sources)
		{
			var source = File.ReadAllText(path);
			foreach (var id in contentIds)
			{
				if (ContainsExactStringLiteral(source, id))
				{
					leaks.Add($"{Path.GetRelativePath(repositoryRoot, path)} hardcodes package content id '{id}'");
				}
			}
		}

		Assert.True(leaks.Count == 0,
			"Package identity/content leaked into shared engine code. Consume package data and provide a neutral fallback instead:\n"
			+ string.Join("\n", leaks));
	}

	[Fact]
	public void Card_art_renderers_never_branch_on_a_card_id()
	{
		var repositoryRoot = Directory.GetParent(Directory.GetParent(CorroTestPaths.PackagesRoot())!.FullName)!.FullName;
		var renderers = Directory.GetFiles(Path.Combine(repositoryRoot, "frontend", "src"), "*CardArt.ts")
			.Append(Path.Combine(repositoryRoot, "frontend", "src", "cardArt.ts"))
			.Distinct(StringComparer.OrdinalIgnoreCase);
		var leaks = renderers
			.Where(path => Regex.IsMatch(File.ReadAllText(path), @"\b(?:def|card|source)\??\.id\b"))
			.Select(path => Path.GetRelativePath(repositoryRoot, path))
			.ToList();

		Assert.True(leaks.Count == 0,
			"A card-art renderer reads a package card id. Select package geometry from Svg and neutral art from generic mechanics only:\n"
			+ string.Join("\n", leaks));
	}

	private static HashSet<string> ShippedContentIds(string packagesRoot)
	{
		var ids = new HashSet<string>(StringComparer.Ordinal);
		foreach (var directory in Directory.GetDirectories(packagesRoot))
		{
			var manifestPath = Path.Combine(directory, "manifest.json");
			if (!File.Exists(manifestPath))
			{
				continue;
			}
			using (var manifest = JsonDocument.Parse(File.ReadAllText(manifestPath)))
			{
				var root = manifest.RootElement;
				Add(root.GetProperty("id").GetString());
				if (root.TryGetProperty("tokens", out var tokens))
				{
					foreach (var token in tokens.EnumerateArray())
					{
						Add(token.GetProperty("id").GetString());
					}
				}
			}

			var cardsPath = Path.Combine(directory, "cards.json");
			if (!File.Exists(cardsPath))
			{
				continue;
			}
			using var cards = JsonDocument.Parse(File.ReadAllText(cardsPath));
			if (cards.RootElement.ValueKind != JsonValueKind.Array)
			{
				continue;
			}
			foreach (var card in cards.RootElement.EnumerateArray())
			{
				if (card.ValueKind == JsonValueKind.Object && card.TryGetProperty("id", out var id))
				{
					Add(id.GetString());
				}
			}
		}
		return ids;

		void Add(string? id)
		{
			if (!string.IsNullOrWhiteSpace(id))
			{
				ids.Add(id);
			}
		}
	}

	private static bool ContainsExactStringLiteral(string source, string value)
	{
		var escaped = Regex.Escape(value);
		return Regex.IsMatch(source, $"(['\"`]){escaped}\\1", RegexOptions.CultureInvariant);
	}

	private static bool Inside(string path, string directoryName)
		=> path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
			.Contains(directoryName, StringComparer.OrdinalIgnoreCase);
}
