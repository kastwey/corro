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
 * A signed-in player's codes ALSO live on their account, and the two are unioned on the way out.
 * That is what makes a code typed on one device reveal the same boards on the next: the browser
 * copy keeps working signed out, and the account copy travels. Neither replaces the other.
 *
 * The server holds no per-request state: it treats the replayed codes purely as a filter.
 */

/** The request header carrying the comma-separated unlock codes to the server. */
export const UNLOCK_HEADER = 'X-Corro-Unlock';

const STORAGE_KEY = 'corro.unlockCodes';

/**
 * The codes the signed-in account carries, as the session last reported them. Held in memory only:
 * localStorage is the browser's own copy and this is somebody's account, which would be the wrong
 * thing to leave behind on a shared computer after they sign out.
 */
let accountCodes: readonly string[] = [];

/** Replace what the account is known to hold. Called with every session read; [] when signed out. */
export function setAccountUnlockCodes(codes: readonly string[]): void {
	accountCodes = codes.map(normalize).filter(code => code.length > 0);
}

/** What the account holds, as this browser last heard it. */
export function getAccountUnlockCodes(): readonly string[] {
	return accountCodes;
}

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
	// The account's codes come too, so a fresh device asks for the right boards on its very first
	// request rather than after the player finds the code again.
	for (const code of accountCodes) {
		if (!codes.includes(code)) codes.push(code);
	}
	const c = candidate ? normalize(candidate) : '';
	if (c && !codes.includes(c)) codes.push(c);
	return codes.join(',');
}

/** Codes this browser holds that the account has not been told about yet. */
export function unlockCodesToAdopt(): string[] {
	return getUnlockCodes().filter(code => !accountCodes.includes(code));
}
