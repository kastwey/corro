/**
 * latestOnly.ts — a monotonic ticket guard so only the NEWEST of several overlapping
 * async operations is allowed to apply its result.
 *
 * The lobby stages a board in two awaited hops (POST the package, then load its i18n)
 * before it calls `setPackageTokens` and repaints the token selector. If the host
 * switches boards while a previous stage is still in flight — e.g. picking "Exploding
 * Kittens" right after load, while the default board staged at startup is still
 * resolving — both chains race, and the one that finishes LAST wins. That let a stale
 * default overwrite the chosen board's tokens (the selector showed the wrong pieces,
 * "for some reason"). Wrapping each stage in a ticket makes superseded requests stop: they take
 * a ticket with {@link begin} and, after every await, apply their result only while
 * {@link isCurrent} still holds — a newer selection has bumped the counter otherwise.
 */
export class LatestOnly {
	private seq = 0;

	/** Start a new operation; returns its ticket. Immediately supersedes any earlier one. */
	begin(): number {
		return ++this.seq;
	}

	/** True only while `ticket` is still the most recent one handed out by {@link begin}. */
	isCurrent(ticket: number): boolean {
		return ticket === this.seq;
	}
}
