// auctionDialog.ts - Accessible auction dialog built on the native <dialog> element.
//
// A FLOATING (non-modal), minimizable panel — the same shape as the bus and trade dialogs.
// An auction auto-opens so the player never hunts for where to bid, but bidding NEEDS the
// board (who owns each square, what would it cost?), so it is deliberately NOT a focus trap:
// Escape minimizes it to its title bar (the board is fully visible, the countdown keeps
// running) and Ctrl+D brings it back, exactly like the other floating dialogs. The shared
// 'dialog' panel region picks it up via data-modal="false".
//
// Voice ownership: the SERVER announces every auction event (bid placed, pass, won, no
// sale). This dialog therefore stays SILENT — it is purely the action surface + visual
// state. The per-second timer is NOT an aria-live region (that would spam the reader); the
// full status is exposed via aria-describedby so it is read once when the dialog opens and
// remains reachable on demand.

import { tSync, money } from './i18nBinder.js';
import { setAnnouncerHost } from './announcer.js';
import { makeDialogDraggable, makeDialogMinimizable } from './dialogDrag.js';

const t = (key: string, vars?: Record<string, any>) => tSync(`game.${key}`, vars);

export interface AuctionDialogData {
	squareIndex: number;
	squareName: string;
	currentBid: number;
	highestBidderName: string | null;
	secondsRemaining: number;
	playerMoney: number;
	onBid: (amount: number) => void | Promise<void>;
	onPass: () => void | Promise<void>;
}

/** Read-only snapshot for the on-demand "auction status" keyboard command. */
export interface AuctionStatusSnapshot {
	squareName: string;
	currentBid: number;
	highestBidderName: string | null;
	secondsRemaining: number;
	playerMoney: number;
}

class AuctionDialogClass {
	private dialog: HTMLDialogElement | null = null;
	private titleEl!: HTMLElement;
	private descEl!: HTMLElement;
	private bidAmountEl!: HTMLElement;
	private bidderEl!: HTMLElement;
	private timerEl!: HTMLElement;
	private timerSrEl!: HTMLElement;
	private moneyEl!: HTMLElement;
	private input!: HTMLInputElement;
	private bidBtn!: HTMLButtonElement;
	private passBtn!: HTMLButtonElement;
	private bidLabelEl!: HTMLElement;
	private moneyLabelEl!: HTMLElement;
	private bidInputLabelEl!: HTMLElement;
	private unavailableHintEl!: HTMLElement;
	private announceUnavailable: ((text: string) => void) | null = null;

	private data: AuctionDialogData | null = null;
	private previousFocus: HTMLElement | null = null;

	/** Create the <dialog> once and wire its static handlers. */
	init(): void {
		if (this.dialog) return;

		const dialog = document.createElement('dialog');
		dialog.id = 'auction-dialog';
		dialog.className = 'game-dialog auction-dialog';
		dialog.setAttribute('aria-labelledby', 'auction-dialog-title');
		dialog.setAttribute('aria-describedby', 'auction-dialog-desc');
		dialog.innerHTML = `
			<h2 class="dialog-title" id="auction-dialog-title"></h2>
			<div class="dialog-content auction-dialog-content">
				<p id="auction-dialog-desc" class="auction-dialog-desc"></p>
				<ul class="auction-dialog-stats">
					<li class="auction-dlg-stat">
						<span class="auction-dlg-stat-label auction-dlg-bid-label"></span>
						<span class="auction-dlg-bid"></span>
						<span class="auction-dlg-bidder"></span>
					</li>
					<li class="auction-dlg-stat">
						<span class="auction-dlg-stat-label auction-dlg-money-label"></span>
						<span class="auction-dlg-money"></span>
					</li>
					<li class="auction-dlg-stat auction-dlg-timer">
						<span class="auction-dlg-timer-value" aria-hidden="true"></span><span aria-hidden="true">s</span>
						<span class="sr-only auction-dlg-timer-sr"></span>
					</li>
				</ul>
				<div class="auction-dlg-input-row">
					<label for="auction-bid-input" class="auction-dlg-bid-input-label"></label>
					<input type="number" id="auction-bid-input" class="auction-dlg-input" inputmode="numeric" />
					<p id="auction-bid-unavailable" class="auction-bid-hint" hidden></p>
				</div>
			</div>
			<div class="dialog-buttons">
				<button type="button" class="btn btn-primary auction-bid-btn"></button>
				<button type="button" class="btn btn-secondary auction-pass-btn"></button>
			</div>
		`;
		document.body.appendChild(dialog);
		this.dialog = dialog;

		this.titleEl = dialog.querySelector('#auction-dialog-title')!;
		this.descEl = dialog.querySelector('#auction-dialog-desc')!;
		this.bidAmountEl = dialog.querySelector('.auction-dlg-bid')!;
		this.bidderEl = dialog.querySelector('.auction-dlg-bidder')!;
		this.timerEl = dialog.querySelector('.auction-dlg-timer-value')!;
		this.timerSrEl = dialog.querySelector('.auction-dlg-timer-sr')!;
		this.moneyEl = dialog.querySelector('.auction-dlg-money')!;
		this.input = dialog.querySelector('.auction-dlg-input')!;
		this.bidBtn = dialog.querySelector('.auction-bid-btn')!;
		this.passBtn = dialog.querySelector('.auction-pass-btn')!;
		this.bidLabelEl = dialog.querySelector('.auction-dlg-bid-label')!;
		this.moneyLabelEl = dialog.querySelector('.auction-dlg-money-label')!;
		this.bidInputLabelEl = dialog.querySelector('.auction-dlg-bid-input-label')!;
		this.unavailableHintEl = dialog.querySelector('#auction-bid-unavailable')!;

		this.bidBtn.addEventListener('click', () => this.submitBid());
		this.passBtn.addEventListener('click', () => this.pass());
		this.input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.submitBid();
			}
		});
		// Select the whole amount whenever the field gains focus (Tab, click, or a later reopen),
		// so typing a new bid REPLACES the old one instead of appending to it — otherwise refocusing
		// a "100" and typing "150" produced "100150" (playtest bug #8).
		this.input.addEventListener('focus', () => this.input.select());

		// One more floating panel, not a focus trap: mark it non-modal, let the player drag it by
		// its title, and minimize it to just the title bar so they can read the board before bidding.
		// Escape then minimizes it (handled globally in keys.ts for any data-modal="false" dialog that
		// carries syncMinimize), and Ctrl+D re-expands it via the shared 'dialog' panel region.
		// Escape never PASSES — the player stays an active bidder; passing is only the Pass button.
		dialog.dataset.modal = 'false';
		makeDialogDraggable(dialog);
		makeDialogMinimizable(dialog, {
			minimize: () => tSync('game.dialog_minimize'),
			expand: () => tSync('game.dialog_expand'),
		}, () => document.getElementById('board')?.focus());
	}

	/** Supply local, user-initiated feedback for unavailable bid controls. */
	setUnavailableAnnouncer(announce: (text: string) => void): void {
		this.announceUnavailable = announce;
	}

	isOpen(): boolean {
		return !!this.dialog?.open;
	}

	/** Snapshot for the on-demand auction-status keyboard command. */
	getStatus(): AuctionStatusSnapshot | null {
		if (!this.isOpen() || !this.data) return null;
		const d = this.data;
		return {
			squareName: d.squareName,
			currentBid: d.currentBid,
			highestBidderName: d.highestBidderName,
			secondsRemaining: d.secondsRemaining,
			playerMoney: d.playerMoney
		};
	}

	/** Open (or refresh) the dialog for a freshly started auction. */
	open(data: AuctionDialogData): void {
		if (!this.dialog) this.init();
		this.data = { ...data };
		this.previousFocus = (document.activeElement as HTMLElement) ?? null;
		this.render();
		// A fresh open always proposes the CURRENT minimum bid, set explicitly AFTER render:
		// render()'s "don't clobber what the player is typing" guard would otherwise keep
		// whatever was typed in the PREVIOUS auction when focus never left the field
		// (live-play bug: "the second auction opened with the last value instead of 1").
		this.input.value = String(Math.min(this.minBid(), data.playerMoney));
		// Floating (non-modal), so the player can reach the board to weigh the square. The
		// page background is NOT inert, so the body-level aria-live regions keep working — leave
		// announcements hosted on <body> (a minimized dialog is still open, so they still play).
		if (!this.dialog!.open) this.dialog!.show();
		setAnnouncerHost(null);

		// Land focus on the action the player most likely wants: the bid field when they can
		// afford the minimum bid, otherwise the only thing they can do — pass.
		if (data.playerMoney >= this.minBid()) {
			this.input.focus();
			this.input.select();
		} else {
			this.passBtn.focus();
		}
	}

	/** Apply a partial update (new bid, timer tick, money change) without re-opening. */
	update(partial: Partial<AuctionDialogData>): void {
		if (!this.data) return;
		this.data = { ...this.data, ...partial };
		this.render();
	}

	/** Close because the auction ended (server-driven). Restores focus to the board. */
	end(): void {
		if (!this.isOpen()) return;
		this.closeAndRestore();
	}

	private pass(): void {
		if (!this.isOpen() || !this.data) return;
		const onPass = this.data.onPass;
		// Close locally first (we have left the auction), then notify the server.
		this.closeAndRestore();
		void onPass();
	}

	private submitBid(): void {
		if (!this.data) return;
		const min = this.minBid();
		const amount = parseInt(this.input.value, 10);
		if (!Number.isFinite(amount) || amount < min || amount > this.data.playerMoney) {
			// This is local input feedback, not a game event: explain why activation cannot
			// proceed while leaving the server as the sole voice for accepted auction actions.
			if (this.unavailableHintEl.textContent) {
				this.announceUnavailable?.(this.unavailableHintEl.textContent);
			}
			this.input.focus();
			return;
		}
		void this.data.onBid(amount);
		// Stay open: the server pushes the accepted bid back via update().
	}

	private minBid(): number {
		const d = this.data!;
		return d.currentBid > 0 ? d.currentBid + 1 : 1;
	}

	private render(): void {
		const d = this.data!;
		const min = this.minBid();
		const canAfford = d.playerMoney >= min;

		// Re-localize static text on every render: init() may run before i18next has
		// finished loading, so the labels/buttons must be (re)translated once strings are
		// available (an auction always starts well after load).
		this.bidBtn.textContent = t('auction_bid_button');
		this.passBtn.textContent = t('auction_pass_button');
		this.bidLabelEl.textContent = `${t('auction_current_bid')}:`;
		this.moneyLabelEl.textContent = `${t('auction_your_money')}:`;
		this.bidInputLabelEl.textContent = `${t('auction_your_bid')}:`;

		this.titleEl.textContent = `${t('auction_title')} — ${d.squareName}`;
		// Full status, read by the screen reader when the dialog opens (aria-describedby).
		this.descEl.textContent = d.currentBid > 0
			? t('auction_status_with_bid', {
				property: d.squareName,
				amount: d.currentBid,
				bidder: d.highestBidderName ?? '',
				seconds: d.secondsRemaining,
				money: d.playerMoney
			})
			: t('auction_status_no_bid', {
				property: d.squareName,
				seconds: d.secondsRemaining,
				money: d.playerMoney
			});

		this.bidAmountEl.textContent = d.currentBid > 0 ? money(d.currentBid) : t('auction_no_bids_yet');
		// The bidder needs its connective ("de Berto"): the screen reader runs the row's
		// spans together as one line, and a bare name glued to the amount reads wrong.
		this.bidderEl.textContent = d.highestBidderName ? t('auction_bid_by', { bidder: d.highestBidderName }) : '';
		this.timerEl.textContent = String(d.secondsRemaining);
		// The reader's version of the big "58 s": a full sentence, since a bare number in
		// the reading order says nothing about what is counting down.
		this.timerSrEl.textContent = t('auction_seconds_left', { seconds: d.secondsRemaining });
		this.moneyEl.textContent = money(d.playerMoney);

		this.input.min = String(min);
		this.input.max = String(d.playerMoney);
		// Don't clobber what the player is typing; only fix an empty / below-minimum value.
		if (document.activeElement !== this.input) {
			const current = parseInt(this.input.value, 10);
			if (!Number.isFinite(current) || current < min) {
				this.input.value = String(Math.min(min, d.playerMoney));
			}
		}
		// Can't-afford state: aria-disabled, NEVER the disabled attribute (project rule) — the
		// control stays focusable so a screen-reader user can still reach it and understand;
		// submitBid() validates the amount anyway, so an activation can't send a bad bid.
		this.input.setAttribute('aria-disabled', String(!canAfford));
		if (canAfford) {
			this.bidBtn.removeAttribute('aria-disabled');
			this.input.removeAttribute('aria-describedby');
			this.bidBtn.removeAttribute('aria-describedby');
			this.unavailableHintEl.hidden = true;
			this.unavailableHintEl.textContent = '';
		} else {
			this.bidBtn.setAttribute('aria-disabled', 'true');
			const reason = t('auction_cannot_afford', { minimum: min, money: d.playerMoney });
			this.unavailableHintEl.textContent = reason;
			this.unavailableHintEl.hidden = false;
			this.input.setAttribute('aria-describedby', this.unavailableHintEl.id);
			this.bidBtn.setAttribute('aria-describedby', this.unavailableHintEl.id);
		}
	}

	private closeAndRestore(): void {
		// Return the live regions to <body> before closing so later page-level
		// announcements are not trapped inside a hidden dialog.
		setAnnouncerHost(null);
		if (this.dialog?.open) this.dialog.close();
		this.data = null;
		const board = document.getElementById('board');
		const target = this.previousFocus && document.contains(this.previousFocus)
			? this.previousFocus
			: board;
		target?.focus();
		this.previousFocus = null;
	}
}

export const auctionDialog = new AuctionDialogClass();
