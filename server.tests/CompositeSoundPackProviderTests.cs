using CorroServer.Services.Sounds;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The composite sound provider lets a loaded .corro package bring its own sounds: a package
/// pack overlays the bundled default (its events win, the rest fall back), and its files are served
/// from the package folder while overlaid default files come from the default folder.
/// </summary>
public class CompositeSoundPackProviderTests
{
	private static CompositeSoundPackProvider Build()
		=> new(new DefaultSoundPackProvider(CorroTestPaths.FixturePath("sounds-default")));

	[Fact]
	public void A_registered_package_overlays_the_default_events()
	{
		var composite = Build();
		composite.RegisterPackage("game1", CorroTestPaths.FixturePath("sounds-package"));

		var events = composite.ResolveEvents("game1");

		Assert.Equal("blackhole.ogg", events["holding.enter"].Single()); // package overrides
		Assert.Equal("dice.ogg", events["dice.roll"].Single());        // inherited from default
	}

	[Fact]
	public void It_serves_package_files_and_falls_back_to_default_files()
	{
		var composite = Build();
		composite.RegisterPackage("game1", CorroTestPaths.FixturePath("sounds-package"));

		Assert.True(composite.TryGetSoundFile("game1", "blackhole.ogg", out var pkgPath, out _));
		Assert.Contains("sounds-package", pkgPath); // from the package folder

		Assert.True(composite.TryGetSoundFile("game1", "dice.ogg", out var defPath, out _));
		Assert.Contains("sounds-default", defPath); // overlaid default event served from default
	}

	[Fact]
	public void Package_announcement_mappings_overlay_the_defaults_and_leave_with_the_pack()
	{
		// A pack may map its OWN announcement keys (themed card lines) to sound events.
		var composite = Build();
		Assert.Empty(composite.ResolveAnnouncements(null)); // the default declares none

		composite.RegisterPackage("game1", CorroTestPaths.FixturePath("sounds-package"));
		Assert.Equal("journey.flat", composite.ResolveAnnouncements("game1")["cards.flat_tyre_played"]);

		composite.UnregisterPackage("game1");
		Assert.Empty(composite.ResolveAnnouncements("game1"));
	}

	[Fact]
	public void Without_a_package_or_after_unregister_only_the_default_is_served()
	{
		var composite = Build();
		Assert.Equal("default-holding.ogg", composite.ResolveEvents(null)["holding.enter"].Single());

		composite.RegisterPackage("game1", CorroTestPaths.FixturePath("sounds-package"));
		Assert.Equal("blackhole.ogg", composite.ResolveEvents("game1")["holding.enter"].Single());

		composite.UnregisterPackage("game1");
		Assert.Equal("default-holding.ogg", composite.ResolveEvents("game1")["holding.enter"].Single());
	}
}
