/**
 * unlockCodes — the player's unlock codes for hidden boards (a self-hosting feature).
 *
 * A shipped package may be HIDDEN behind an unlock code (manifest `unlockCode`). The server keeps
 * such boards out of the public list until the player presents a matching code; entering one reveals
 * every hidden board that shares it. The codes a player enters are kept HERE, in the browser, and
 * replayed to the server on every board request (via the {@link UNLOCK_HEADER} header), so each code
 * is typed only once and unlocked boards stay visible across reloads — this is the "cookie" the design
 * called for, done with localStorage.
 *
 * The server holds no per-player state: it treats the replayed codes purely as a filter.
 */

/** The request header carrying the comma-separated unlock codes to the server. */
export const UNLOCK_HEADER = 'X-Corro-Unlock';

const STORAGE_KEY = 'corro.unlockCodes';

/**
 * Canonical form of a code so entry is forgiving and matches the server's own normalization
 * (trimmed, lower-cased). Commas are stripped because they delimit codes in the header.
 */
function normalize(code: string): string {
	return code.trim().toLowerCase().replace(/,/g, '');
}

/** The codes the player has entered so far (normalized), or an empty list if none / unreadable. */
export function getUnlockCodes(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : [];
	} catch {
		return [];
	}
}

/** Whether the player already holds this code (normalized comparison). */
export function hasUnlockCode(code: string): boolean {
	return getUnlockCodes().includes(normalize(code));
}

/** Persist a code (normalized, de-duplicated). A blank code is ignored. */
export function addUnlockCode(code: string): void {
	const c = normalize(code);
	if (!c) return;
	const codes = getUnlockCodes();
	if (codes.includes(c)) return;
	codes.push(c);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
	} catch {
		/* A full/blocked localStorage just means the code isn't remembered next session — not fatal. */
	}
}

/**
 * The header value for the stored codes, optionally including a not-yet-saved `candidate` so the
 * caller can test a fresh code against the server WITHOUT persisting it first (persist only if it
 * actually reveals something). Returns '' when there is nothing to send.
 */
export function unlockHeaderValue(candidate?: string): string {
	const codes = getUnlockCodes();
	const c = candidate ? normalize(candidate) : '';
	if (c && !codes.includes(c)) codes.push(c);
	return codes.join(',');
}
