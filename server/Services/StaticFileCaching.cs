using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;

namespace CorroServer.Services;

/// <summary>
/// How the frontend's files are allowed to be cached: always revalidated, never assumed fresh.
///
/// The static middleware sends an ETag and a Last-Modified date and nothing else, and a browser
/// given no Cache-Control works out a freshness lifetime of its own — a tenth of the time since the
/// file last changed. A lobby script untouched for a month was therefore held for days without a
/// single request to the server, and a deployment in between never reached the player: reported
/// from the first evening after one, as a create form still missing the rules that had just been
/// shipped, and a table still missing its team panel. Only a hard reload got them.
///
/// <c>no-cache</c> does not forbid caching — the copy is kept — it forbids using it without asking,
/// and the ETag answers that question with a 304 when nothing changed. The frontend is a handful
/// of files, so the round trips are cheap; a stale rulebook is not. Nothing here varies by file
/// type on purpose: the HTML names the scripts, the scripts fetch the locales and the packages,
/// and a stale copy anywhere in that chain shows the player yesterday's game.
/// </summary>
public static class StaticFileCaching
{
	public const string CacheControl = "no-cache";

	/// <summary>Options for the static middleware and the SPA fallbacks alike, over the same files.</summary>
	public static StaticFileOptions Options(IFileProvider files) => new()
	{
		FileProvider = files,
		OnPrepareResponse = context => Prepare(context.Context.Response),
	};

	/// <summary>Stamps one response. Separate from the options so a test can hand it a response of its own.</summary>
	public static void Prepare(HttpResponse response)
	{
		response.Headers[HeaderNames.CacheControl] = CacheControl;
	}
}
