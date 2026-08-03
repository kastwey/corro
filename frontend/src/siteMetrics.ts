// siteMetrics.ts — what this deployment says about itself in the footer.
//
// One number: how many tables have somebody at them. It exists because a visitor cannot tell an
// empty lobby from a dead one, and that is the question that decides whether they bother creating
// a table at all.
//
// Two rules shape everything here:
//
//  * It is NEVER a live region and never refreshes under the reader. A number that changes while
//    somebody is reading the page is a ticker talking over them; this is a fact stated once, on
//    arrival, like the rest of the footer.
//  * A deployment that has not turned it on says NOTHING — the element stays hidden rather than
//    showing a zero. "Quiet" and "empty" are different answers, and a server that keeps quiet must
//    not be readable as one with nobody in it.

/** The shape the server's `/api/config/metrics` answers with. */
export interface SiteMetrics {
	/** Tables with somebody connected, or null when this deployment does not publish the number. */
	readonly activeTables: number | null;
}

/**
 * Read a metrics payload defensively. Anything that is not a non-negative whole number — a string,
 * a float, a negative, a missing field, a body that is not an object at all — means "no number",
 * which is the same safe outcome as a deployment that never turned the setting on.
 */
export function parseSiteMetrics(payload: unknown): SiteMetrics {
	const value = (payload as { activeTables?: unknown } | null)?.activeTables;
	const usable = typeof value === 'number' && Number.isInteger(value) && value >= 0;
	return { activeTables: usable ? value as number : null };
}

/**
 * Fill the footer's line, or leave it hidden. Returns whether anything was shown, which is what
 * the tests asserting the quiet case actually care about.
 *
 * `translate` is passed in rather than imported so this stays a pure-ish function over the DOM:
 * the count is interpolated into the host's own words, in the reader's own language.
 */
export function renderActiveTables(
	element: HTMLElement | null,
	metrics: SiteMetrics,
	translate: (key: string, vars?: Record<string, unknown>) => string,
): boolean {
	if (!element) return false;
	if (metrics.activeTables === null) {
		element.hidden = true;
		element.textContent = '';
		return false;
	}
	element.textContent = translate('footer.activeTables', { count: metrics.activeTables });
	element.hidden = false;
	return true;
}

/**
 * Ask the server once and paint the answer. Every failure — offline, a 500, a body that is not
 * JSON — is the quiet case: the footer simply says nothing, which is exactly what it said before
 * anybody thought to count anything.
 */
export async function initializeSiteMetrics(
	element: HTMLElement | null,
	translate: (key: string, vars?: Record<string, unknown>) => string,
	fetchImpl: typeof fetch = fetch,
): Promise<SiteMetrics> {
	let metrics: SiteMetrics = { activeTables: null };
	try {
		const response = await fetchImpl('/api/config/metrics');
		if (response.ok) metrics = parseSiteMetrics(await response.json());
	} catch {
		// Nothing to report and nothing to say about it: the lobby works either way.
	}
	renderActiveTables(element, metrics, translate);
	return metrics;
}
