using CorroServer.Controllers;
using CorroServer.Extensions;
using CorroServer.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace CorroServer.Tests;

public class SiteBrandingOptionsTests
{
	[Fact]
	public void Defaults_identify_the_All_Welcome_host()
	{
		var options = ResolveOptions(new Dictionary<string, string?>());

		Assert.Equal("All Welcome", options.Title);
		Assert.Equal("Play together, play your way.", options.Tagline);
		Assert.Null(options.LogoUrl);
		Assert.Null(options.LogoDarkUrl);
		Assert.Null(options.FaviconUrl);
		Assert.Null(options.FaviconDarkUrl);
	}

	[Fact]
	public void Deployment_configuration_can_replace_text_and_theme_assets()
	{
		var options = ResolveOptions(new Dictionary<string, string?>
		{
			["SiteBranding:Title"] = "Community Games",
			["SiteBranding:Tagline"] = "A place where everyone plays.",
			["SiteBranding:LogoUrl"] = "assets/host/logo.svg",
			["SiteBranding:LogoDarkUrl"] = "https://cdn.example.org/logo-dark.svg",
			["SiteBranding:FaviconUrl"] = "/assets/host/favicon.svg",
		});

		Assert.Equal("Community Games", options.Title);
		Assert.Equal("A place where everyone plays.", options.Tagline);
		Assert.Equal("assets/host/logo.svg", options.LogoUrl);
		Assert.Equal("https://cdn.example.org/logo-dark.svg", options.LogoDarkUrl);
		Assert.Equal("/assets/host/favicon.svg", options.FaviconUrl);
	}

	[Theory]
	[InlineData("assets/host/logo.svg")]
	[InlineData("/assets/host/favicon.svg")]
	[InlineData("https://cdn.example.org/logo.svg")]
	public void Web_asset_urls_are_supported_independently_of_host_platform(string value)
	{
		Assert.True(SiteBrandingOptions.IsSupportedAssetUrl(value));
	}

	[Theory]
	[InlineData("SiteBranding:Title", " ")]
	[InlineData("SiteBranding:Title", " Padded title ")]
	[InlineData("SiteBranding:LogoUrl", "http://cdn.example.org/logo.svg")]
	[InlineData("SiteBranding:FaviconUrl", "//cdn.example.org/favicon.svg")]
	[InlineData("SiteBranding:LogoDarkUrl", "assets\\logo.svg")]
	public void Invalid_deployment_values_fail_options_validation(string key, string value)
	{
		var values = new Dictionary<string, string?> { [key] = value };

		Assert.Throws<OptionsValidationException>(() => ResolveOptions(values));
	}

	[Fact]
	public void Config_endpoint_returns_the_bound_public_branding()
	{
		var expected = new SiteBrandingOptions
		{
			Title = "Hosted Games",
			Tagline = null,
			LogoUrl = "assets/host/logo.svg",
		};

		var result = new ConfigController(Options.Create(expected)).GetBranding();

		Assert.Same(expected, result.Value);
	}

	private static SiteBrandingOptions ResolveOptions(Dictionary<string, string?> values)
	{
		var configuration = new ConfigurationBuilder()
			.AddInMemoryCollection(values)
			.Build();
		var services = new ServiceCollection();
		services.AddCorroServices(configuration);
		using var provider = services.BuildServiceProvider();
		return provider.GetRequiredService<IOptions<SiteBrandingOptions>>().Value;
	}
}