using CorroServer.Extensions;
using CorroServer.Hubs;
using Microsoft.Extensions.FileProviders;

internal class Program
{
	private const string E2EEnvName = "E2E";

	private static void Main(string[] args)
	{
		var builder = WebApplication.CreateBuilder(args);

		// Add UserSecrets in development
		if (builder.Environment.IsDevelopment())
		{
			builder.Configuration.AddUserSecrets<Program>();
		}

		// Register all the classic game services using our extension method
		builder.Services.AddCorroServices(builder.Configuration);

		// Deterministic test mode for the Playwright E2E suite: scripted dice, unshuffled
		// decks / join-order turns and in-memory persistence. Only in ASPNETCORE_ENVIRONMENT=E2E.
		if (builder.Environment.IsEnvironment(E2EEnvName))
		{
			builder.Services.AddE2ETestMode(builder.Configuration["E2E:PackagesRoot"]);
		}

		var app = builder.Build();

		// Which files the static middleware serves. Prod/E2E: the app's own web root (the packaged
		// wwwroot, which ships in the publish artifact — Azure serves from there). Dev: frontend/dist
		// directly, so a `npm run build` (or the `npm run watch` tsc loop) shows on the next browser
		// refresh with no dotnet rebuild and no wwwroot copy.
		//
		// It has to be an explicit FileProvider, NOT WebApplicationOptions.WebRootPath: in Development
		// ASP.NET's static-web-assets provider overrides the web root and would keep serving wwwroot
		// regardless. dist is found by walking up from the app's bin folder (AppContext.BaseDirectory,
		// stable no matter where the server is launched from — unlike the CWD under `dotnet run`).
		IFileProvider webRootFiles = app.Environment.WebRootFileProvider;
		if (app.Environment.IsDevelopment())
		{
			for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
			{
				var dist = Path.Combine(dir.FullName, "frontend", "dist");
				if (Directory.Exists(dist))
				{
					webRootFiles = new PhysicalFileProvider(dist);
					break;
				}
			}
		}

		app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = webRootFiles });
		app.UseStaticFiles(new StaticFileOptions { FileProvider = webRootFiles });

		// UseRouting is called HERE, on purpose, and this is load-bearing.
		//
		// Nobody used to call it, so ASP.NET inserted it automatically at the very START of the
		// pipeline — before the two lines above. An endpoint was therefore already chosen by the
		// time the static middleware ran, and StaticFileMiddleware deliberately stands down when
		// that has happened. The result: UseDefaultFiles could never serve a directory's
		// index.html, and every directory request fell through to a fallback instead. `/es/` was
		// noticed and worked around with a per-locale fallback; `/privacy/` and `/es/privacy/`
		// then hit the same trap and quietly served the LOBBY, which is what a real public page
		// under its own directory will always do here.
		//
		// Placed after the static files and before authentication, this is also simply the
		// canonical ASP.NET order: static files, routing, authentication, endpoints.
		app.UseRouting();

		// Populates User from the session cookie. Required even though no endpoint carries
		// [Authorize]: the account endpoints read the principal directly, and every one of them
		// treats "anonymous" as a normal outcome rather than a failure.
		app.UseAuthentication();

		// Use controllers for the REST API
		app.MapControllers();

		app.MapHub<GameHub>("/gamehub");

		// Test-only script controls (enqueue dice / reset). The check mirrors AddE2ETestMode:
		// outside the E2E environment these routes do not exist at all.
		if (builder.Environment.IsEnvironment(E2EEnvName))
		{
			app.MapE2ETestEndpoints();
		}

		// The lobby is built once per language (frontend/localizePages.js), so `/es/` must answer
		// with the Spanish page. UseDefaultFiles does NOT rewrite that directory — a request for
		// `/es/` reaches the fallback below exactly like an unknown path would, and would silently
		// be served the default-language page, undoing the whole point of building one per
		// language. So each localized lobby gets its own fallback, ahead of the generic one.
		//
		// Discovered from what the build actually produced rather than from a list kept in step by
		// hand: a directory holding an index.html at the web root IS a localized lobby.
		foreach (var locale in webRootFiles.GetDirectoryContents(string.Empty)
			.Where(entry => entry.IsDirectory)
			.Select(entry => entry.Name)
			.Where(name => webRootFiles.GetFileInfo($"{name}/index.html").Exists)
			// Public pages such as /privacy/ also have an index.html. A locale directory is the
			// one whose locale resource exists, not merely any directory with a default document.
			.Where(name => webRootFiles.GetFileInfo($"i18n/locales/{name}.json").Exists)
			.OrderBy(name => name, StringComparer.Ordinal))
		{
			app.MapFallbackToFile($"/{locale}/{{*path:nonfile}}", $"{locale}/index.html",
				new StaticFileOptions { FileProvider = webRootFiles });
		}

		// SPA-style fallback: any request that is not an API route, the SignalR hub, or a real static
		// file returns index.html (so direct links / refresh don't 404), from the same provider.
		app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = webRootFiles });

		// Make sure every container this build reads exists, in EVERY environment.
		//
		// This used to run only in Development, on the reasoning that production containers are
		// provisioned by infrastructure. Nobody was provisioning them: the production database held
		// only Games, so the three containers accounts need had never existed there and signing in
		// could not work — a whole feature missing in silence, since the code only discovers a
		// container is absent when somebody tries to write to it. Every container added since would
		// have arrived the same way.
		//
		// It is safe to repeat: CreateIfNotExists is idempotent, and it costs four metadata calls at
		// startup. A failure is logged and does NOT stop the app — accounts are optional by design,
		// so a site that still deals cards is far better than no site at all.
		try
		{
			app.Services.InitializeCosmosDbAsync().GetAwaiter().GetResult();
		}
		catch (Exception ex)
		{
			var logger = app.Services.GetRequiredService<ILogger<Program>>();
			logger.LogError(ex, "Could not initialize Cosmos DB. Accounts and saved games may be unavailable; games in memory still work.");
		}

		app.Run();
	}
}
