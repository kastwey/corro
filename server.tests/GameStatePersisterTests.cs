using System.Collections.Concurrent;
using CorroServer.Models;
using CorroServer.Services;

namespace CorroServer.Tests;

/// <summary>
/// Tests for <see cref="GameStatePersister"/>, the background, coalescing writer that took
/// persistence OFF the awaited SignalR command path. The guarantees that matter:
///   • Enqueue is non-blocking (it returns before the write completes).
///   • Coalescing is latest-wins: snapshots enqueued while a write is in flight collapse to
///     the most recent one, intermediate snapshots are skipped.
///   • Writes for a game never overlap (they're serialized by the single worker).
///   • A failing write is swallowed (logged) and the worker keeps draining.
/// </summary>
public class GameStatePersisterTests
{
	private static GameState State(string turn) => new() { CurrentTurn = turn };

	[Fact]
	public async Task Enqueue_ReturnsBeforeTheWriteCompletes()
	{
		var gate = new TaskCompletionSource();
		var started = new TaskCompletionSource();
		var persister = new GameStatePersister("g1", async _ =>
		{
			started.SetResult();
			await gate.Task; // block the write until we release it
		});

		persister.Enqueue(State("a"));

		// The write has begun but not finished; Enqueue already returned (we're here).
		await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
		Assert.False(persister.WaitForIdleAsync().IsCompleted);

		gate.SetResult();
		await persister.WaitForIdleAsync().WaitAsync(TimeSpan.FromSeconds(5));
	}

	[Fact]
	public async Task CoalescesToLatest_SkippingIntermediateSnapshots()
	{
		var writes = new ConcurrentQueue<string>();
		var firstStarted = new TaskCompletionSource();
		var release = new TaskCompletionSource();

		var persister = new GameStatePersister("g1", async state =>
		{
			if (writes.IsEmpty)
			{
				writes.Enqueue(state.CurrentTurn!);
				firstStarted.SetResult();
				await release.Task; // hold the first write open so more snapshots pile up
				return;
			}
			writes.Enqueue(state.CurrentTurn!);
		});

		persister.Enqueue(State("a"));               // becomes the in-flight write
		await firstStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));

		persister.Enqueue(State("b"));               // superseded…
		persister.Enqueue(State("c"));               // …by the latest

		release.SetResult();
		await persister.WaitForIdleAsync().WaitAsync(TimeSpan.FromSeconds(5));

		// Only the in-flight "a" and the latest "c" are written; "b" is coalesced away.
		Assert.Equal(new[] { "a", "c" }, writes.ToArray());
	}

	[Fact]
	public async Task WriteFailure_IsSwallowed_AndWorkerKeepsDraining()
	{
		var writes = new ConcurrentQueue<string>();
		var firstStarted = new TaskCompletionSource();
		var release = new TaskCompletionSource();

		var persister = new GameStatePersister("g1", async state =>
		{
			if (state.CurrentTurn == "a")
			{
				firstStarted.SetResult();
				await release.Task;
				throw new InvalidOperationException("boom"); // first write fails
			}
			writes.Enqueue(state.CurrentTurn!);
		});

		persister.Enqueue(State("a"));
		await firstStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));
		persister.Enqueue(State("b")); // queued behind the failing write

		release.SetResult();
		await persister.WaitForIdleAsync().WaitAsync(TimeSpan.FromSeconds(5));

		// The failure didn't kill the worker: "b" was still written.
		Assert.Equal(new[] { "b" }, writes.ToArray());
	}

	[Fact]
	public async Task WaitForIdle_IsCompletedWhenNothingPending()
	{
		var persister = new GameStatePersister("g1", _ => Task.CompletedTask);
		persister.Enqueue(State("a"));
		await persister.WaitForIdleAsync().WaitAsync(TimeSpan.FromSeconds(5));
		Assert.True(persister.WaitForIdleAsync().IsCompleted);
	}
}
