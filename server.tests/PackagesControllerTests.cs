using System.IO.Compression;
using System.Text;
using CorroServer.Controllers;
using CorroServer.Models;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Validation;
using CorroServer.Services.Sounds;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The upload endpoint stages an uploaded .corro package and returns the summary the lobby uses
/// for step 2 (name + rule defaults) plus a token for creating the game; bad uploads are rejected.
/// </summary>
public class PackagesControllerTests
{
	private static CorroPackageStore NewStore()
		=> new(
			new CompositeSoundPackProvider(new DefaultSoundPackProvider(CorroTestPaths.FixturePath("sounds-default"))),
			Path.Combine(Path.GetTempPath(), "corro_ctrl_" + Guid.NewGuid().ToString("N")));

	private static ShippedPackageProvider Shipped() => new(CorroTestPaths.PackagesRoot());

	private static IPackageBlobStore NewBlob()
		=> new LocalFilePackageBlobStore(Path.Combine(Path.GetTempPath(), "corro_ctrlblob_" + Guid.NewGuid().ToString("N")));

	private static PackagesController NewController(CorroPackageStore store) => new(store, Shipped(), NewBlob(), new PackageValidator());

	private static IFormFile ClassicBoardZip(bool includeI18n = true)
	{
		var fixture = CorroTestPaths.FixtureDir("corro-classic");
		var files = includeI18n
			? new[] { "manifest.json", "board.json", "cards.json", "i18n/es.json", "i18n/en.json" }
			: new[] { "manifest.json", "board.json", "cards.json" }; // no i18n -> square nameKeys resolve nowhere
		var ms = new MemoryStream();
		using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
		{
			foreach (var file in files)
			{
				var entry = zip.CreateEntry(file);
				using var writer = new StreamWriter(entry.Open());
				writer.Write(File.ReadAllText(Path.Combine(fixture, file)));
			}
			// Token icons live as files (tokens/<id>.svg); include them so the upload validates.
			foreach (var svg in Directory.GetFiles(Path.Combine(fixture, "tokens"), "*.svg"))
			{
				var entry = zip.CreateEntry("tokens/" + Path.GetFileName(svg));
				using var writer = new StreamWriter(entry.Open());
				writer.Write(File.ReadAllText(svg));
			}
		}
		ms.Position = 0;
		return new FormFile(ms, 0, ms.Length, "package", "corro-classic.corro");
	}

	[Fact]
	public async Task Upload_rejects_a_board_referencing_an_i18n_key_that_resolves_in_no_locale()
	{
		var store = NewStore();
		var controller = NewController(store);

		// The classic board with its i18n stripped: its square nameKeys resolve in no locale, so the
		// upload must be rejected (a raw key would otherwise leak to players) rather than staged.
		var result = await controller.Upload(ClassicBoardZip(includeI18n: false));

		var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
		Assert.Contains("resolves in no locale", bad.Value!.ToString());
	}

	[Fact]
	public async Task Upload_with_validate_false_stages_a_board_that_would_otherwise_be_rejected()
	{
		var store = NewStore();
		var controller = NewController(store);

		// The same invalid board (no i18n), but content validation skipped — a trusted/draft upload.
		var result = await controller.Upload(ClassicBoardZip(includeI18n: false), validate: false);

		var ok = Assert.IsType<OkObjectResult>(result.Result);
		var response = Assert.IsType<PackageUploadResponse>(ok.Value);
		Assert.NotNull(store.GetDefinition(response.Token)); // staged despite the dangling keys
		store.Release(response.Token);
	}

	[Fact]
	public async Task Upload_stages_the_package_and_returns_its_summary()
	{
		var store = NewStore();
		var controller = NewController(store);

		var result = await controller.Upload(ClassicBoardZip());

		var ok = Assert.IsType<OkObjectResult>(result.Result);
		var response = Assert.IsType<PackageUploadResponse>(ok.Value);
		Assert.False(string.IsNullOrEmpty(response.Token));
		Assert.Equal("Clásico (Madrid)", response.Name["es"]);   // localized board name for display
		Assert.Equal(1500, response.Settings.StartingMoney);      // rule defaults for the lobby step 2
		Assert.Equal(2, response.MinPlayers);                      // the board's supported player range
		Assert.Equal(8, response.MaxPlayers);
		Assert.NotNull(store.GetDefinition(response.Token));       // staged for the create-game step
																   // The upload is recorded as durable (blob keyed by the token) so the game can be restored.
		Assert.Equal(response.Token, store.GetOrigin(response.Token)!.BlobKey);

		store.Release(response.Token);
	}

	[Fact]
	public async Task Upload_rejects_an_empty_file()
	{
		var result = await NewController(NewStore())
			.Upload(new FormFile(new MemoryStream(), 0, 0, "package", "empty.corro"));

		Assert.IsType<BadRequestObjectResult>(result.Result);
	}

	[Fact]
	public async Task Upload_rejects_a_file_that_is_not_a_valid_package()
	{
		var bytes = new MemoryStream(Encoding.UTF8.GetBytes("this is not a zip"));
		var result = await NewController(NewStore())
			.Upload(new FormFile(bytes, 0, bytes.Length, "package", "bad.corro"));

		var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
		Assert.Equal("Invalid .corro package.", bad.Value);
	}

	[Fact]
	public void ListShipped_lists_the_approved_boards()
	{
		var result = NewController(NewStore()).ListShipped();

		var ok = Assert.IsType<OkObjectResult>(result.Result);
		var list = Assert.IsAssignableFrom<IEnumerable<ShippedPackageSummary>>(ok.Value);
			var galactic = Assert.Single(list, p => p.Id == "imperio-galactico");
		Assert.False(string.IsNullOrWhiteSpace(galactic.Name["es"])); // a localized display name for the lobby
	}

	[Fact]
	public async Task StageShipped_stages_a_shipped_board_like_an_upload()
	{
		var store = NewStore();
		var controller = NewController(store);

			var result = await controller.StageShipped("imperio-galactico");

		var ok = Assert.IsType<OkObjectResult>(result.Result);
		var response = Assert.IsType<PackageUploadResponse>(ok.Value);
		Assert.False(string.IsNullOrEmpty(response.Token));
		Assert.NotNull(store.GetDefinition(response.Token)); // staged for the create-game step, same as upload
		Assert.NotEmpty(response.Tokens);                    // the galactic board ships its own tokens
		Assert.Equal(2, response.MinPlayers);                // galactic caps at its 4 tokens
		Assert.Equal(4, response.MaxPlayers);
		// A shipped board records its id (re-staged from server/Packages on restore — no blob).
			Assert.Equal("imperio-galactico", store.GetOrigin(response.Token)!.ShippedId);

		store.Release(response.Token);
	}

	[Fact]
	public async Task StageShipped_returns_not_found_for_an_unknown_board()
	{
		var result = await NewController(NewStore()).StageShipped("does-not-exist");

		Assert.IsType<NotFoundResult>(result.Result);
	}

	// ----- Hidden packages: the unlock-code header gates listing + staging (self-hosting feature) -----

	[Fact]
	public void ListShipped_hides_a_hidden_board_without_the_code()
	{
		var controller = Controller(NewStore(), HiddenHeadRoot("secret-board", "sesame"));

		var ok = Assert.IsType<OkObjectResult>(controller.ListShipped().Result);
		var list = Assert.IsAssignableFrom<IEnumerable<ShippedPackageSummary>>(ok.Value);
		Assert.DoesNotContain(list, p => p.Id == "secret-board");
	}

	[Fact]
	public void ListShipped_reveals_a_hidden_board_with_the_code_in_the_header()
	{
		var controller = Controller(NewStore(), HiddenHeadRoot("secret-board", "sesame"), unlockHeader: "sesame");

		var ok = Assert.IsType<OkObjectResult>(controller.ListShipped().Result);
		var list = Assert.IsAssignableFrom<IEnumerable<ShippedPackageSummary>>(ok.Value);
		Assert.Contains(list, p => p.Id == "secret-board");
	}

	[Fact]
	public async Task StageShipped_a_hidden_board_is_not_found_without_the_code()
	{
		var controller = Controller(NewStore(), HiddenHeadRoot("secret-board", "sesame"));

		Assert.IsType<NotFoundResult>((await controller.StageShipped("secret-board")).Result);
	}

	[Fact]
	public async Task StageShipped_a_hidden_board_is_not_found_with_the_wrong_code()
	{
		var (shipped, id) = HiddenGalacticRoot("sesame");
		var controller = Controller(NewStore(), shipped, unlockHeader: "wrong");

		Assert.IsType<NotFoundResult>((await controller.StageShipped(id)).Result);
	}

	[Fact]
	public async Task StageShipped_a_hidden_board_stages_with_the_matching_code()
	{
		var store = NewStore();
		var (shipped, id) = HiddenGalacticRoot("sesame");
		var controller = Controller(store, shipped, unlockHeader: "sesame");

		var result = await controller.StageShipped(id);

		var ok = Assert.IsType<OkObjectResult>(result.Result);
		var response = Assert.IsType<PackageUploadResponse>(ok.Value);
		Assert.NotNull(store.GetDefinition(response.Token)); // staged, just like a public board
		store.Release(response.Token);
	}

	[Fact]
	public async Task StageShipped_surfaces_the_board_notice_key_to_the_client()
	{
		var store = NewStore();
		var (shipped, id) = HiddenGalacticRoot("sesame", warning: "notice.blindsOnly");
		var controller = Controller(store, shipped, unlockHeader: "sesame");

		var result = await controller.StageShipped(id);

		var response = Assert.IsType<PackageUploadResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
		Assert.Equal("notice.blindsOnly", response.Warning); // the notice travels; the unlock code never does
		store.Release(response.Token);
	}

	/// <summary>A controller wired with a specific shipped provider and an optional unlock-codes header.</summary>
	private static PackagesController Controller(CorroPackageStore store, ShippedPackageProvider shipped, string? unlockHeader = null)
	{
		var ctx = new DefaultHttpContext();
		if (unlockHeader is not null)
		{
			ctx.Request.Headers["X-Corro-Unlock"] = unlockHeader;
		}

		return new PackagesController(store, shipped, NewBlob(), new PackageValidator())
		{
			ControllerContext = new ControllerContext { HttpContext = ctx },
		};
	}

	/// <summary>A throwaway packages root holding one HIDDEN package with only a manifest head — enough
	/// to test the list filter and the 404 gate, which never read the board body.</summary>
	private static ShippedPackageProvider HiddenHeadRoot(string id, string code)
	{
		var root = Path.Combine(Path.GetTempPath(), "corro_hidhead_" + Guid.NewGuid().ToString("N"));
		var dir = Path.Combine(root, id);
		Directory.CreateDirectory(dir);
		File.WriteAllText(Path.Combine(dir, "manifest.json"),
			$"{{ \"id\": \"{id}\", \"name\": {{ \"en\": \"{id}\", \"es\": \"{id}\" }}, \"unlockCode\": \"{code}\" }}");
		return new ShippedPackageProvider(root);
	}

	/// <summary>A throwaway packages root holding a COPY of the real galactic board, hidden behind
	/// <paramref name="code"/> (and optionally carrying a create-time notice key), so staging exercises
	/// the full package-loading path — not just the manifest head.</summary>
	private static (ShippedPackageProvider Shipped, string Id) HiddenGalacticRoot(string code, string? warning = null)
	{
			const string id = "imperio-galactico";
		var root = Path.Combine(Path.GetTempPath(), "corro_hidfull_" + Guid.NewGuid().ToString("N"));
		var dest = Path.Combine(root, id);
		CopyDir(CorroTestPaths.PackageDir(id), dest);

		var manifestPath = Path.Combine(dest, "manifest.json");
		var node = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(manifestPath))!.AsObject();
		node["unlockCode"] = code;
		if (warning is not null)
		{
			node["warning"] = warning;
		}

		File.WriteAllText(manifestPath, node.ToJsonString());
		return (new ShippedPackageProvider(root), id);
	}

	private static void CopyDir(string src, string dst)
	{
		Directory.CreateDirectory(dst);
		foreach (var dir in Directory.GetDirectories(src, "*", SearchOption.AllDirectories))
		{
			Directory.CreateDirectory(dir.Replace(src, dst));
		}

		foreach (var file in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
		{
			File.Copy(file, file.Replace(src, dst), overwrite: true);
		}
	}

	[Fact]
	public async Task GetHelp_serves_a_shipped_boards_guide_markdown()
	{
		var store = NewStore();
		var controller = NewController(store);
			var staged = await controller.StageShipped("imperio-galactico");
		var token = ((PackageUploadResponse)((OkObjectResult)staged.Result!).Value!).Token;

		var result = controller.GetHelp(token, "es");

		var content = Assert.IsType<ContentResult>(result);
			Assert.Contains("Imperio Galáctico", content.Content!); // the board's guide markdown
		Assert.StartsWith("text/markdown", content.ContentType!);

		store.Release(token);
	}

	[Fact]
	public async Task GetHelp_returns_not_found_when_the_board_ships_no_guide()
	{
		var store = NewStore();
		var controller = NewController(store);
		// The uploaded fixture zip carries only manifest/board/cards — no help.*.md.
		var uploaded = await controller.Upload(ClassicBoardZip());
		var token = ((PackageUploadResponse)((OkObjectResult)uploaded.Result!).Value!).Token;

		Assert.IsType<NotFoundResult>(controller.GetHelp(token, "es"));

		store.Release(token);
	}
}
