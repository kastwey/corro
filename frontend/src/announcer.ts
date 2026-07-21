import { tSync, i18nBinder } from './i18nBinder.js';
import { pickLocale } from './localizeSquare.js';
import type { AnnouncementEvent } from './gameClient.js';

const SELF_SUFFIX = '_self';
const VICTIM_SUFFIX = '_victim';
const VICTIM_TEAM_SUFFIX = '_victim_team';

/**
 * Translate a server announcement key, falling back to the base key when the
 * first-person `<key>_self` variant has no translation.
 *
 * The server is the source of the spoken voice and personalizes by audience: it
 * sends `<key>_self` to the acting player, `<key>_victim` to an attack's target (card
 * families) and `<key>` to everyone else. Most—but not all—events have every dedicated
 * variant, so when `_self`/`_victim` is missing we gracefully read the third-person base
 * instead of an untranslated key.
 *
 * Pure and translator-injected so it can be unit-tested without i18next/DOM.
 */
export function translateWithSelfFallback(
	key: string,
	vars: Record<string, any> | undefined,
	translate: (k: string, v?: any) => string
): string {
	const resolved = resolveBankDebtKey(key, vars);
	const direct = translate(resolved, vars);
	// tSync returns the key unchanged when no translation exists.
	if (direct !== resolved) return direct;
	// A TEAM-victim line (journey pairs) falls back down the chain: plural → singular → base.
	if (resolved.endsWith(VICTIM_TEAM_SUFFIX)) {
		const singular = resolved.slice(0, -'_team'.length);
		const asVictim = translate(singular, vars);
		if (asVictim !== singular) return asVictim;
		return translate(singular.slice(0, -VICTIM_SUFFIX.length), vars);
	}
	for (const suffix of [SELF_SUFFIX, VICTIM_SUFFIX]) {
		if (resolved.endsWith(suffix)) {
			const base = resolved.slice(0, -suffix.length);
			return translate(base, vars);
		}
	}
	return direct;
}

/**
 * The server tags a debt owed to the bank with the literal creditor token "bank" and reuses the
 * generic `game.debt_created` line ("… to {{creditor}}"). Interpolating the raw token reads wrong
 * ("to bank" / "a el banco"), so for bank debts we redirect to a dedicated, grammatical line
 * (`game.debt_created_bank`). Player-name creditors keep the generic line untouched.
 */
function resolveBankDebtKey(key: string, vars: Record<string, any> | undefined): string {
	if (typeof vars?.creditor === 'string'
		&& vars.creditor.toLowerCase() === 'bank'
		&& key.startsWith('game.debt_created')) {
		return key.replace('game.debt_created', 'game.debt_created_bank');
	}
	return key;
}

/**
 * Resolve any localized-text var — a `{ locale: text }` map, e.g. a bilingual board's square name
 * passed by the server — to the given language before interpolation, so each player reads names in
 * their own language (falling back to any available translation). Plain string/number vars are
 * untouched, so classic single-language games are unaffected.
 */
export function resolveLocalizedVars(
	vars: Record<string, any> | undefined,
	lang: string
): Record<string, any> | undefined {
	if (!vars) return vars;
	let out: Record<string, any> | undefined;
	for (const [key, value] of Object.entries(vars)) {
		if (isLocalizedMap(value)) {
			out ??= { ...vars };
			out[key] = pickLocale(value, lang);
		}
	}
	return out ?? vars;
}

/** A plain object whose values are all strings — the shape of a localized-text map. */
function isLocalizedMap(value: any): value is Record<string, string> {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
	const values = Object.values(value);
	return values.length > 0 && values.every(v => typeof v === 'string');
}

/**
 * The team-var convention: a server announcement that names a SHARED journey seat sends
 * `__team:<colorId>` as the var's value ("__team:red"); each client resolves it here into
 * the localized team word ("Red team") before interpolation. Plain values
 * pass through untouched.
 */
export function resolveTeamVars(
	vars: Record<string, any> | undefined,
	tSync: (key: string, vars?: Record<string, any>) => string,
): Record<string, any> | undefined {
	if (!vars) return vars;
	let out: Record<string, any> | undefined;
	for (const [key, value] of Object.entries(vars)) {
		if (typeof value === 'string' && value.startsWith('__team:')) {
			out ??= { ...vars };
			out[key] = tSync('game.journey_team', { color: tSync(`game.color_${value.slice(7)}`) });
		}
	}
	return out ?? vars;
}

/**
 * The token-var convention: a server announcement that wants to speak a player's PIECE
 * ("You fill your lorry's tank") sends `tokenId`; the client resolves it here into the
 * token's localized name as `{{token}}`, in each listener's own language. Announcements
 * without a tokenId (or that already carry an explicit token) pass through untouched.
 */
export function resolveTokenVar(
	vars: Record<string, any> | undefined,
	t: (key: string) => string,
): Record<string, any> | undefined {
	if (!vars || typeof vars.tokenId !== 'string' || vars.tokenId === '' || vars.token !== undefined) return vars;
	return { ...vars, token: t(`tokens.${vars.tokenId}`) };
}

/**
 * Recompute the history cursor after a new announcement is appended (and any front-trim of
 * the overflowing buffer). Pure so the cursor rule can be unit-tested without DOM/i18next.
 *
 * - At the live edge (cursor -1, not browsing): stay live, so the next backwards step starts
 *   from the newest message.
 * - While reviewing an OLDER entry: keep the cursor on the SAME logical entry instead of
 *   jumping to the bottom, shifting it down by however many entries were trimmed off the
 *   front; if the very entry under review was trimmed away, clamp to the oldest survivor.
 */
export function adjustHistoryCursorAfterPush(cursor: number, trimmed: number): number {
	if (cursor === -1) return -1;
	return Math.max(0, cursor - trimmed);
}

export interface AnnounceOptions {
	/** Jump to the front of the queue (urgent messages such as errors). */
	priority?: boolean;
	/**
	 * Speak immediately via the assertive live region, bypassing the polite queue
	 * and its inter-message delay. Use for user-initiated info (checking money,
	 * board navigation) that must be heard right away rather than waiting behind
	 * queued game-event announcements.
	 */
	instant?: boolean;
	/**
	 * Deliver this line's batch through the ASSERTIVE region while keeping the polite
	 * pipeline's everything else (ordering, coalescing, history, the announcement gate).
	 * For the player's OWN action feedback: when the played card leaves the hand, the
	 * screen reader announces the newly-focused row FIRST and a polite line queues behind
	 * it — tedious to sit through. Assertive interrupts that focus reading instead.
	 */
	assertive?: boolean;
}

export type AnnounceFn = (event: AnnouncementEvent, options?: AnnounceOptions) => void;

/**
 * Coalescing announcer for a single ARIA live region.
 *
 * Why coalesce instead of queueing with delays: an ARIA live region is
 * fire-and-forget. Writing to it several times in quick succession makes each
 * write clobber the previous one, so a screen reader only reads the last. The
 * naive fix (spacing writes out with a fixed delay) adds noticeable latency and
 * reads choppy.
 *
 * Instead we gather the announcements that arrive within the SAME synchronous batch and
 * emit them as ONE utterance joined by periods ("Has sacado 6 y 3. Caes en Elda. Precio
 * 120 euros."). A whole server batch is handed to us in one synchronous loop, so we flush
 * on the next tick (zero added latency) rather than waiting out a timed window. The reader
 * speaks the lines in order with natural pauses and nothing is clobbered.
 */
class AnnouncerQueue {
	private liveRegion: HTMLElement;
	private assertiveRegion: HTMLElement;
	private batch: string[] = [];
	private flushTimer: number | null = null;
	private clearTimer: number | null = null;
	private liveTextClearTimer: number | null = null;
	private assertiveTextClearTimer: number | null = null;
	/**
	 * Utterance scheduled for writing during the `clearGapMs` window but not yet shown.
	 * If another batch flushes inside that window we MERGE into this instead of clobbering,
	 * so a "move" line (dice roll) and an immediately-following "resolve" line that did not
	 * involve token movement (e.g. staying in holding) are spoken together rather than the
	 * first being silently dropped when its pending write is cancelled.
	 */
	private pendingUtterance = '';
	/** Instant (assertive) messages collected within the current tick, flushed together. */
	private instantBatch: string[] = [];
	private instantTimer: number | null = null;
	/** The current polite batch must flush through the ASSERTIVE region (own-action story). */
	private batchAssertive = false;
	/** Rolling history of spoken game announcements, oldest first. */
	private history: string[] = [];
	/** Index into history currently under review; -1 means "live" (not browsing). */
	private historyCursor = -1;
	/** Timestamp (performance.now) of the last polite utterance written to the live region. */
	private lastLiveWriteAt = 0;
	/** Maximum number of past announcements kept for review. */
	private readonly maxHistory = 50;
	/**
	 * Delay (ms) before flushing the polite batch. Zero: a whole server batch arrives in
	 * one synchronous loop, so a 0-ms timer fires once AFTER the loop, coalescing the burst
	 * into a single utterance with no perceptible latency. (It is no longer a timed window
	 * that waits for trickling messages — the client now receives each action's events all
	 * at once.)
	 */
	private readonly coalesceMs = 0;
	private readonly clearGapMs = 40;
	/**
	 * How long an utterance stays in the live region before it is wiped. The
	 * region is visually hidden but still reachable by a screen reader's virtual
	 * cursor in browse mode, so we remove stale text shortly after it has been
	 * spoken to avoid re-reading old announcements at the bottom of the page. The
	 * mutation has already been captured by the reader by the time this fires, so a
	 * short delay is enough — long enough not to race the announcement, short enough
	 * that browse mode does not surface a stale line.
	 *
	 * Kept at 500 ms because VoiceOver is the slowest reader: wiping the region while VO is
	 * still speaking a longer line could make it drop the NEXT identical announcement (a value
	 * queried twice in a row went silent the second time). 500 ms lets VO finish before the
	 * region resets, while still clearing well before browse mode would surface a stale line.
	 */
	private readonly clearTextAfterMs = 500;

	constructor() {
		this.liveRegion = this.resolveLiveRegion('sr-live', 'polite');
		this.assertiveRegion = this.resolveLiveRegion('sr-live-assertive', 'assertive');
	}

	private resolveLiveRegion(id: string, politeness: 'polite' | 'assertive'): HTMLElement {
		let region = document.getElementById(id);
		if (!region) {
			region = document.createElement('div');
			region.id = id;
			region.className = 'sr-live';
			region.setAttribute('aria-live', politeness);
			region.setAttribute('aria-atomic', 'true');
			document.body.appendChild(region);
		}
		return region;
	}

	/**
	 * Move the live regions into `host` (e.g. an open modal <dialog>) so announcements
	 * keep being spoken while the dialog is up. A native modal (showModal()) makes the
	 * rest of the page `inert`, and a backgrounded aria-live region is not reliably
	 * announced by screen readers (notably JAWS), so the regions must live INSIDE the
	 * modal's top-layer subtree. Pass null to restore them to <body> when it closes.
	 */
	setHost(host: HTMLElement | null): void {
		const parent = host ?? document.body;
		parent.appendChild(this.liveRegion);
		parent.appendChild(this.assertiveRegion);

		// When a modal closes, an announcement that was just written into the (now
		// torn-down) modal-hosted live region can be dropped by the screen reader as the
		// accessibility context changes — the user activates something, it announces, and
		// the dialog unmounts before the line is read. If a polite announcement was written
		// very recently, re-emit it in the restored <body> region so it is reliably heard.
		// The recency gate keeps closing a modal long after an event from re-reading a
		// stale line.
		if (host === null) {
			const text = this.liveRegion.textContent;
			const fresh = performance.now() - this.lastLiveWriteAt < this.coalesceMs + this.clearGapMs + 200;
			if (text && fresh) {
				this.liveRegion.textContent = '';
				window.setTimeout(() => { this.liveRegion.textContent = text; }, 0);
			}
		}
	}

	announce(event: AnnouncementEvent, options: AnnounceOptions = {}): void {
		let text: string;
		try {
			text = this.translate(event);
		} catch (e) {
			console.debug('announce error', e);
			return;
		}
		if (!text) return;

		// Record the (already-translated) line in the navigable history so the
		// player can review past announcements with the history shortcuts. Instant
		// lines (board navigation, on-demand queries, history playback itself) are
		// transient and deliberately excluded.
		if (!options.instant) {
			this.pushHistory(text);
		}

		// Instant: speak right now through the assertive region, bypassing the
		// coalescing batch entirely.
		if (options.instant) {
			this.speakInstant(text);
			return;
		}

		if (options.priority) {
			this.batch.unshift(text);
		} else {
			this.batch.push(text);
		}
		// One assertive line upgrades its WHOLE coalesced batch (a batch is one action's
		// story — splitting it across regions would read out of order).
		if (options.assertive) this.batchAssertive = true;
		this.scheduleFlush();
	}

	/** Speak text immediately via the assertive region (interrupts the reader). */
	private speakInstant(text: string): void {
		const message = this.withPeriod(text);
		console.debug(`[SR] +${Math.round(performance.now())}ms ASSERTIVE <- "${message}"`);
		// Coalesce a burst of instant messages that arrive within the same tick into ONE
		// assertive utterance. Writing several times before the flush makes each write
		// clobber the previous one (the reader only ever speaks the last value), so e.g. a
		// navigation command that voices "who" and then "where" would drop the first line.
		// Collect them and flush once on a 0 ms timer instead.
		//
		// We deliberately use setTimeout, NOT requestAnimationFrame: rAF is PAUSED while the
		// tab is in the background, so an instant announcement made in a backgrounded window
		// (e.g. one of two windows used to test multiplayer) would never be spoken and would
		// pile up in the batch, only to be flushed as a confusing merged burst when the
		// window regained focus ("I pressed C and heard my money plus a stale 'no auction'").
		// setTimeout still fires in the background, so each line is spoken promptly.
		this.instantBatch.push(message);
		if (this.instantTimer !== null) return;
		// Clear the region first, then write on the next tick. The empty → text transition
		// is a real DOM mutation even when the message is identical to what was just
		// announced, so the reader reliably re-speaks a repeated line (e.g. querying the
		// same value twice in a row). A bare trailing space is silently deduped by some
		// readers (notably JAWS), which is why the old approach went mute.
		this.assertiveRegion.textContent = '';
		this.instantTimer = window.setTimeout(() => {
			this.instantTimer = null;
			const utterance = this.instantBatch.join(' ');
			this.instantBatch = [];
			this.assertiveRegion.textContent = utterance;
			this.scheduleAssertiveTextClear();
		}, 0);
	}

	private translate(event: AnnouncementEvent): string {
		// _raw is a special key for already-translated text.
		if (event.key === '_raw') {
			return event.vars?.text ?? '';
		}

		// Resolve any localized-text vars (e.g. a package board's square name) to this player's
		// language before interpolation, the __team convention into the team's word ("Red team")
		// and the tokenId convention into the piece's name ({{token}}: "…your lorry").
		const vars = resolveTokenVar(
			resolveTeamVars(
				resolveLocalizedVars(event.vars, i18nBinder.getCurrentLanguage()),
				(key, v) => tSync(key, v)),
			key => tSync(key));
		const translated = translateWithSelfFallback(event.key, vars, tSync);

		if (translated === event.key) {
			console.warn(`Translation not found for: "${event.key}", language: ${window.i18next?.language}`);
		}
		return translated;
	}

	/**
	 * Flush the pending OWN-ACTION (assertive) batch RIGHT NOW, synchronously. The turn
	 * sequencer delivers the announcements and THEN applies the state (which repaints the
	 * hand and moves focus off the played card). If the assertive line only lands on a
	 * later tick, the screen reader has already begun reading the newly-focused card. Writing
	 * it here — before the state applies — puts the player's own move ahead of that focus
	 * reading. Only the assertive batch is fast-tracked; a polite batch keeps its normal
	 * coalescing flush.
	 */
	flushNow(): void {
		if (!this.batchAssertive || this.batch.length === 0) return;
		if (this.flushTimer !== null) { window.clearTimeout(this.flushTimer); this.flushTimer = null; }
		const utterance = this.batch.map(t => this.withPeriod(t)).join(' ');
		this.batch = [];
		this.batchAssertive = false;
		// Clear then set in the SAME tick: the region ends on the utterance (the empty step is
		// not observed), so a change from the previous line is announced assertively at once.
		this.assertiveRegion.textContent = '';
		this.assertiveRegion.textContent = utterance;
		this.scheduleAssertiveTextClear();
		console.debug(`[SR] +${Math.round(performance.now())}ms ASSERTIVE(sync) <- "${utterance}"`);
	}

	/** (Re)arm the coalesce timer so a settling burst flushes as one utterance. */
	private scheduleFlush(): void {
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
		}
		this.flushTimer = window.setTimeout(() => this.flush(), this.coalesceMs);
	}

	private flush(): void {
		this.flushTimer = null;
		if (this.batch.length === 0) return;

		// Join the burst into a single utterance; periods give the reader natural
		// pauses between the individual lines.
		const utterance = this.batch.map(t => this.withPeriod(t)).join(' ');
		this.batch = [];

		// An own-action batch goes out ASSERTIVE: it interrupts the focus-change reading
		// (the next card's name) instead of queueing politely behind it. Same
		// clear-then-write trick so an identical utterance is still re-spoken.
		if (this.batchAssertive) {
			this.batchAssertive = false;
			this.assertiveRegion.textContent = '';
			window.setTimeout(() => {
				console.debug(`[SR] +${Math.round(performance.now())}ms ASSERTIVE(batch) <- "${utterance}"`);
				this.assertiveRegion.textContent = utterance;
				this.scheduleAssertiveTextClear();
			}, 0);
			return;
		}

		// If a previous utterance is still queued for writing (within the clear gap) it has
		// NOT been spoken yet — the region is empty during that window. Merge rather than
		// clobber so the earlier line (e.g. the dice roll) is not dropped when a second,
		// movement-less line (e.g. staying in holding) arrives right behind it.
		this.pendingUtterance = this.pendingUtterance
			? `${this.pendingUtterance} ${utterance}`
			: utterance;

		// Clear first so an identical consecutive utterance is still re-announced.
		if (this.clearTimer !== null) window.clearTimeout(this.clearTimer);
		this.liveRegion.textContent = '';
		this.clearTimer = window.setTimeout(() => {
			this.clearTimer = null;
			const text = this.pendingUtterance;
			this.pendingUtterance = '';
			console.debug(`[SR] +${Math.round(performance.now())}ms POLITE <- "${text}"`);
			this.liveRegion.textContent = text;
			this.lastLiveWriteAt = performance.now();
			this.scheduleTextClear();
		}, this.clearGapMs);
	}

	/**
	 * Wipe the polite live region's text shortly after it has been announced, so
	 * the stale message cannot be re-read with the virtual cursor in browse mode.
	 */
	private scheduleTextClear(): void {
		if (this.liveTextClearTimer !== null) window.clearTimeout(this.liveTextClearTimer);
		this.liveTextClearTimer = window.setTimeout(() => {
			this.liveTextClearTimer = null;
			this.liveRegion.textContent = '';
		}, this.clearTextAfterMs);
	}

	/**
	 * Wipe the assertive live region after an instant message has been announced. Like the
	 * polite region it is visually hidden but still reachable by the virtual cursor, so a
	 * stale instant line (board navigation, an on-demand query, history playback) would
	 * otherwise sit at the bottom of the page to be re-read in browse mode.
	 */
	private scheduleAssertiveTextClear(): void {
		if (this.assertiveTextClearTimer !== null) window.clearTimeout(this.assertiveTextClearTimer);
		this.assertiveTextClearTimer = window.setTimeout(() => {
			this.assertiveTextClearTimer = null;
			this.assertiveRegion.textContent = '';
		}, this.clearTextAfterMs);
	}

	private withPeriod(text: string): string {
		const trimmed = text.trim();
		return /[.!?]$/.test(trimmed) ? trimmed : trimmed + '.';
	}

	// ────────────────────────────────────────────────────────────────────────
	// Announcement history (review past messages)
	//
	// A coalesced burst can read several lines at once, so a player may miss an
	// individual line. The history stores each line separately and lets the
	// player step through them with the keyboard. Playback uses the assertive
	// region (instant) so it is heard right away and is itself NOT re-recorded.
	// ────────────────────────────────────────────────────────────────────────

	/**
	 * Append a spoken line to history, capping size and keeping the review cursor stable.
	 *
	 * If the player is at the live edge (cursor -1, not browsing) we stay there, so the
	 * next backwards step starts from the newest message. But if they are reviewing an
	 * OLDER entry, a freshly-arrived announcement must NOT yank them to the bottom — keep
	 * the cursor on the SAME entry they were reading (adjusting for any front-trim that
	 * shifted indices down when the history overflowed).
	 */
	private pushHistory(text: string): void {
		const cursorBefore = this.historyCursor;
		this.history.push(text);
		let trimmed = 0;
		if (this.history.length > this.maxHistory) {
			trimmed = this.history.length - this.maxHistory;
			this.history.splice(0, trimmed);
		}
		this.historyCursor = adjustHistoryCursorAfterPush(cursorBefore, trimmed);
	}

	/** Speak the history entry at index (with a position cue) via the assertive region. */
	private readHistoryEntry(index: number): void {
		this.historyCursor = index;
		const pos = tSync('game.history_position', { index: index + 1, total: this.history.length });
		this.speakInstant(`${this.history[index]}. ${pos}`);
	}

	/** Move to the previous (older) message; the first step lands on the newest. */
	historyPrev(): void {
		if (this.history.length === 0) { this.speakInstant(tSync('game.history_empty')); return; }
		const index = this.historyCursor === -1
			? this.history.length - 1
			: Math.max(0, this.historyCursor - 1);
		this.readHistoryEntry(index);
	}

	/** Move to the next (newer) message; at the newest boundary it repeats the latest entry. */
	historyNext(): void {
		if (this.history.length === 0) { this.speakInstant(tSync('game.history_empty')); return; }
		if (this.historyCursor === -1 || this.historyCursor >= this.history.length - 1) {
			this.readHistoryEntry(this.history.length - 1);
			return;
		}
		this.readHistoryEntry(this.historyCursor + 1);
	}

	/** Jump to the oldest message in history. */
	historyFirst(): void {
		if (this.history.length === 0) { this.speakInstant(tSync('game.history_empty')); return; }
		this.readHistoryEntry(0);
	}

	/** Jump to the newest message in history. */
	historyLast(): void {
		if (this.history.length === 0) { this.speakInstant(tSync('game.history_empty')); return; }
		this.readHistoryEntry(this.history.length - 1);
	}
}

// Module singleton: there is exactly one live region for the page.
let queue: AnnouncerQueue | null = null;

/** Create (or reuse) the page announcer and return its announce function. */
export function createAnnouncer(): AnnounceFn {
	if (!queue) {
		queue = new AnnouncerQueue();
	}
	const instance = queue;
	return (event: AnnouncementEvent, options?: AnnounceOptions) => instance.announce(event, options);
}

/**
 * Host the live regions inside a given element (an open modal <dialog>) so screen
 * readers keep announcing while the background is inert. Pass null to restore them to
 * <body> when the dialog closes.
 */
export function setAnnouncerHost(host: HTMLElement | null): void {
	queue?.setHost(host);
}

/**
 * Flush a pending own-action assertive batch synchronously (see {@link AnnouncerQueue.flushNow}).
 * Call it right after announcing an own action and BEFORE applying the state that moves focus,
 * so the move is voiced ahead of the newly-focused card. A no-op if nothing is pending.
 */
export function flushAnnouncerNow(): void {
	queue?.flushNow();
}

/** Read the previous (older) announcement from history. */
export function announceHistoryPrev(): void {
	queue?.historyPrev();
}

/** Read the next (newer) announcement from history. */
export function announceHistoryNext(): void {
	queue?.historyNext();
}

/** Jump to and read the oldest announcement in history. */
export function announceHistoryFirst(): void {
	queue?.historyFirst();
}

/** Jump to and read the newest announcement in history. */
export function announceHistoryLast(): void {
	queue?.historyLast();
}
