using CorroServer.Services.Rules;
using Xunit;

namespace CorroServer.Tests;

/// <summary>
/// The two <see cref="IRandomSource"/> implementations. SystemRandomSource backs production
/// (its Shuffle randomizes the turn order — bug #2: it was always whoever joined first);
/// ScriptedRandomSource backs the integration harness and the E2E environment, where every
/// roll is scripted and a shuffle must preserve order (stacked decks, join-order turns).
/// </summary>
public class RandomSourceTests
{
	// ── SystemRandomSource.Shuffle (turn order / deck shuffle in production) ──

	[Fact]
	public void SystemShuffle_keeps_every_element_exactly_once()
	{
		var shuffled = new SystemRandomSource(123).Shuffle(Enumerable.Range(0, 6).ToList());
		Assert.Equal(Enumerable.Range(0, 6), shuffled.OrderBy(x => x));
	}

	[Fact]
	public void SystemShuffle_does_not_always_keep_the_join_order_first_player()
	{
		// Over many seeds the starting player varies — it is NOT always index 0 (the join-order first).
		var firsts = new HashSet<int>();
		for (int seed = 0; seed < 50; seed++)
		{
			firsts.Add(new SystemRandomSource(seed).Shuffle(Enumerable.Range(0, 4).ToList())[0]);
		}
		Assert.True(firsts.Count > 1, "the starting player must vary, not always be the first to join");
	}

	[Fact]
	public void SystemShuffle_is_deterministic_for_a_given_seed()
	{
		var items = Enumerable.Range(0, 8).ToList();
		Assert.Equal(new SystemRandomSource(42).Shuffle(items), new SystemRandomSource(42).Shuffle(items));
	}

	// ── ScriptedRandomSource (integration harness + E2E environment) ──

	[Fact]
	public void Scripted_next_consumes_the_queue_in_order()
	{
		var rng = new ScriptedRandomSource().Enqueue(3, 4, 5);
		Assert.Equal(3, rng.Next(1, 7));
		Assert.Equal(4, rng.Next(1, 7));
		Assert.Equal(5, rng.Next(0, 6));
		Assert.Equal(0, rng.PendingCount);
	}

	[Fact]
	public void Scripted_next_fails_loudly_when_the_queue_is_empty()
	{
		// An unscripted roll is a scripting bug in the test — never fall back to real randomness.
		var ex = Assert.Throws<InvalidOperationException>(() => new ScriptedRandomSource().Next(1, 7));
		Assert.Contains("ran out of scripted values", ex.Message);
	}

	[Fact]
	public void Scripted_next_rejects_a_value_outside_the_requested_range()
	{
		// e.g. scripting a die face 9 where the rulebook asked for a standard die in [1,7).
		var ex = Assert.Throws<InvalidOperationException>(() => new ScriptedRandomSource().Enqueue(9).Next(1, 7));
		Assert.Contains("outside the requested range", ex.Message);
	}

	[Fact]
	public void Scripted_shuffle_is_the_identity()
	{
		// Stacked decks keep their declared order; the turn order keeps the join order.
		var items = new[] { "a", "b", "c" };
		Assert.Equal(items, new ScriptedRandomSource().Shuffle(items));
	}

	[Fact]
	public void Scripted_reset_drops_unconsumed_values()
	{
		var rng = new ScriptedRandomSource().Enqueue(1, 2, 3);
		rng.Reset();
		Assert.Equal(0, rng.PendingCount);
		Assert.Throws<InvalidOperationException>(() => rng.Next(1, 7));
	}
}
