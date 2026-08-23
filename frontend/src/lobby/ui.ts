/**
 * Lobby UI utilities
 * Common UI functions for the lobby
 */

/** Translation helper using i18next */
export function t(key: string, fallback?: string): string {
	const i18next = (window as any).i18next;
	if (i18next?.t) {
		const translated = i18next.t(key);
		return translated !== key ? translated : (fallback || key);
	}
	return fallback || key;
}

/**
 * Human-readable board name for a board id. Boards come from the server as bare ids
 * ("spain"); this localizes them via `lobby.boards.<id>`, falling back to the
 * capitalized id so an unmapped board still reads sensibly instead of "spain".
 */
export function localizeBoardName(boardId: string): string {
	if (!boardId) return '';
	const fallback = boardId.charAt(0).toUpperCase() + boardId.slice(1);
	return t(`lobby.boards.${boardId}`, fallback);
}

/**
 * Picks a package's display name from its per-locale map for the given language, falling back
 * across locales so a partial translation still shows something (the active language, then en,
 * then es, then any). Pure over its inputs — no globals — so it is unit-testable directly.
 */
export function pickPackageName(name: Record<string, string>, lang: string): string {
	return name[lang] ?? name.en ?? name.es ?? Object.values(name)[0] ?? '';
}

/**
 * Formats an ISO timestamp (the game's creation time) as a short localized date+time
 * for the saved-games list, so several waiting lobbies can be told apart. Returns an
 * empty string for a missing/invalid value. Uses the active i18next language.
 */
export function formatGameDate(iso: string, lang?: string): string {
	if (!iso) return '';
	const date = new Date(iso);
	if (isNaN(date.getTime())) return '';
	const locale = lang || (window as any).i18next?.language || 'en';
	return date.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Whether a saved table has no match running, so resuming it means re-authenticating this
 * browser's session at the table rather than walking into a game. The status comes from the
 * server's SignalR payload, where the GameStatus enum is serialized SnakeCaseLower (e.g.
 * "active", "paused", "waiting_for_players"), so the comparison MUST use snake_case.
 */
export function isTableAtRestStatus(status: string | undefined): boolean {
	return status === 'waiting_for_players';
}

/** Translate server error codes to readable messages */
export function translateServerError(errorCode: string): string {
	if (/^[A-Z_]+$/.test(errorCode)) {
		return t(`serverErrors.${errorCode}`, errorCode);
	}
	return errorCode;
}

/**
 * Extracts the server error code embedded in a SignalR HubException message
 * (e.g. "...HubException: GAME_NOT_FOUND" -> "GAME_NOT_FOUND"). Returns null when the
 * error is not a recognizable HubException, so callers can fall back to a generic message.
 */
export function parseHubErrorCode(error: unknown): string | null {
	// Only an Error or a string can carry a hub code. Stringifying anything else would
	// produce "[object Object]", which fails the match below for no discoverable reason.
	const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
	const match = /HubException:\s*([A-Z_]+)/.exec(raw);
	return match ? match[1] : null;
}

/** Show/hide loading spinner */
export function showLoading(show: boolean): void {
	const loader = document.getElementById('loading');
	if (loader) {
		loader.style.display = show ? 'block' : 'none';
	}
}

/** How long a refusal stays on screen before it is taken away again. */
const ERROR_CLEAR_MS = 5000;

/** Pending wipe, so a second error restarts the clock instead of inheriting the first one's. */
let errorClearTimer: number | null = null;

/**
 * Say what went wrong.
 *
 * Two things this used to get wrong, both found from one report — a delete the server refused,
 * with nothing to show for it on screen:
 *
 * - It TOGGLED the region's display. A live region that is revealed and filled in the same breath
 *   is one a screen reader can miss entirely: the region has to be in the accessibility tree
 *   before the text lands in it. The element is now permanent and empty, `.error:empty` keeps it
 *   out of the layout, and writing text is the only thing that happens here.
 * - It called focus() to "announce to screen readers", which is not what announces it (role=alert
 *   is), does nothing at all while a modal dialog is open — exactly the case that reported this —
 *   and drags the keyboard away from whatever somebody was doing when it does work.
 *
 * It is also scrolled into view, because the message is worth nothing where the eye is not: this
 * rendered at the bottom of a page taller than the window and was four hundred pixels below the
 * fold. The element now sits above the views, and this covers a page somebody has scrolled.
 */
export function showError(message: string): void {
	const errorEl = document.getElementById('error-message');
	if (errorEl) {
		errorEl.textContent = message;
		errorEl.scrollIntoView({ block: 'nearest' });
		if (errorClearTimer !== null) window.clearTimeout(errorClearTimer);
		errorClearTimer = window.setTimeout(() => hideError(), ERROR_CLEAR_MS);
	}
	console.error('Error UI:', message);
}

/** Take the message away again. Emptied, never hidden — see showError. */
export function hideError(): void {
	if (errorClearTimer !== null) {
		window.clearTimeout(errorClearTimer);
		errorClearTimer = null;
	}
	const errorEl = document.getElementById('error-message');
	if (errorEl) {
		errorEl.textContent = '';
	}
}

/** Show a section by ID */
export function showSection(sectionId: string): void {
	const section = document.getElementById(sectionId);
	if (section) {
		section.style.display = 'block';
		section.classList.remove('hidden');
	}
}

/** Hide a section by ID */
export function hideSection(sectionId: string): void {
	const section = document.getElementById(sectionId);
	if (section) {
		section.style.display = 'none';
		section.classList.add('hidden');
	}
}

/**
 * The mutually-exclusive top-level lobby views. Only one is ever visible: `view-home` (the
 * entrance hall — what you can start, what is waiting, your tables, the people), the two forms
 * (`view-create`, `view-join`), the three screens the home's People block leads to
 * (`view-online`, `view-friends`, `view-messages`), `view-settings`, and `view-waiting` (the
 * created/joined waiting room). Splitting the page this way keeps each screen to one subject:
 * the waiting room never shows the games list behind it, and the home never becomes a place to
 * read past a message log on the way to your tables.
 */
export const LOBBY_VIEWS = ['view-home', 'view-create', 'view-join', 'view-online',
	'view-friends', 'view-messages',
	'view-settings', 'view-waiting'] as const;
export type LobbyView = typeof LOBBY_VIEWS[number];

/**
 * Switches the visible lobby view. Hides every other view (both the `.hidden` class
 * and the `hidden` attribute, so they leave the tab order) and reveals the requested
 * one. Focus moves to the view's `[data-view-heading]` for screen-reader context, or
 * to `focusId` when given (e.g. the waiting room's success message). This is the only
 * way views should be toggled so the page never shows two views at once.
 */
export function showView(view: LobbyView, focusId?: string): void {
	for (const id of LOBBY_VIEWS) {
		const el = document.getElementById(id);
		if (!el) continue;
		const active = id === view;
		el.classList.toggle('hidden', !active);
		(el as HTMLElement).hidden = !active;
	}

	const target = focusId
		? document.getElementById(focusId)
		: document.querySelector<HTMLElement>(`#${view} [data-view-heading]`);
	if (target) {
		if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
		(target as HTMLElement).focus();
	}
}

/**
 * Move focus to the first visible, enabled form control (input/select/textarea) inside a
 * container. Used after advancing a step ("Next") or entering a form view so a keyboard /
 * screen-reader user lands ready to fill it in, instead of on a now-hidden button. Skips
 * controls inside a hidden ancestor (e.g. the swapped board-selector / upload group). Returns
 * true if it focused something.
 */
export function focusFirstField(containerId: string): boolean {
	const root = document.getElementById(containerId);
	if (!root) return false;
	const controls = Array.from(root.querySelectorAll<HTMLElement>(
		'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])'));
	for (const el of controls) {
		if (el.closest('.hidden, [hidden]')) continue;
		el.focus();
		return true;
	}
	return false;
}

/** Get element by ID with type safety */
export function getElement<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null;
}

/** Get input value trimmed */
export function getInputValue(id: string): string {
	const input = document.getElementById(id) as HTMLInputElement | null;
	return input?.value?.trim() || '';
}

/** Get selected radio value */
export function getSelectedRadio(containerSelector: string, name: string): string | null {
	const radio = document.querySelector(`${containerSelector} input[name="${name}"]:checked`) as HTMLInputElement;
	return radio?.value || null;
}

/**
 * Writes text to the clipboard, falling back to the legacy execCommand path. The async
 * Clipboard API (`navigator.clipboard`) only exists in a SECURE context (HTTPS or
 * localhost); when two players share a game over a plain-HTTP LAN address it is
 * `undefined`, which previously threw and surfaced a copy error. The textarea +
 * `execCommand('copy')` fallback works there (still inside the click user-gesture).
 */
async function writeToClipboard(text: string): Promise<boolean> {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch (err) {
			console.debug('Clipboard API failed, falling back to execCommand:', err);
		}
	}
	return copyViaExecCommand(text);
}

/** Legacy clipboard copy via a transient off-screen textarea. */
function copyViaExecCommand(text: string): boolean {
	const textarea = document.createElement('textarea');
	textarea.value = text;
	// Keep it out of view and the layout/accessibility flow.
	textarea.setAttribute('readonly', '');
	textarea.setAttribute('aria-hidden', 'true');
	textarea.style.position = 'fixed';
	textarea.style.top = '-9999px';
	textarea.style.opacity = '0';
	document.body.appendChild(textarea);
	try {
		textarea.select();
		return document.execCommand('copy');
	} catch (err) {
		console.error('Error copying to clipboard:', err);
		return false;
	} finally {
		document.body.removeChild(textarea);
	}
}

/** Copy text to clipboard with visual feedback */
export async function copyToClipboard(text: string, buttonId?: string): Promise<boolean> {
	const copied = await writeToClipboard(text);
	if (copied && buttonId) {
		const btn = document.getElementById(buttonId);
		if (btn) {
			const originalText = btn.textContent;
			btn.textContent = t('lobby.copied', 'Copied!');
			setTimeout(() => { btn.textContent = originalText; }, 1500);
		}
	}
	return copied;
}

/** The history-state shape the lobby pushes when it navigates between top-level views. */
export interface LobbyHistoryState { lobbyView?: LobbyView; }

/**
 * The lobby view a `popstate` entry represents, so the browser Back/Forward buttons move
 * between lobby views instead of leaving the site. Entries we didn't tag (the initial load,
 * or the `{gameId}` entry pushed on game creation) fall back to home — Back from the create
 * or join form lands on the games list, which is the whole point.
 */
export function lobbyViewFromState(state: unknown): LobbyView {
	const view = (state as LobbyHistoryState | null)?.lobbyView;
	return view && (LOBBY_VIEWS as readonly string[]).includes(view) ? view : 'view-home';
}

/** Update URL with game params */
export function updateUrlWithGame(gameId: string): void {
	const url = new URL(window.location.href);
	url.searchParams.set('gameId', gameId);
	url.searchParams.delete('code');
	window.history.pushState({ gameId }, '', url.toString());
}

/** Clear URL params */
export function clearUrlParams(): void {
	const url = new URL(window.location.href);
	url.searchParams.delete('gameId');
	url.searchParams.delete('code');
	window.history.replaceState({}, '', url.toString());
}

/** Get URL search param */
export function getUrlParam(name: string): string | null {
	return new URLSearchParams(window.location.search).get(name);
}

/** One entry of a <select>: what it submits, and what it reads as. */
export interface SelectOption {
	readonly value: string;
	readonly label: string;
}

/**
 * Fill a `<select>`, but only touch the DOM when the choices have actually CHANGED.
 *
 * Reported from a real session: choosing a game made a screen reader suddenly read the player-count
 * combo's selected text, out of nowhere. Staging a board rebuilt that select's whole option list
 * every time — including when the new board offered exactly the same range — and it does so inside
 * a form whose `aria-busy` is flipping back to false, which is precisely when a screen reader
 * re-reads what changed underneath it. A rebuilt `<select>` re-reads as its selected option.
 *
 * The list was identical before and after, so the honest fix is not to announce less: it is not to
 * change anything. Rebuilding a control to the state it was already in is work nobody asked for,
 * and assistive technology is right to report it.
 *
 * Returns whether anything was rebuilt, so a caller can decide what a genuinely new set of choices
 * should default to without disturbing one the reader has already answered.
 */
export function syncSelectOptions(
	select: HTMLSelectElement,
	options: readonly SelectOption[],
): boolean {
	const current = Array.from(select.options);
	const unchanged = current.length === options.length
		&& current.every((option, index) =>
			option.value === options[index].value && option.textContent === options[index].label);
	if (unchanged) return false;

	select.replaceChildren(...options.map(entry => {
		const option = document.createElement('option');
		option.value = entry.value;
		option.textContent = entry.label;
		return option;
	}));
	return true;
}
