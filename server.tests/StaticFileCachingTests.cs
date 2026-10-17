using CorroServer.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;

namespace CorroServer.Tests;

/// <summary>
/// Reported from the first evening after a deployment: the create form was still missing the rules
/// that had just shipped, and a table its team panel, until a hard reload. The static middleware
/// sent no Cache-Control, so the browser applied its own heuristic lifetime — a tenth of the time
/// since the file last changed, days for a script untouched for a month — and never asked again.
/// </summary>
public class StaticFileCachingTests
{
	[Fact]
	public void Every_static_response_is_told_to_revalidate()
	{
		var context = new DefaultHttpContext();

		StaticFileCaching.Prepare(context.Response);

		// no-cache, not no-store: the copy is kept and the ETag answers with a 304 when nothing
		// changed, so the cost is a round trip per file and never a stale lobby.
		Assert.Equal("no-cache", context.Response.Headers[HeaderNames.CacheControl].ToString());
	}

	[Fact]
	public void The_options_serve_the_given_files_and_stamp_each_response_through_the_same_hook()
	{
		var files = new NullFileProvider();
		var options = StaticFileCaching.Options(files);
		Assert.Same(files, options.FileProvider);

		// The middleware calls OnPrepareResponse once per served file; the fallbacks share the
		// options, so a lobby reached through /es/ is stamped exactly like one reached by its file.
		var context = new DefaultHttpContext();
		options.OnPrepareResponse(new StaticFileResponseContext(context, new NotFoundFileInfo("index.html")));

		Assert.Equal(StaticFileCaching.CacheControl, context.Response.Headers[HeaderNames.CacheControl].ToString());
	}
}
