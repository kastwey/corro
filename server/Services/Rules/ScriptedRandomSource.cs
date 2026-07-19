namespace CorroServer.Services.Rules;

/// <summary>
/// Deterministic <see cref="IRandomSource"/> for scripted games.
///
/// Every call to <see cref="Next"/> consumes the next value from a single ordered queue,
/// so a test scripts
/// the exact sequence the rulebook will ask for. <see cref="Shuffle{T}"/> is the identity,
/// so decks keep their declared order (cards.json) and the turn order keeps the join order.
///
/// Used in two places: injected directly by the xUnit integration harness, and registered
/// as THE <see cref="IRandomSource"/> when the server runs in the E2E environment, where the
/// Playwright suite feeds the queue over the test-only <c>/e2e/random</c> endpoint. It fails
/// loudly when the queue runs dry: an unscripted roll is a scripting bug in the test, never
/// something to paper over with real randomness.
/// </summary>
public sealed class ScriptedRandomSource : IRandomSource
{
	private readonly Queue<int> _values = new();
	private readonly object _lock = new();

	/// <summary>Enqueue raw values, consumed in order by subsequent <see cref="Next"/> calls.</summary>
	public ScriptedRandomSource Enqueue(params int[] values)
	{
		lock (_lock)
		{
			foreach (var v in values)
			{
				_values.Enqueue(v);
			}
		}
		return this;
	}

	/// <summary>Drop any unconsumed values (e.g. between E2E tests).</summary>
	public void Reset()
	{
		lock (_lock)
		{
			_values.Clear();
		}
	}

	/// <summary>How many scripted values are still unconsumed (E2E introspection/debugging).</summary>
	public int PendingCount
	{
		get
		{
			lock (_lock)
			{
				return _values.Count;
			}
		}
	}

	public int Next(int minInclusive, int maxExclusive)
	{
		lock (_lock)
		{
			if (_values.Count == 0)
			{
				throw new InvalidOperationException(
					"ScriptedRandomSource ran out of scripted values. Did the rulebook ask for an " +
					"extra roll (e.g. doubles or a utility-rent throw) you didn't script?");
			}

			var value = _values.Dequeue();
			if (value < minInclusive || value >= maxExclusive)
			{
				throw new InvalidOperationException(
					$"Scripted value {value} is outside the requested range [{minInclusive}, {maxExclusive}). " +
					"The rulebook likely asked for a different roll than the one you scripted.");
			}

			return value;
		}
	}

	// Decks are stacked explicitly by the caller, so a "shuffle" must preserve order.
	public IReadOnlyList<T> Shuffle<T>(IReadOnlyList<T> items) => items.ToList();
}
