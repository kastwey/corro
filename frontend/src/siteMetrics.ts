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
	/** Tables with somebody at them, or null when this deployment does not publish its activity. */
	readonly activeTables: number | null;
	/** People connected, counted by player rather than by browser tab. Null with the above. */
	readonly connectedPlayers: number | null;
}

/** A count is believed only if it is a whole, non-negative number. */
function count(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Read a metrics payload defensively. Anything that is not a non-negative whole number — a string,
 * a float, a negative, a missing field, a body that is not an object at all — means "no number",
 * which is the same safe outcome as a deployment that never turned the setting on.
 *
 * The two counts travel together and are dropped together: half a sentence ("7 mesas activas, "
 * with nothing after the comma) is worse than no sentence.
 */
export function parseSiteMetrics(payload: unknown): SiteMetrics {
	const body = payload as { activeTables?: unknown; connectedPlayers?: unknown } | null;
	const activeTables = count(body?.activeTables);
	const connectedPlayers = count(body?.connectedPlayers);
	return activeTables === null || connectedPlayers === null
		? { activeTables: null, connectedPlayers: null }
		: { activeTables, connectedPlayers };
}

/**
 * Fill the footer's line, or leave it hidden. Returns whether anything was shown, which is what
 * the tests asserting the quiet case actually care about.
 *
 * The two facts are composed into ONE line — "7 mesas activas, 12 jugadores conectados." — because
 * that is how it is heard: a screen reader reads the paragraph, not the parts. Each half is its own
 * key so both can carry a real singular ("1 mesa activa", never "1 mesas activas"), which the
 * translation layer picks from `count`.
 *
 * `translate` is passed in rather than imported so this stays a pure-ish function over the DOM:
 * the counts are interpolated into the host's own words, in the reader's own language.
 */
export function renderActivity(
	element: HTMLElement | null,
	metrics: SiteMetrics,
	translate: (key: string, vars?: Record<string, unknown>) => string,
): boolean {
	if (!element) return false;
	if (metrics.activeTables === null || metrics.connectedPlayers === null) {
		element.hidden = true;
		element.textContent = '';
		return false;
	}
	element.textContent = translate('footer.activity', {
		tables: translate('footer.activeTables', { count: metrics.activeTables }),
		players: translate('footer.connectedPlayers', { count: metrics.connectedPlayers }),
	});
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
	let metrics: SiteMetrics = { activeTables: null, connectedPlayers: null };
	try {
		const response = await fetchImpl('/api/config/metrics');
		if (response.ok) metrics = parseSiteMetrics(await response.json());
	} catch {
		// Nothing to report and nothing to say about it: the lobby works either way.
	}
	renderActivity(element, metrics, translate);
	return metrics;
}
