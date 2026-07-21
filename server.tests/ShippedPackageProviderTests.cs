using CorroServer.Services.Corro;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The shipped-package provider discovers the approved boards under server/Packages/ (the engine's
/// built-in boards, as packages). It lists them by manifest id and resolves a folder only for a known
/// id — never by treating the id as a raw path segment.
/// </summary>
public class ShippedPackageProviderTests
{
	private static ShippedPackageProvider Provider() => new(CorroTestPaths.PackagesRoot());

	[Fact]
	public void List_finds_the_galactic_board_with_a_localized_name()
	{
		 var galactic = Assert.Single(Provider().List(), p => p.Id == "galactic-empire");
		Assert.False(string.IsNullOrWhiteSpace(galactic.Name["en"]));
	}

	[Fact]
	public void ResolveDir_returns_the_folder_for_a_known_id()
	{
		 var dir = Provider().ResolveDir("galactic-empire");
		Assert.NotNull(dir);
		Assert.True(File.Exists(Path.Combine(dir!, "manifest.json")));
	}

	[Theory]
	[InlineData("unknown-board")]
	[InlineData("../Packages")]
	[InlineData("..")]
	[InlineData("")]
	public void ResolveDir_returns_null_for_anything_that_is_not_an_approved_id(string id)
		=> Assert.Null(Provider().ResolveDir(id));

	[Fact]
	public void List_is_empty_when_the_packages_folder_is_missing()
		=> Assert.Empty(new ShippedPackageProvider(Path.Combine(Path.GetTempPath(), "no_such_" + Guid.NewGuid().ToString("N"))).List());

	[Fact]
	public void Additional_package_roots_are_merged_without_shadowing_the_primary_root()
	{
		var primary = PackageRoot(("public-a", null), ("same-id", null));
		var additional = PackageRoot(("fixture-hidden", "e2e-hidden"), ("same-id", "e2e-hidden"));
		var provider = new ShippedPackageProvider(primary, new[] { additional });

		Assert.Contains(provider.List(), p => p.Id == "public-a");
		Assert.DoesNotContain(provider.List(), p => p.Id == "fixture-hidden");
		Assert.Contains(provider.List(Codes("e2e-hidden")), p => p.Id == "fixture-hidden");
		Assert.Single(provider.List(Codes("e2e-hidden")), p => p.Id == "same-id");
		Assert.StartsWith(primary, provider.ResolveDir("same-id"), StringComparison.OrdinalIgnoreCase);
	}

	// ----- Hidden packages (the self-hosting unlock-code gate) -----

	[Fact]
	public void A_hidden_package_is_absent_from_the_public_list()
	{
		var provider = WithPackages(("public-a", null), ("secret-x", "onlywithblinds"));
		Assert.Contains(provider.List(), p => p.Id == "public-a");
		Assert.DoesNotContain(provider.List(), p => p.Id == "secret-x");
	}

	[Fact]
	public void A_hidden_package_is_revealed_by_its_code()
	{
		var listed = WithPackages(("public-a", null), ("secret-x", "onlywithblinds")).List(Codes("onlywithblinds"));
		Assert.Contains(listed, p => p.Id == "public-a");
		Assert.Contains(listed, p => p.Id == "secret-x");
	}

	[Fact]
	public void One_code_reveals_every_hidden_package_that_shares_it()
	{
		var listed = WithPackages(("secret-x", "onlywithblinds"), ("secret-y", "onlywithblinds"), ("secret-z", "other"))
			.List(Codes("onlywithblinds"));
		Assert.Contains(listed, p => p.Id == "secret-x");
		Assert.Contains(listed, p => p.Id == "secret-y");
		Assert.DoesNotContain(listed, p => p.Id == "secret-z"); // a different code stays hidden
	}

	[Fact]
	public void CanAccess_gates_a_hidden_package_but_never_a_public_one()
	{
		var provider = WithPackages(("public-a", null), ("secret-x", "onlywithblinds"));
		Assert.True(provider.CanAccess("public-a", Codes()));                  // public: always accessible
		Assert.False(provider.CanAccess("secret-x", Codes()));                 // hidden, no code: no
		Assert.True(provider.CanAccess("secret-x", Codes("onlywithblinds")));  // hidden, right code: yes
		Assert.False(provider.CanAccess("no-such-board", Codes("onlywithblinds"))); // unknown id: no
	}

	[Fact]
	public void ResolveDir_is_never_gated_so_the_restore_path_always_works()
	{
		// A joiner/restore re-stages a board an existing game already uses BY ID, with no code — that
		// path must keep working for a HIDDEN board too, or joining a hidden-board game would break.
		var dir = WithPackages(("secret-x", "onlywithblinds")).ResolveDir("secret-x");
		Assert.NotNull(dir);
		Assert.True(File.Exists(Path.Combine(dir!, "manifest.json")));
	}

	[Fact]
	public void An_unlock_code_matches_case_insensitively_and_trimmed()
	{
		// The provider normalizes the manifest code; the caller normalizes the presented codes the same
		// way (as the controller does), so a differently-cased entry still matches.
		Assert.True(WithPackages(("secret-x", "OnlyWithBlinds")).CanAccess("secret-x", Codes("onlywithblinds")));
	}

	/// <summary>A provider over a throwaway packages root with the given (id, unlockCode) packages;
	/// a null code makes the package public. Only the manifest head (id/name/unlockCode) is written —
	/// enough for List/CanAccess/ResolveDir, which never read the board body.</summary>
	private static ShippedPackageProvider WithPackages(params (string Id, string? Code)[] packages)
		=> new(PackageRoot(packages));

	private static string PackageRoot(params (string Id, string? Code)[] packages)
	{
		var root = Path.Combine(Path.GetTempPath(), "corro_hidden_" + Guid.NewGuid().ToString("N"));
		foreach (var (id, code) in packages)
		{
			var dir = Path.Combine(root, id);
			Directory.CreateDirectory(dir);
			var codeField = code is null ? "" : $", \"unlockCode\": \"{code}\"";
			File.WriteAllText(Path.Combine(dir, "manifest.json"),
				$"{{ \"id\": \"{id}\", \"name\": {{ \"en\": \"{id}\", \"es\": \"{id}\" }}{codeField} }}");
		}

		return root;
	}

	/// <summary>The normalized unlock-code set as the controller would present it (already lower-cased).</summary>
	private static HashSet<string> Codes(params string[] codes) => new(codes);
}
