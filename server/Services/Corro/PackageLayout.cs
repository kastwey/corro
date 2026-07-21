namespace CorroServer.Services.Corro;

/// <summary>
/// Canonical filesystem layout for package-owned media. Structured package data stays at the
/// package root; visual and audio resources live below assets/.
/// </summary>
internal static class PackageLayout
{
	private const string AssetsDirectoryName = "assets";
	private static readonly string[] AssetKinds = ["cards", "tokens", "sounds"];

	public static string CardArtDirectory(string packageDir)
		=> AssetDirectory(packageDir, "cards");

	public static string TokenArtDirectory(string packageDir)
		=> AssetDirectory(packageDir, "tokens");

	public static string SoundsDirectory(string packageDir)
		=> AssetDirectory(packageDir, "sounds");

	/// <summary>
	/// Reject the short-lived pre-release layout instead of silently accepting two possible
	/// locations for the same resource. A package must have exactly one canonical interpretation.
	/// </summary>
	public static void RejectRootAssetDirectories(string packageDir)
	{
		foreach (var kind in AssetKinds)
		{
			if (Directory.Exists(Path.Combine(packageDir, kind)))
			{
				throw new InvalidOperationException(
					$"Package asset folder '{kind}/' is not valid; move it to 'assets/{kind}/'.");
			}
		}
	}

	private static string AssetDirectory(string packageDir, string kind)
		=> Path.Combine(packageDir, AssetsDirectoryName, kind);
}