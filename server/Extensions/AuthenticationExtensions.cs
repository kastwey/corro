using CorroServer.Services.Accounts;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace CorroServer.Extensions;

/// <summary>
/// External sign-in wiring.
///
/// The shape is the framework's standard two-scheme dance, and it is what makes a provider's
/// involvement END at the moment of login: the provider deposits its result in a short-lived
/// EXTERNAL cookie, the app turns that into an account and issues its OWN long-lived SESSION
/// cookie, and no later request ever talks to the provider again.
///
/// The session cookie is the credential for BROWSERS specifically, because HttpOnly is a guarantee
/// no JavaScript-readable token can offer. A future native app wants the opposite trade — no XSS
/// surface, but a real secure keystore — so it will get bearer tokens instead. That is why the code
/// that turns an account into a signed-in principal lives in <see cref="SessionPrincipal"/> rather
/// than here: adding a second transport means adding a scheme beside these, not rewriting them.
/// </summary>
public static class AuthenticationExtensions
{
	/// <summary>The app's own session, issued by us and validated by us.</summary>
	public const string SessionScheme = "Corro.Session";

	/// <summary>Holds a provider's result for the few seconds between its callback and our own
	/// sign-in. Never a session in its own right.</summary>
	public const string ExternalScheme = "Corro.External";

	public static IServiceCollection AddCorroAuthentication(
		this IServiceCollection services,
		IConfiguration configuration)
	{
		var section = configuration.GetSection(ExternalAuthOptions.SectionName);

		services.AddOptions<ExternalAuthOptions>()
			.Bind(section)
			.Validate(options => options.IsValid,
				$"{ExternalAuthOptions.SectionName}: each OAuth provider must be fully configured or left off "
				+ "(Google and Microsoft need ClientId + ClientSecret; Apple needs ClientId, TeamId, KeyId and "
				+ "PrivateKey), and SessionDays must be between 1 and 365.")
			.ValidateOnStart();

		// Read once at startup: the authentication schemes themselves are fixed at registration
		// time, so a provider cannot be switched on without a restart anyway.
		var options = section.Get<ExternalAuthOptions>() ?? new ExternalAuthOptions();

		services.AddSingleton<UserAccountService>();
		services.AddSingleton<FriendshipService>();
		services.AddSingleton(new AuthProviderCatalog(
			options.ConfiguredProviders().Select(key => new AuthProviderDescriptor(key, IsTestDouble: false))));

		var builder = services
			.AddAuthentication(SessionScheme)
			.AddCookie(SessionScheme, cookie =>
			{
				cookie.Cookie.Name = "corro.session";
				cookie.Cookie.HttpOnly = true;
				// SameSite=Lax is load-bearing, not incidental: it means a cross-site request can
				// never carry this cookie on a POST, which is what protects every state-changing
				// endpoint from CSRF. The corollary is a rule for this codebase — an endpoint that
				// changes account state must never be a GET.
				cookie.Cookie.SameSite = SameSiteMode.Lax;
				// SameAsRequest so plain-http localhost development works; production is HTTPS-only,
				// where this resolves to Secure.
				cookie.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
				// Exempt from cookie-consent gating: without it there is no way to be signed in.
				cookie.Cookie.IsEssential = true;
				cookie.ExpireTimeSpan = TimeSpan.FromDays(options.SessionDays);
				cookie.SlidingExpiration = true;

				// This server has no HTML login page to redirect to — the client is a single-page app
				// that asks over the API. Answer with plain status codes instead of a 302 to a route
				// that does not exist.
				cookie.Events.OnRedirectToLogin = context =>
				{
					context.Response.StatusCode = StatusCodes.Status401Unauthorized;
					return Task.CompletedTask;
				};
				cookie.Events.OnRedirectToAccessDenied = context =>
				{
					context.Response.StatusCode = StatusCodes.Status403Forbidden;
					return Task.CompletedTask;
				};
			})
			.AddCookie(ExternalScheme, cookie =>
			{
				cookie.Cookie.Name = "corro.external";
				cookie.Cookie.HttpOnly = true;
				cookie.Cookie.SameSite = SameSiteMode.Lax;
				cookie.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
				cookie.Cookie.IsEssential = true;
				// Only has to survive the redirect back from the provider.
				cookie.ExpireTimeSpan = TimeSpan.FromMinutes(5);
			});

		if (options.Google.IsConfigured)
		{
			builder.AddGoogle(AuthProviders.Google, google =>
			{
				google.ClientId = options.Google.ClientId!;
				google.ClientSecret = options.Google.ClientSecret!;
				google.SignInScheme = ExternalScheme;
				// Provider access tokens are of no use after sign-in: this app reads no Google data.
				// Not saving them means there is nothing there to leak.
				google.SaveTokens = false;
			});
		}

		if (options.Microsoft.IsConfigured)
		{
			builder.AddMicrosoftAccount(AuthProviders.Microsoft, microsoft =>
			{
				microsoft.ClientId = options.Microsoft.ClientId!;
				microsoft.ClientSecret = options.Microsoft.ClientSecret!;
				microsoft.SignInScheme = ExternalScheme;
				microsoft.SaveTokens = false;
			});
		}

		if (options.Apple.IsConfigured)
		{
			// Apple's client secret is not a static string like the others: it is a short-lived
			// ES256 JWT the handler signs from the .p8 private key, carrying the Team ID, Key ID and
			// Services ID. GenerateClientSecret = true makes the handler mint and refresh it, so
			// nothing here has to be rotated by hand.
			builder.AddApple(AuthProviders.Apple, apple =>
			{
				apple.ClientId = options.Apple.ClientId!;
				apple.TeamId = options.Apple.TeamId!;
				apple.KeyId = options.Apple.KeyId!;
				apple.GenerateClientSecret = true;
				apple.PrivateKey = (_, _) =>
					Task.FromResult(options.Apple.PrivateKey!.AsMemory());
				apple.SignInScheme = ExternalScheme;
				apple.SaveTokens = false;
			});
		}

		return services;
	}
}
