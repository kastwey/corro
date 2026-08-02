namespace CorroServer.Tests;

/// <summary>Locates shipped .corro packages from the test assembly (walks up to server/Packages/).</summary>
internal static class CorroTestPaths
{
	public static string PackageDir(string id)
	{
		var dir = AppContext.BaseDirectory;
		for (var i = 0; i < 8 && dir is not null; i++)
		{
			var candidate = Path.Combine(dir, "server", "Packages", id);
			if (File.Exists(Path.Combine(candidate, "manifest.json")))
			{
				return candidate;
			}

			dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
		}
		throw new DirectoryNotFoundException($"Could not locate server/Packages/{id} from {AppContext.BaseDirectory}");
	}

	/// <summary>The server/Packages/ folder that holds the shipped, approved board packages.</summary>
	public static string PackagesRoot()
			  => Path.GetDirectoryName(PackageDir("galactic-empire"))!;

	/// <summary>The server's content root as the app sees it at runtime — the folder holding Legal/
	/// and the rest of the content that travels in the publish artifact. NOT wwwroot, which is
	/// generated: the frontend build wipes it and re-mirrors it from frontend/dist.</summary>
	public static string ContentRoot()
	{
		var dir = AppContext.BaseDirectory;
		for (var i = 0; i < 8 && dir is not null; i++)
		{
			var candidate = Path.Combine(dir, "server");
			if (File.Exists(Path.Combine(candidate, "CorroServer.csproj")))
			{
				return candidate;
			}

			dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
		}
		throw new DirectoryNotFoundException($"Could not locate the server folder from {AppContext.BaseDirectory}");
	}

	/// <summary>Locates a test-only .corro package under server.tests/Fixtures/ (not shipped).</summary>
	public static string FixtureDir(string id)
	{
		var dir = AppContext.BaseDirectory;
		for (var i = 0; i < 8 && dir is not null; i++)
		{
			var candidate = Path.Combine(dir, "server.tests", "Fixtures", id);
			if (File.Exists(Path.Combine(candidate, "manifest.json")))
			{
				return candidate;
			}

			dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
		}
		throw new DirectoryNotFoundException($"Could not locate server.tests/Fixtures/{id} from {AppContext.BaseDirectory}");
	}

	/// <summary>Locates any test fixture folder under server.tests/Fixtures/ (no manifest required).</summary>
	public static string FixturePath(string id)
	{
		var dir = AppContext.BaseDirectory;
		for (var i = 0; i < 8 && dir is not null; i++)
		{
			var candidate = Path.Combine(dir, "server.tests", "Fixtures", id);
			if (Directory.Exists(candidate))
			{
				return candidate;
			}

			dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
		}
		throw new DirectoryNotFoundException($"Could not locate server.tests/Fixtures/{id} from {AppContext.BaseDirectory}");
	}
}
