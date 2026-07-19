namespace CorroServer.Services.Rules;

/// <summary>
/// Single source of randomness for the rulebook: dice rolls and card-deck shuffling
/// both go through this abstraction.
///
/// Production uses <see cref="SystemRandomSource"/> (a real <see cref="System.Random"/>).
/// Integration tests inject a scripted implementation so a whole game can be driven
/// deterministically — exact dice sequences and stacked Fortune / Treasury decks —
/// to exercise integrated behaviour (debt and card effects).
/// </summary>
public interface IRandomSource
{
	/// <summary>
	/// A random integer in the half-open range [minInclusive, maxExclusive),
	/// matching the semantics of <see cref="System.Random.Next(int,int)"/>.
	/// Used for dice values and random collection indices.
	/// </summary>
	int Next(int minInclusive, int maxExclusive);

	/// <summary>
	/// Return an ordering of <paramref name="items"/> to use as a freshly shuffled
	/// deck. Production returns a random permutation; tests can return a fixed
	/// (stacked) order so a known card is drawn next.
	/// </summary>
	IReadOnlyList<T> Shuffle<T>(IReadOnlyList<T> items);
}

/// <summary>
/// Default <see cref="IRandomSource"/> backed by <see cref="System.Random"/>.
/// Pass a <paramref name="seed"/> for a reproducible-yet-random sequence.
/// </summary>
public sealed class SystemRandomSource : IRandomSource
{
	private readonly Random _random;

	public SystemRandomSource(int? seed = null)
		=> _random = seed is int s ? new Random(s) : new Random();

	public int Next(int minInclusive, int maxExclusive) => _random.Next(minInclusive, maxExclusive);

	public IReadOnlyList<T> Shuffle<T>(IReadOnlyList<T> items)
		=> items.OrderBy(_ => _random.Next()).ToList();
}
