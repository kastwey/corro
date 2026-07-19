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

		// Use controllers for the REST API
		app.MapControllers();

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

		app.MapHub<GameHub>("/gamehub");

		// Test-only script controls (enqueue dice / reset). The check mirrors AddE2ETestMode:
		// outside the E2E environment these routes do not exist at all.
		if (builder.Environment.IsEnvironment(E2EEnvName))
		{
			app.MapE2ETestEndpoints();
		}

		// SPA-style fallback: any request that is not an API route, the SignalR hub, or a real static
		// file returns index.html (so direct links / refresh don't 404), from the same provider.
		app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = webRootFiles });

		// Initialize Cosmos DB automatically (now just one container)
		if (builder.Environment.IsDevelopment())
		{
			try
			{
				app.Services.InitializeCosmosDbAsync().GetAwaiter().GetResult();
			}
			catch (Exception ex)
			{
				var logger = app.Services.GetRequiredService<ILogger<Program>>();
				logger.LogError(ex, "Could not initialize Cosmos DB. Make sure the connection string is configured.");
			}
		}

		app.Run();
	}
}
