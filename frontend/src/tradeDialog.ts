// tradeDialog.ts - Accessible player-to-player trade modals built on native <dialog>.
//
// Three states share one <dialog>:
//   * BUILDER  — the proposer picks a partner and the assets for each side, then proposes.
//   * REVIEW   — the target reads the offer and accepts or declines.
//   * WAITING  — the proposer is frozen until the partner responds, and may cancel.
//
// Voice ownership: the SERVER announces every trade event (proposed / completed / declined /
// cancelled). These dialogs stay SILENT — they are purely the action surface. While open we
// host the aria-live regions inside the dialog (the modal makes <body> inert) and trap Tab so
// keyboard focus cannot escape mid-trade.
//
// Pure helpers (tradeableProperties / summarizeSide) are exported for unit testing without DOM.

import { tSync, money, localizeColor, i18nBinder } from './i18nBinder.js';
import { groupDisplayName } from './localizeSquare.js';
import { setAnnouncerHost } from './announcer.js';
import { makeDialogDraggable } from './dialogDrag.js';
import { RovingCheckboxList } from './accessibleList.js';
import { MORTGAGE_RATE } from './managePropertiesDialog.js';
import { isOwnableSquare } from './squareBehavior.js';
import type { Player, Square, TradeSideDto, TradePropertyDto } from './models.js';

const t = (key: string, vars?: Record<string, any>) => tSync(`game.${key}`, vars);

export interface TradeOfferInput {
	properties: number[];
	money: number;
	releasePasses: number;
}

export interface TradeBuilderOptions {
	myPlayer: Player;
	others: Player[];
	squares: Square[];
	/** Pre-select this partner in the target dropdown (e.g. opened from the players panel). */
	preselectedTargetId?: string;
	/** Live reads so the caps track the game while the builder is open: if the partner mortgages
	 *  to raise cash mid-build, the "request money" cap must grow. Fall back to the snapshots. */
	getPlayers?: () => Player[];
	getSquares?: () => Square[];
	onPropose: (targetId: string, offered: TradeOfferInput, requested: TradeOfferInput) => void | Promise<void>;
}

export interface TradeReviewOptions {
	initiatorName: string;
	/** What the initiator gives away — i.e. what I (the target) receive. */
	offered: TradeSideDto;
	/** What I (the target) give away. */
	requested: TradeSideDto;
	/** The live board squares, for the valuation line (mortgage-aware property values). */
	squares: Square[];
	onAccept: () => void | Promise<void>;
	onDecline: () => void | Promise<void>;
}

export interface TradeWaitingOptions {
	targetName: string;
	onCancel: () => void | Promise<void>;
}

// ── Pure helpers (testable without a DOM) ─────────────────────────────────────

// The shared behaviour-aware check: package boards call their ownable groups anything
// (galactico's stations are type "transit"), so a type triple here dropped them from trades.

/** True when the square — or any square in its colour group — carries houses or a hotel. */
function groupHasBuildings(squares: Square[], square: Square): boolean {
	if ((square.smallBuildings ?? 0) > 0 || (square.bigBuildings ?? 0) > 0) return true;
	if (!square.color) return false;
	return squares.some(s => s.color === square.color && ((s.smallBuildings ?? 0) > 0 || (s.bigBuildings ?? 0) > 0));
}

/**
 * Properties a player can legally put in a trade: those they own whose colour group has no
 * buildings. Mirrors the server's GROUP_HAS_BUILDINGS rule so the builder never offers an
 * illegal selection. Uses the array index as the canonical square index.
 */
export function tradeableProperties(squares: Square[], ownerId: string): TradePropertyDto[] {
	const result: TradePropertyDto[] = [];
	squares.forEach((s, idx) => {
		if (s.ownerId !== ownerId) return;
		if (!isOwnableSquare(s)) return;
		if (groupHasBuildings(squares, s)) return;
		result.push({ index: idx, name: s.name, color: s.color, groupNameKey: s.groupNameKey, price: s.price });
	});
	return result;
}

/** One traded property as "Name (group, 150₡)" — its name plus, when known, its colour group
 *  and its price in the board's currency. Shared by the visible review text and the accessible
 *  summary so a screen-reader user hears the group and the price too (live-play: the review
 *  didn't say which GROUP a received property belonged to, and that is the whole basis for
 *  weighing an offer), always in the board currency (never a hardcoded "€"/"euros"). */
export function tradePropertyLabel(p: TradePropertyDto, formatMoney: (v: number) => string = money): string {
	const group = groupDisplayName(p, tSync, localizeColor);
	const details = [group, p.price ? formatMoney(p.price) : ''].filter(Boolean).join(', ');
	return details ? `${p.name} (${details})` : p.name;
}

/** Join items the way a SPOKEN sentence needs them — "A, B y C" / "A, B, and C". The screen
 *  reader hears a composed label as one line, so the last connector carries the flow; visual
 *  separators ("·", ";") don't speak and leave a soup of juxtaposed facts. */
export function joinList(items: string[], lang: string = i18nBinder.getCurrentLanguage()): string {
	try {
		return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(items);
	} catch {
		return items.join(', ');
	}
}

/** Human-readable summary of one side of a trade (for review text + aria), flowing as ONE
 *  sentence: "Elda (150₡), 200₡ in cash and 1 release pass". Money is worded as cash so
 *  it can't be mistaken for one more property price when heard in a row of figures. */
export function summarizeSide(
	side: TradeSideDto,
	translate: (k: string, v?: Record<string, any>) => string = t,
	lang?: string
): string {
	const parts: string[] = [];
	for (const p of side.properties) parts.push(tradePropertyLabel(p));
	if (side.money > 0) parts.push(translate('trade_cash', { amount: money(side.money) }));
	if (side.releasePasses > 0) parts.push(translate('trade_release_passes_count', { count: side.releasePasses }));
	return parts.length > 0 ? joinList(parts, lang) : translate('trade_nothing');
}

/** CSS-safe colour-group slug (e.g. "Light Blue" -> "lightblue"), or '' when no colour. */
export function colorGroupSlug(color?: string): string {
	return color ? color.toLowerCase().replace(/[^a-z]/g, '') : '';
}

// ── Trade valuation ("monetary justice") ──────────────────────────────────────
// A purely-monetary estimate shown before the Propose button so a player can see, at a
// glance, what each side is worth and whether the swap is fair. It is deliberately a
// rough guide ("counting money only") — it ignores strategic value (completing a colour
// group, denying an opponent, etc.).

/** Standard "get out of holding free" card worth, used only for the fairness estimate. */
export const RELEASE_PASS_TRADE_VALUE = 50;

/** Monetary worth of one property for the estimate: its price, or half (the mortgage
 *  value) when mortgaged. A missing/unknown square is worth 0. */
export function propertyTradeValue(square: Square | undefined): number {
	if (!square) return 0;
	const price = square.price ?? 0;
	return square.mortgaged ? Math.floor(price * MORTGAGE_RATE) : price;
}

/** Total monetary worth of one side of a trade (properties + cash + release passes). */
export function tradeSideValue(
	squares: Square[],
	propertyIndices: number[],
	money: number,
	releasePasses: number
): number {
	const props = propertyIndices.reduce((sum, idx) => sum + propertyTradeValue(squares[idx]), 0);
	return props + Math.max(0, money) + Math.max(0, releasePasses) * RELEASE_PASS_TRADE_VALUE;
}

export type TradeFairness = 'favorable' | 'fair' | 'unfavorable';

/** Verdict for the proposer: compares what they receive against what they give. A small
 *  tolerance band counts as "fair" so a near-even swap doesn't read as a win or a loss. */
export function tradeFairness(giveValue: number, receiveValue: number): TradeFairness {
	const diff = receiveValue - giveValue;
	const tolerance = Math.max(10, Math.round(Math.max(giveValue, receiveValue) * 0.05));
	if (diff > tolerance) return 'favorable';
	if (diff < -tolerance) return 'unfavorable';
	return 'fair';
}

/** Builds the localized valuation sentence shown before the Propose button. Pure (takes
 *  its translator) so it can be unit-tested without a DOM. */
export function tradeValuationText(
	giveValue: number,
	receiveValue: number,
	translate: (k: string, v?: Record<string, any>) => string = t
): string {
	const verdict = translate('trade_verdict_' + tradeFairness(giveValue, receiveValue));
	return translate('trade_valuation_summary', { give: giveValue, receive: receiveValue, verdict });
}

/** The same "monetary justice" sentence for the REVIEW dialog, from the TARGET's
 *  perspective: they RECEIVE the offered side and GIVE the requested one. Uses the local
 *  board squares so mortgaged lots count at mortgage value, exactly as in the builder. */
export function tradeReviewValuationText(
	squares: Square[],
	offered: TradeSideDto,
	requested: TradeSideDto,
	translate: (k: string, v?: Record<string, any>) => string = t
): string {
	const receiveValue = tradeSideValue(squares, offered.properties.map(p => p.index), offered.money, offered.releasePasses);
	const giveValue = tradeSideValue(squares, requested.properties.map(p => p.index), requested.money, requested.releasePasses);
	return tradeValuationText(giveValue, receiveValue, translate);
}

// ── Amount validation (no silent clamping) ────────────────────────────────────
// Live-play: the builder used to CLAMP an over-the-cap amount silently when proposing, so a
// player could type more money than the partner has and the trade went out altered without
// any feedback — the partner saw a different number and nobody understood why. Amounts are
// now validated and an over-cap value blocks the proposal with an explicit, spoken error.

export type AmountIssue = 'invalid' | 'over' | null;

/** Checks a money/release-passes input against its cap. `null` = usable ('' counts as 0 while
 *  editing); 'invalid' = not a non-negative integer; 'over' = more than the side owns. */
export function amountInputIssue(raw: string, max: number): AmountIssue {
	const trimmed = raw.trim();
	if (trimmed === '') return null;
	const n = Number(trimmed);
	if (!Number.isInteger(n) || n < 0) return 'invalid';
	return n > max ? 'over' : null;
}

/**
 * A small colour-group swatch for a traded property. Purely visual (`aria-hidden`): a
 * sighted player sees which colour street is changing hands at a glance, while the spoken
 * voice/aria-label still carries the property name. Reuses the board's `group-*` palette.
 */
function colorSwatchHtml(color?: string): string {
	const slug = colorGroupSlug(color);
	return `<span class="trade-prop-swatch${slug ? ' group-' + slug : ''}" aria-hidden="true"></span>`;
}

/** Visible HTML for one trade side: each property is prefixed with its colour-group swatch. */
function sideContentHtml(side: TradeSideDto): string {
	const parts: string[] = [];
	for (const p of side.properties) parts.push(`${colorSwatchHtml(p.color)}${escapeHtml(tradePropertyLabel(p))}`);
	if (side.money > 0) parts.push(escapeHtml(t('trade_cash', { amount: money(side.money) })));
	if (side.releasePasses > 0) parts.push(escapeHtml(t('trade_release_passes_count', { count: side.releasePasses })));
	// Same sentence shape as summarizeSide, so eyes and ears get the one wording.
	return parts.length > 0 ? joinList(parts) : escapeHtml(t('trade_nothing'));
}

// ── Dialog ────────────────────────────────────────────────────────────────────

class TradeDialogClass {
	private dialog: HTMLDialogElement | null = null;
	private previousFocus: HTMLElement | null = null;
	/** Per-state handler for the ESC / cancel key (null = ignore ESC, keep the modal open). */
	private onCancelKey: (() => void) | null = null;
	/** Roving-tabindex controllers for the give/receive property lists (single tab stop). */
	private givePropsNav: RovingCheckboxList | null = null;
	private reqPropsNav: RovingCheckboxList | null = null;
	/** Set while the BUILDER is open: re-reads the live caps and re-validates/estimates without
	 *  re-rendering the property lists (so in-progress selections survive a partner's mortgage). */
	private builderRefresh: (() => void) | null = null;

	private ensureDialog(): HTMLDialogElement {
		if (this.dialog) return this.dialog;
		const dialog = document.createElement('dialog');
		dialog.id = 'trade-dialog';
		dialog.className = 'game-dialog trade-dialog';
		dialog.setAttribute('aria-labelledby', 'trade-dialog-title');
		document.body.appendChild(dialog);

		dialog.addEventListener('cancel', (e) => {
			e.preventDefault();
			// ESC means different things per state; some states ignore it entirely.
			// (Native `cancel` only fires for showModal — a non-modal dialog's Escape is
			// the global "back to the board" key instead, and the dialog stays open.)
			this.onCancelKey?.();
		});
		dialog.addEventListener('keydown', (e) => this.trapFocus(e));
		dialog.addEventListener('keydown', (e) => this.activateDefaultOnEnter(e));
		// Review/waiting float over the board: let the player drag them out of the way.
		makeDialogDraggable(dialog);

		this.dialog = dialog;
		return dialog;
	}

	isOpen(): boolean {
		return !!this.dialog?.open;
	}

	// ── BUILDER ────────────────────────────────────────────────────────────────

	openBuilder(opts: TradeBuilderOptions): void {
		const dialog = this.ensureDialog();

		// Live reads (fall back to the open-time snapshot): the caps/valuation track the game
		// so a partner's mid-build mortgage is reflected. The PROPERTY LISTS are still rendered
		// from the snapshot (re-rendering would wipe the in-progress selections).
		const livePlayers = (): Player[] => opts.getPlayers?.() ?? [opts.myPlayer, ...opts.others];
		const liveSquares = (): Square[] => opts.getSquares?.() ?? opts.squares;
		const myLive = (): Player => livePlayers().find(p => p.id === opts.myPlayer.id) ?? opts.myPlayer;

		if (opts.others.length === 0) {
			// Nothing to do but tell the player (locally — this is UI, not a game event).
			this.renderMessage(t('trade_builder_title'), t('trade_no_target'), t('trade_cancel_button'));
			return;
		}

		const optionsHtml = opts.others
			.map(p => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)}</option>`)
			.join('');

		dialog.className = 'game-dialog trade-dialog trade-builder';
		dialog.innerHTML = `
			<div class="trade-application" role="application" aria-labelledby="trade-dialog-title">
				<h2 class="dialog-title" id="trade-dialog-title">${escapeHtml(t('trade_builder_title'))}</h2>
				<div class="dialog-content trade-builder-content">
				<div class="trade-row">
					<label for="trade-target">${escapeHtml(t('trade_target_label'))}</label>
					<select id="trade-target" class="trade-target-select">${optionsHtml}</select>
				</div>
				<div class="trade-sides">
					<fieldset class="trade-side trade-give">
						<legend>${escapeHtml(t('trade_give_legend'))}</legend>
						<ul class="trade-prop-list trade-give-props" aria-label="${escapeAttr(t('trade_properties_label'))}"></ul>
						<div class="trade-row">
							<label for="trade-give-money">${escapeHtml(t('trade_money_label'))}</label>
							<input type="number" id="trade-give-money" class="trade-money-input" inputmode="numeric" min="0" value="0" aria-describedby="trade-give-money-error" />
						</div>
						<p class="trade-input-error" id="trade-give-money-error" role="alert" hidden></p>
						<div class="trade-row">
							<label for="trade-give-release-passes">${escapeHtml(t('trade_release_passes_label'))}</label>
							<input type="number" id="trade-give-release-passes" class="trade-holding-input" inputmode="numeric" min="0" value="0" aria-describedby="trade-give-release-passes-error" />
						</div>
						<p class="trade-input-error" id="trade-give-release-passes-error" role="alert" hidden></p>
					</fieldset>
					<fieldset class="trade-side trade-receive">
						<legend>${escapeHtml(t('trade_receive_legend'))}</legend>
						<ul class="trade-prop-list trade-req-props" aria-label="${escapeAttr(t('trade_properties_label'))}"></ul>
						<div class="trade-row">
							<label for="trade-req-money">${escapeHtml(t('trade_money_label'))}</label>
							<input type="number" id="trade-req-money" class="trade-money-input" inputmode="numeric" min="0" value="0" aria-describedby="trade-req-money-error" />
						</div>
						<p class="trade-input-error" id="trade-req-money-error" role="alert" hidden></p>
						<div class="trade-row">
							<label for="trade-req-release-passes">${escapeHtml(t('trade_release_passes_label'))}</label>
							<input type="number" id="trade-req-release-passes" class="trade-holding-input" inputmode="numeric" min="0" value="0" aria-describedby="trade-req-release-passes-error" />
						</div>
						<p class="trade-input-error" id="trade-req-release-passes-error" role="alert" hidden></p>
					</fieldset>
				</div>
				<p class="trade-summary trade-summary-give" tabindex="0"></p>
				<p class="trade-summary trade-summary-receive" tabindex="0"></p>
				<p class="trade-valuation" role="status" aria-live="polite" aria-atomic="true" tabindex="0"></p>
				</div>
				<div class="dialog-buttons">
					<button type="button" class="btn btn-primary trade-propose-btn">${escapeHtml(t('trade_propose_button'))}</button>
					<button type="button" class="btn btn-secondary trade-cancel-btn">${escapeHtml(t('trade_cancel_button'))}</button>
				</div>
			</div>
		`;

		const targetSelect = dialog.querySelector<HTMLSelectElement>('#trade-target')!;
		const giveMoney = dialog.querySelector<HTMLInputElement>('#trade-give-money')!;
		const giveReleasePasses = dialog.querySelector<HTMLInputElement>('#trade-give-release-passes')!;
		const reqMoney = dialog.querySelector<HTMLInputElement>('#trade-req-money')!;
		const reqReleasePasses = dialog.querySelector<HTMLInputElement>('#trade-req-release-passes')!;
		const givePropsFs = dialog.querySelector<HTMLElement>('.trade-give-props')!;
		const reqPropsFs = dialog.querySelector<HTMLElement>('.trade-req-props')!;
		const valuationEl = dialog.querySelector<HTMLElement>('.trade-valuation')!;
		const summaryGiveEl = dialog.querySelector<HTMLElement>('.trade-summary-give')!;
		const summaryReceiveEl = dialog.querySelector<HTMLElement>('.trade-summary-receive')!;

		// The DTOs for each side's tradeable properties, so the summary can name a checked square
		// (colour group + price) without re-deriving it. My side is fixed; the partner's is rebuilt
		// on a partner switch.
		const myProps = tradeableProperties(opts.squares, opts.myPlayer.id);
		let reqProps: TradePropertyDto[] = [];

		// Each property list is a single tab stop navigated with the arrow keys; rebuild
		// the controllers fresh for this builder instance (the dialog is reused).
		this.givePropsNav?.destroy();
		this.reqPropsNav?.destroy();
		this.givePropsNav = new RovingCheckboxList({ container: givePropsFs, itemSelector: 'input.trade-prop-check' });
		this.reqPropsNav = new RovingCheckboxList({ container: reqPropsFs, itemSelector: 'input.trade-prop-check' });

		// Amount validation: an over-the-cap or malformed money/holding value shows an inline,
		// spoken error (role="alert" + aria-describedby) and blocks the proposal. NEVER
		// silently clamped: a clamped trade went out altered and confused both players.
		const currentTarget = () => livePlayers().find(p => p.id === targetSelect.value) ?? opts.others[0];
		const validateAmounts = (): HTMLInputElement | null => {
			const target = currentTarget();
			const me = myLive();
			const checks: Array<{ input: HTMLInputElement; max: number; over: () => string }> = [
				{ input: giveMoney, max: me.money, over: () => t('trade_error_money_over_you', { max: money(me.money) }) },
				{ input: giveReleasePasses, max: me.releasePasses ?? 0, over: () => t('trade_error_release_pass_over_you', { count: me.releasePasses ?? 0 }) },
				{ input: reqMoney, max: target.money, over: () => t('trade_error_money_over_target', { name: target.name, max: money(target.money) }) },
				{ input: reqReleasePasses, max: target.releasePasses ?? 0, over: () => t('trade_error_release_pass_over_target', { name: target.name, count: target.releasePasses ?? 0 }) },
			];
			let firstBad: HTMLInputElement | null = null;
			for (const c of checks) {
				const issue = amountInputIssue(c.input.value, c.max);
				const message = issue === 'over' ? c.over() : issue === 'invalid' ? t('trade_error_amount_invalid') : '';
				const errorEl = dialog.querySelector<HTMLElement>(`#${c.input.id}-error`)!;
				errorEl.textContent = message;
				errorEl.hidden = !message;
				c.input.classList.toggle('trade-input-invalid', !!message);
				if (message) c.input.setAttribute('aria-invalid', 'true');
				else c.input.removeAttribute('aria-invalid');
				if (message && !firstBad) firstBad = c.input;
			}
			return firstBad;
		};

		// Live "monetary justice" estimate: what each side is worth and whether the swap
		// is fair, refreshed whenever any input on either side changes.
		const updateValuation = () => {
			const target = currentTarget();
			const me = myLive();
			const squares = liveSquares();
			const giveValue = tradeSideValue(
				squares, this.collectChecked(givePropsFs),
				clampInt(giveMoney.value, 0, me.money),
				clampInt(giveReleasePasses.value, 0, me.releasePasses ?? 0));
			const receiveValue = tradeSideValue(
				squares, this.collectChecked(reqPropsFs),
				clampInt(reqMoney.value, 0, target.money),
				clampInt(reqReleasePasses.value, 0, target.releasePasses ?? 0));
			const valuationText = tradeValuationText(giveValue, receiveValue);
			valuationEl.textContent = valuationText;
			// role="status" is a live region: it announces changes, but exposes no accessible
			// name on focus, so Tabbing onto this line would read nothing. Mirror the text into
			// aria-label so the focused line voices the full valuation (the live announcement on
			// change still works from the text content).
			valuationEl.setAttribute('aria-label', valuationText);
		};

		// The plain-language "what I give / what I receive" summary the proposer can Tab to and
		// hear in one go, instead of re-scanning every checkbox (playtest #5). Focusable with an
		// aria-label (on demand), deliberately NOT a live region so it doesn't double-announce with
		// the valuation on every keystroke; it stays current so it's right whenever it gets focus.
		const checkedDtos = (fieldset: HTMLElement, dtos: TradePropertyDto[]): TradePropertyDto[] => {
			const idxs = new Set(this.collectChecked(fieldset));
			return dtos.filter(d => idxs.has(d.index));
		};
		const updateSummary = () => {
			const me = myLive();
			const target = currentTarget();
			const giveSide: TradeSideDto = {
				properties: checkedDtos(givePropsFs, myProps),
				money: clampInt(giveMoney.value, 0, me.money),
				releasePasses: clampInt(giveReleasePasses.value, 0, me.releasePasses ?? 0),
			};
			const receiveSide: TradeSideDto = {
				properties: checkedDtos(reqPropsFs, reqProps),
				money: clampInt(reqMoney.value, 0, target.money),
				releasePasses: clampInt(reqReleasePasses.value, 0, target.releasePasses ?? 0),
			};
			const giveText = `${t('trade_you_give')} ${summarizeSide(giveSide)}.`;
			const receiveText = `${t('trade_you_receive')} ${summarizeSide(receiveSide)}.`;
			summaryGiveEl.textContent = giveText;
			summaryGiveEl.setAttribute('aria-label', giveText);
			summaryReceiveEl.textContent = receiveText;
			summaryReceiveEl.setAttribute('aria-label', receiveText);
		};

		// My side is fixed: my tradeable properties + my caps.
		this.fillProperties(givePropsFs, myProps, 'give');
		this.givePropsNav.refreshRovingTabindex();
		giveMoney.max = String(myLive().money);
		giveReleasePasses.max = String(myLive().releasePasses ?? 0);

		// Honour a pre-selected partner (e.g. "Propose trade" from the players panel).
		if (opts.preselectedTargetId && opts.others.some(p => p.id === opts.preselectedTargetId)) {
			targetSelect.value = opts.preselectedTargetId;
		}

		const rebuildRequested = () => {
			const target = currentTarget();
			reqProps = tradeableProperties(opts.squares, target.id);
			this.fillProperties(reqPropsFs, reqProps, 'req');
			this.reqPropsNav!.refreshRovingTabindex();
			reqMoney.max = String(target.money);
			reqReleasePasses.max = String(target.releasePasses ?? 0);
			// A partner switch changes the caps, so an amount fine for one partner may
			// now exceed the new one (and vice versa): re-check before re-estimating.
			validateAmounts();
			updateValuation();
			updateSummary();
		};
		targetSelect.addEventListener('change', rebuildRequested);
		// Re-check amounts and recompute the estimate + summary on any asset change (checkbox
		// toggle or money/holding edit).
		const refresh = () => { validateAmounts(); updateValuation(); updateSummary(); };
		dialog.querySelector('.trade-builder-content')!
			.addEventListener('change', refresh);
		dialog.querySelector('.trade-builder-content')!
			.addEventListener('input', refresh);
		rebuildRequested();

		const proposeBtn = dialog.querySelector<HTMLButtonElement>('.trade-propose-btn')!;
		const cancelBtn = dialog.querySelector<HTMLButtonElement>('.trade-cancel-btn')!;

		proposeBtn.addEventListener('click', () => {
			// An invalid amount REFUSES the proposal: focus lands on the offending input,
			// whose aria-describedby error explains the cap. Nothing is clamped or sent.
			const offending = validateAmounts();
			if (offending) {
				offending.focus();
				return;
			}
			const offered: TradeOfferInput = {
				properties: this.collectChecked(givePropsFs),
				money: clampInt(giveMoney.value, 0, myLive().money),
				releasePasses: clampInt(giveReleasePasses.value, 0, myLive().releasePasses ?? 0)
			};
			const target = currentTarget();
			const requested: TradeOfferInput = {
				properties: this.collectChecked(reqPropsFs),
				money: clampInt(reqMoney.value, 0, target.money),
				releasePasses: clampInt(reqReleasePasses.value, 0, target.releasePasses ?? 0)
			};
			void opts.onPropose(target.id, offered, requested);
			// The proposer's WAITING modal opens when the TRADE_PROPOSED echo arrives.
			this.closeAndRestore();
		});

		// Builder cancel is non-destructive (nothing was sent), so ESC may close it.
		const cancel = () => this.closeAndRestore();
		cancelBtn.addEventListener('click', cancel);
		this.onCancelKey = cancel;

		// Called from the game-state handler while the builder is open: re-read the live caps
		// (a partner's mortgage raised their cash) and re-validate + re-estimate, WITHOUT
		// re-rendering the property lists so the player's current selections are preserved.
		this.builderRefresh = () => {
			giveMoney.max = String(myLive().money);
			giveReleasePasses.max = String(myLive().releasePasses ?? 0);
			reqMoney.max = String(currentTarget().money);
			reqReleasePasses.max = String(currentTarget().releasePasses ?? 0);
			validateAmounts();
			updateValuation();
			updateSummary();
		};

		this.openModal(targetSelect);
	}

	/** Whether the BUILDER (not review/waiting) is the open trade dialog. */
	isBuilderOpen(): boolean {
		return !!this.dialog?.open && this.dialog.classList.contains('trade-builder');
	}

	/** Re-sync the open builder's caps/valuation to the live game state (e.g. after a partner
	 *  mortgaged). No-op unless the builder is the current dialog. */
	refreshBuilder(): void {
		if (this.isBuilderOpen()) this.builderRefresh?.();
	}

	// ── REVIEW (target) ──────────────────────────────────────────────────────────

	openReview(opts: TradeReviewOptions): void {
		const dialog = this.ensureDialog();
		dialog.className = 'game-dialog trade-dialog trade-review';

		const receiveText = summarizeSide(opts.offered);
		const giveText = summarizeSide(opts.requested);
		// Full, single-string aria-labels so each line is read as one coherent phrase when
		// focused — vital under role="application", where the virtual cursor is off.
		const receiveLabel = `${t('trade_you_receive')} ${receiveText}.`;
		const giveLabel = `${t('trade_you_give')} ${giveText}.`;
		// The same "monetary justice" estimate the proposer saw, now from MY perspective, so
		// the target hears whether the deal wins or loses money without doing the sums
		// (live-play: the review never said if you came out ahead or behind).
		const valuationText = tradeReviewValuationText(opts.squares, opts.offered, opts.requested);

		dialog.innerHTML = `
			<div class="trade-application" role="application" aria-labelledby="trade-dialog-title">
				<h2 class="dialog-title" id="trade-dialog-title">${escapeHtml(t('trade_review_title', { name: opts.initiatorName }))}</h2>
				<div class="dialog-content trade-review-content">
					<p class="trade-review-line" tabindex="0" aria-label="${escapeAttr(receiveLabel)}"><strong>${escapeHtml(t('trade_you_receive'))}</strong> ${sideContentHtml(opts.offered)}</p>
					<p class="trade-review-line" tabindex="0" aria-label="${escapeAttr(giveLabel)}"><strong>${escapeHtml(t('trade_you_give'))}</strong> ${sideContentHtml(opts.requested)}</p>
					<p class="trade-review-line trade-valuation" tabindex="0" aria-label="${escapeAttr(valuationText)}">${escapeHtml(valuationText)}</p>
				</div>
				<div class="dialog-buttons">
					<button type="button" class="btn btn-primary trade-accept-btn">${escapeHtml(t('trade_accept_button'))}</button>
					<button type="button" class="btn btn-danger trade-decline-btn">${escapeHtml(t('trade_decline_button'))}</button>
				</div>
			</div>
		`;

		const firstLine = dialog.querySelector<HTMLElement>('.trade-review-line')!;
		const acceptBtn = dialog.querySelector<HTMLButtonElement>('.trade-accept-btn')!;
		const declineBtn = dialog.querySelector<HTMLButtonElement>('.trade-decline-btn')!;

		acceptBtn.addEventListener('click', () => {
			void opts.onAccept();
			// The modal closes when the TRADE_RESOLVED broadcast arrives.
		});
		declineBtn.addEventListener('click', () => {
			void opts.onDecline();
			// Declining is the target's final word: dismiss the modal at once and hand focus
			// back to the board instead of waiting for the server's TRADE_RESOLVED round-trip.
			this.closeAndRestore();
		});

		// State hygiene only: the native `cancel` (ESC) never fires on a non-modal dialog,
		// so a handler left over from the modal builder must not linger here.
		this.onCancelKey = null;

		// FLOATING, not modal: the decision needs the board — the player checks prices,
		// groups and ownership before answering, and may drag the dialog aside. Escape
		// parks them on the board (the offer stays open and state-driven); Ctrl+D returns.
		// Land on the offer summary so the reader voices the deal immediately; Tab then
		// walks the two lines and the accept/decline buttons.
		this.openModal(firstLine, false);
	}

	// ── WAITING (proposer) ────────────────────────────────────────────────────────

	openWaiting(opts: TradeWaitingOptions): void {
		const dialog = this.ensureDialog();
		dialog.className = 'game-dialog trade-dialog trade-waiting';
		dialog.innerHTML = `
			<div class="trade-application" role="application" aria-labelledby="trade-dialog-title">
				<h2 class="dialog-title" id="trade-dialog-title">${escapeHtml(t('trade_waiting_title'))}</h2>
				<div class="dialog-content trade-waiting-content">
					<p class="trade-waiting-text" tabindex="0">${escapeHtml(t('trade_waiting_message', { name: opts.targetName }))}</p>
				</div>
				<div class="dialog-buttons">
					<button type="button" class="btn btn-secondary trade-cancel-btn">${escapeHtml(t('trade_cancel_button'))}</button>
				</div>
			</div>
		`;
		const cancelBtn = dialog.querySelector<HTMLButtonElement>('.trade-cancel-btn')!;
		const cancel = () => { void opts.onCancel(); };
		cancelBtn.addEventListener('click', cancel);
		// No ESC wiring: the native `cancel` event never fires on a non-modal dialog, so
		// Escape means "park me on the board" (global key) and withdrawing the offer is
		// the explicit button. Cleared so the builder's handler can't linger.
		this.onCancelKey = null;

		// FLOATING too: waiting for an answer should not lock the proposer out of the
		// board (Escape parks them there; withdrawing stays on the explicit button).
		// Land on the status text so it is voiced under role="application" (no virtual
		// cursor); Tab then reaches the Cancel button.
		this.openModal(dialog.querySelector<HTMLElement>('.trade-waiting-text')!, false);
	}

	/** Close the dialog (server-driven, e.g. trade resolved). Restores focus to the board. */
	close(): void {
		// A server-driven close lands focus on the stable board rather than the element that
		// opened the modal: for the proposer that opener is a transient action-bar button
		// which the post-trade re-render destroys moments later, dropping focus to <body>.
		if (this.isOpen()) this.closeAndRestore(true);
	}

	// ── internals ────────────────────────────────────────────────────────────────

	private renderMessage(title: string, message: string, closeLabel: string): void {
		const dialog = this.ensureDialog();
		dialog.className = 'game-dialog trade-dialog';
		dialog.innerHTML = `
			<div class="trade-application" role="application" aria-labelledby="trade-dialog-title">
				<h2 class="dialog-title" id="trade-dialog-title">${escapeHtml(title)}</h2>
				<div class="dialog-content"><p class="trade-message-text" tabindex="0">${escapeHtml(message)}</p></div>
				<div class="dialog-buttons">
					<button type="button" class="btn btn-secondary trade-cancel-btn">${escapeHtml(closeLabel)}</button>
				</div>
			</div>
		`;
		const btn = dialog.querySelector<HTMLButtonElement>('.trade-cancel-btn')!;
		const cancel = () => this.closeAndRestore();
		btn.addEventListener('click', cancel);
		this.onCancelKey = cancel;
		// Land on the message so it is voiced under role="application"; Tab reaches the button.
		this.openModal(dialog.querySelector<HTMLElement>('.trade-message-text')!);
	}

	private fillProperties(list: HTMLElement, props: TradePropertyDto[], prefix: string): void {
		// `list` is the <ul> itself (aria-labelled "Properties"); rebuild its <li> items.
		list.innerHTML = '';

		if (props.length === 0) {
			const li = document.createElement('li');
			li.className = 'trade-no-props';
			li.textContent = t('trade_no_properties');
			list.appendChild(li);
			return;
		}

		props.forEach(prop => {
			const id = `trade-${prefix}-prop-${prop.index}`;
			const row = document.createElement('li');
			row.className = 'trade-prop-row';
			const input = document.createElement('input');
			input.type = 'checkbox';
			input.id = id;
			input.className = 'trade-prop-check';
			input.value = String(prop.index);
			const label = document.createElement('label');
			label.htmlFor = id;
			// Read the colour group and price alongside the name so a screen-reader user can
			// weigh the property without leaving the trade builder.
			const colorLabel = groupDisplayName(prop, tSync, localizeColor);
			const priceLabel = prop.price ? money(prop.price) : '';
			label.textContent = [prop.name, colorLabel, priceLabel].filter(Boolean).join('. ');
			row.appendChild(input);
			// A colour-group swatch next to the checkbox so a sighted player can spot the
			// street's colour at a glance (the label text already speaks the colour name).
			const swatch = document.createElement('span');
			swatch.className = 'trade-prop-swatch' + (prop.color ? ' group-' + colorGroupSlug(prop.color) : '');
			swatch.setAttribute('aria-hidden', 'true');
			row.appendChild(swatch);
			row.appendChild(label);
			list.appendChild(row);
		});
	}

	private collectChecked(fieldset: HTMLElement): number[] {
		return Array.from(fieldset.querySelectorAll<HTMLInputElement>('input.trade-prop-check:checked'))
			.map(el => parseInt(el.value, 10))
			.filter(n => Number.isFinite(n));
	}

	private openModal(focusTarget: HTMLElement, modal = true): void {
		const dialog = this.dialog!;
		// data-modal lets the keyboard layer (and CSS) treat a floating dialog as one more
		// panel instead of a focus trap. Set BEFORE opening so every observer agrees.
		dialog.dataset.modal = modal ? 'true' : 'false';
		// Every open* state rewrites className wholesale: restore the drag-handle marker
		// (the behaviour itself is delegated and survives; this is the CSS affordance).
		dialog.classList.add('dialog--draggable');
		if (!dialog.open) {
			this.previousFocus = (document.activeElement as HTMLElement) ?? null;
			if (modal) dialog.showModal(); else dialog.show();
		}
		if (modal) {
			// The modal makes <body> inert; host the live regions inside so the reader keeps talking.
			setAnnouncerHost(dialog);
		} else {
			// Non-modal: the page stays interactive and the body-hosted live region keeps
			// working — the whole point is that the player can go verify the board.
			setAnnouncerHost(null);
		}
		setTimeout(() => focusTarget.focus(), 50);
	}

	private closeAndRestore(preferBoard = false): void {
		setAnnouncerHost(null);
		this.onCancelKey = null;
		this.givePropsNav?.destroy();
		this.reqPropsNav?.destroy();
		this.givePropsNav = null;
		this.reqPropsNav = null;
		if (this.dialog?.open) this.dialog.close();
		const board = document.getElementById('board');
		// For a server-driven close, go straight to the board: the opener may be about to be
		// re-rendered away. Otherwise restore to the opener when it is still in the document.
		const target = !preferBoard && this.previousFocus && document.contains(this.previousFocus)
			? this.previousFocus
			: board;
		target?.focus();
		this.previousFocus = null;
	}

	/**
	 * Enter activates the dialog's default (primary) button from anywhere inside it — the offer
	 * lines and the number inputs, not just when a button is focused (bug #11). Under
	 * role="application" the focusable review/summary lines otherwise swallow Enter. A focused
	 * BUTTON handles its own Enter, and SELECT keeps Enter for its dropdown, so we skip those.
	 */
	private activateDefaultOnEnter(e: KeyboardEvent): void {
		if (e.key !== 'Enter' || e.defaultPrevented || !this.dialog) return;
		const tag = (e.target as HTMLElement | null)?.tagName;
		if (tag === 'BUTTON' || tag === 'SELECT') return;
		const primary = this.dialog.querySelector<HTMLButtonElement>('.btn-primary');
		if (primary) {
			e.preventDefault();
			primary.click();
		}
	}

	private trapFocus(e: KeyboardEvent): void {
		if (e.key !== 'Tab' || !this.dialog) return;
		// A non-modal (floating) state is one more panel, not a trap: Tab may walk out of
		// it, and Escape / F6 / Ctrl+D move between it and the board.
		if (this.dialog.dataset.modal === 'false') return;
		const focusables = Array.from(
			this.dialog.querySelectorAll<HTMLElement>(
				'button, input, select, [tabindex]:not([tabindex="-1"])'
			)
		).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
		if (focusables.length === 0) {
			e.preventDefault();
			return;
		}
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		const active = document.activeElement as HTMLElement | null;
		if (e.shiftKey) {
			if (active === first || !this.dialog.contains(active)) {
				e.preventDefault();
				last.focus();
			}
		} else if (active === last || !this.dialog.contains(active)) {
			e.preventDefault();
			first.focus();
		}
	}
}

function clampInt(raw: string, min: number, max: number): number {
	const n = parseInt(raw, 10);
	if (!Number.isFinite(n)) return min;
	return Math.max(min, Math.min(max, n));
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, c =>
		c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
}

function escapeAttr(s: string): string {
	return escapeHtml(s);
}

export const tradeDialog = new TradeDialogClass();
