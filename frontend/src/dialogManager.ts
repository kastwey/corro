/**
 * DialogManager - Centralized modal dialog manager
 * Uses native <dialog> for better accessibility and automatic focus trap
 */

import { tSync, money } from './i18nBinder.js';
import { escapeHtml } from './escapeHtml.js';

import { setAnnouncerHost } from './announcer.js';
import { makeDialogDraggable, makeDialogMinimizable } from './dialogDrag.js';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface DialogButton {
	label: string;           // Button text (already translated or i18n key)
	action: () => void | Promise<void>;  // Callback when pressed
	variant?: ButtonVariant; // Button style
	i18nKey?: string;        // Translation key (if provided, translates label)
	i18nVars?: Record<string, any>; // Variables for interpolation
	/** Take the dialog's INITIAL focus (default: the first enabled button). The dialog asks
	 *  a question — landing on its expected ANSWER saves a Tab on every round. */
	focus?: boolean;
}

export interface DialogOptions {
	title: string;           // Dialog title
	titleI18nKey?: string;   // i18n key for the title
	titleI18nVars?: Record<string, any>;
	content?: string;        // HTML content or text
	contentElement?: HTMLElement; // Or a DOM element
	buttons: DialogButton[]; // Dialog buttons
	onClose?: () => void;    // Callback when closing (Escape or close())
	className?: string;      // Additional CSS class for the dialog
	/** false renders a NON-modal dialog: focus starts on it but is not trapped, so the
	 *  player can leave to explore the board and return (F6 / Ctrl+D). Default: modal. */
	modal?: boolean;
	/** true marks a READING dialog (the shortcuts help, the board guide): its content is a
	 *  document to browse, not controls to operate. The buttons row drops the
	 *  role="application" it normally carries — inside an application NVDA never builds a
	 *  virtual buffer, so even browse mode read NOTHING — and the aria-describedby is
	 *  dropped too (describing a dialog with its ENTIRE guide would dump it all on entry).
	 *  Screen readers then land in browse mode and the content reads like a normal page. */
	documentMode?: boolean;
	/** The control focus returns to on close (an element or its id). Pass this when the
	 *  trigger may not hold DOM focus at open time — e.g. a screen-reader browse-mode
	 *  activation of a button. Falls back to whatever had focus when the dialog opened. */
	returnFocusTo?: HTMLElement | string;
	/** A specific element in the content (e.g. a text input) to take the INITIAL focus instead
	 *  of a button. Use for a form dialog whose answer is typed: focusing the input directly
	 *  is the ONLY stable spot — otherwise showModal auto-focuses it, then this manager focuses
	 *  a button, and a caller re-focuses the input, a 3-way bounce that leaves NVDA stuck and
	 *  never reading the prompt. Put the prompt in the TITLE so it is announced on open. Ignored
	 *  in documentMode (which focuses the title). */
	initialFocus?: HTMLElement;
	/** The buttons row is a plain list of buttons — do NOT wrap it in the default
	 *  role="application". Inside an application NVDA builds no browse buffer, so it reads ONLY
	 *  the focused button and not the title/prompt/content. Use for choice dialogs (pick a
	 *  destination, an answer, a verdict) so the whole dialog reads. Not for documentMode
	 *  (which already drops the role). */
	plainButtons?: boolean;
	/** false makes a MODAL dialog non-dismissable: Escape (and backdrop) can't close it, only its
	 *  action buttons can. Use for a MANDATORY decision — a trivia judge's verdict, the answer —
	 *  so an accidental Escape can't strand the whole table with no way to resume. Default: true. */
	dismissable?: boolean;
}

class DialogManagerClass {
	private dialog: HTMLDialogElement | null = null;
	/** Whether the current MODAL dialog may be dismissed with Escape (false for mandatory ones). */
	private currentDismissable = true;
	/** Separate element for non-modal dialogs, so a modal one (help, a confirm) can open
	 *  OVER an open non-modal dialog and closing it brings the non-modal one back. */
	private nonModalDialog: HTMLDialogElement | null = null;
	private currentOnClose: (() => void) | null = null;
	private nonModalOnClose: (() => void) | null = null;
	/** The control that opened the current MODAL dialog: focus returns to it on close, so a
	 *  keyboard/screen-reader user lands back where they were (accessibility rule). Its id is
	 *  kept too, to re-find it when a re-render (e.g. adding a bot repaints the lobby) has
	 *  replaced the original node. */
	private opener: HTMLElement | null = null;
	private openerId = '';

	/**
	 * Initializes the DialogManager, creating the <dialog> in the DOM
	 */
	init(): void {
		if (this.dialog) return;

		this.dialog = this.createDialogElement('game-dialog');

		// A mandatory dialog (dismissable: false) refuses Escape: the native <dialog> fires
		// `cancel` before closing, and preventing it keeps the dialog open. Without this an
		// accidental Escape on a judge's verdict closed it for good and stalled the whole table.
		this.dialog.addEventListener('cancel', (e) => {
			if (!this.currentDismissable) e.preventDefault();
		});

		// Handle close with Escape
		this.dialog.addEventListener('close', () => {
			setAnnouncerHost(null);
			if (this.currentOnClose) {
				this.currentOnClose();
			}
			this.cleanup();
			// Accessibility: return focus to whoever opened the dialog (the Add-bot button,
			// etc.), so the user lands back where they were instead of on <body>. A button
			// action that moves focus AFTER calling close() still wins — it runs after this
			// synchronous close event.
			this.restoreOpenerFocus();
		});

		// Prevent closing on backdrop click (default behavior in some browsers)
		this.dialog.addEventListener('click', (e) => {
			if (e.target === this.dialog) {
				// Click on backdrop - we don't close automatically
				// (user must use the buttons)
			}
		});
	}

	private createDialogElement(id: string): HTMLDialogElement {
		const dialog = document.createElement('dialog');
		dialog.id = id;
		dialog.className = 'game-dialog';
		dialog.innerHTML = `
			<h2 class="dialog-title" id="${id}-title"></h2>
			<div class="dialog-content" id="${id}-content"></div>
			<div class="dialog-buttons" role="application"></div>
		`;
		// The title is the dialog's accessible NAME: screen readers announce it when
		// focus enters the dialog (essential for the non-modal one, where the player
		// walks in and out and needs the "why" of the dialog re-stated on entry).
		dialog.setAttribute('aria-labelledby', `${id}-title`);
		// An EXPLICIT description keeps screen readers from dumping the whole subtree on
		// entry (without one, NVDA reads every descendant — all the option buttons
		// included). With it, entering announces title + message; the buttons are then
		// discovered one by one with Tab.
		dialog.setAttribute('aria-describedby', `${id}-content`);
		document.body.appendChild(dialog);

		// Arrow keys move between the dialog's buttons, in addition to Tab — a keyboard/screen
		// reader user on "Accept" reaches "Cancel" with Down (or Right) without tabbing. Only
		// active when the buttons row is an application (the accept/cancel confirmations,
		// choices…): a reading dialog (documentMode) or a plain-buttons list leaves the row in
		// browse mode, where the arrows must stay the screen reader's own line navigation.
		const buttonsEl = dialog.querySelector('.dialog-buttons') as HTMLElement;
		buttonsEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (buttonsEl.getAttribute('role') !== 'application') return;
			const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
			const backward = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
			if (!forward && !backward) return;
			const buttons = Array.from(
				buttonsEl.querySelectorAll('button')) as HTMLButtonElement[];
			const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
			if (buttons.length < 2 || at < 0) return;
			e.preventDefault();
			const next = (at + (forward ? 1 : -1) + buttons.length) % buttons.length;
			buttons[next].focus();
		});
		return dialog;
	}

	private ensureNonModalDialog(): HTMLDialogElement {
		if (!this.nonModalDialog) {
			this.nonModalDialog = this.createDialogElement('game-dialog-nonmodal');
			this.nonModalDialog.addEventListener('close', () => {
				this.nonModalOnClose?.();
				this.nonModalOnClose = null;
			});
			// Floating dialogs (race piece choice…) can be dragged off the board area the
			// player wants to look at, and minimized to just their title bar (the choices stay
			// on the board, so a sighted player can clear the dialog and click a square).
			makeDialogDraggable(this.nonModalDialog);
			makeDialogMinimizable(this.nonModalDialog, {
				minimize: () => tSync('game.dialog_minimize'),
				expand: () => tSync('game.dialog_expand'),
			}, () => document.getElementById('board')?.focus());
		}
		return this.nonModalDialog;
	}

	/**
	 * Shows a dialog with the specified options
	 */
	show(options: DialogOptions): void {
		if (!this.dialog) {
			this.init();
		}

		const isModal = options.modal !== false;
		const dialog = isModal ? this.dialog! : this.ensureNonModalDialog();

		// Remember the opener now (before any focus moves into the dialog) so focus can
		// return to it on close. Only for modal dialogs: non-modal dialogs
		// steer focus to the board themselves. An EXPLICIT returnFocusTo wins (reliable even
		// when the trigger didn't hold DOM focus — e.g. a screen-reader browse-mode click);
		// otherwise fall back to whatever had focus, ignoring <body> and our own dialog.
		if (isModal) {
			const explicit = typeof options.returnFocusTo === 'string'
				? document.getElementById(options.returnFocusTo)
				: options.returnFocusTo ?? null;
			const active = document.activeElement as HTMLElement | null;
			const ownDialog = active ? active.closest('dialog') : null;
			const auto = active && active !== document.body && !ownDialog ? active : null;
			this.opener = explicit ?? auto;
			// Keep the id even if the element isn't found yet, to re-locate it on close after
			// a re-render (adding a bot repaints the lobby around the button).
			this.openerId = this.opener?.id
				?? (typeof options.returnFocusTo === 'string' ? options.returnFocusTo : '');
		}

		// Clear previous classes
		dialog.className = 'game-dialog';
		if (options.className) {
			dialog.classList.add(options.className);
		}
		// The wholesale reset above also wiped the drag-handle marker (the behaviour is
		// delegated and survives; this is the CSS cursor affordance) — restore it. The reset
		// also cleared any 'dialog--minimized' from a previous show, so this dialog opens
		// expanded; re-sync the minimize button's label/icon to match.
		if (!isModal) {
			dialog.classList.add('dialog--draggable');
			(dialog as unknown as { syncMinimize?: () => void }).syncMinimize?.();
		}

		// Title
		const titleEl = dialog.querySelector('.dialog-title') as HTMLElement;
		if (options.titleI18nKey) {
			titleEl.textContent = tSync(options.titleI18nKey, options.titleI18nVars || {});
		} else {
			titleEl.textContent = options.title;
		}

		// Content
		const contentEl = dialog.querySelector('.dialog-content') as HTMLElement;
		contentEl.innerHTML = '';
		if (options.contentElement) {
			contentEl.appendChild(options.contentElement);
		} else if (options.content) {
			contentEl.innerHTML = options.content;
		}

		// Buttons
		const buttonsEl = dialog.querySelector('.dialog-buttons') as HTMLElement;
		buttonsEl.innerHTML = '';

		// The dialog element is REUSED between shows, so the reading-dialog semantics are
		// (re)applied every time: a document-mode dialog must not wrap anything in
		// role="application" nor describe itself with its whole content (see DialogOptions),
		// and its initial focus goes to the TITLE (focusable via tabindex=-1) instead of the
		// close button, so the screen reader starts reading from the top of the document.
		if (options.documentMode) {
			buttonsEl.removeAttribute('role');
			dialog.removeAttribute('aria-describedby');
			titleEl.tabIndex = -1;
			// Help/guide content is the scroll container. Make it a real keyboard stop so a
			// sighted keyboard user can scroll long documentation without leaving the dialog.
			if (dialog.classList.contains('dialog-help')) contentEl.tabIndex = 0;
			else contentEl.removeAttribute('tabindex');
		} else {
			// A plain-buttons choice dialog drops role="application" so NVDA reads the whole
			// dialog (title + content + every option), not just the focused button.
			if (options.plainButtons) buttonsEl.removeAttribute('role');
			else buttonsEl.setAttribute('role', 'application');
			dialog.setAttribute('aria-describedby', `${dialog.id}-content`);
			titleEl.removeAttribute('tabindex');
			contentEl.removeAttribute('tabindex');
		}

		options.buttons.forEach((btn) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = `btn btn-${btn.variant || 'secondary'}`;

			if (btn.i18nKey) {
				button.textContent = tSync(btn.i18nKey, btn.i18nVars || {});
			} else {
				button.textContent = btn.label;
			}

			button.addEventListener('click', async () => {
				try {
					await btn.action();
				} catch (e) {
					console.error('Dialog button action error:', e);
				}
			});

			buttonsEl.appendChild(button);
		});

		// Show the dialog. data-modal lets the keyboard layer (and CSS) treat a non-modal
		// dialog as one more panel instead of a focus trap.
		dialog.dataset.modal = isModal ? 'true' : 'false';
		if (isModal) {
			this.currentOnClose = options.onClose || null;
			this.currentDismissable = options.dismissable !== false;
			dialog.showModal();
			// A modal dialog makes the rest of the page inert, silencing the announcer's live
			// region in <body>; host it inside the dialog while it is open.
			setAnnouncerHost(dialog);
		} else {
			// Non-modal: the page stays interactive and the body-hosted live region keeps
			// working, so the announcer host is left alone. Re-showing while open just
			// re-renders in place (native show() is a no-op on an open dialog).
			this.nonModalOnClose = options.onClose || null;
			dialog.show();
		}

		// Initial focus: a reading dialog starts at its title (the top of the document);
		// any other dialog starts on the button marked `focus` — the question's expected
		// answer — else its first enabled button, ready to operate.
		if (options.documentMode) {
			setTimeout(() => titleEl.focus(), 50);
		} else if (options.initialFocus) {
			// A form dialog: land on its input directly (single, stable focus) so the caller
			// never has to re-focus it and cause a bounce.
			const input = options.initialFocus;
			setTimeout(() => input.focus(), 50);
		} else {
			const flagged = options.buttons.findIndex(b => b.focus);
			const target = flagged >= 0
				? (buttonsEl.children[flagged] as HTMLButtonElement)
				: buttonsEl.querySelector('button') as HTMLButtonElement;
			if (target) {
				setTimeout(() => target.focus(), 50);
			}
		}
	}

	/**
	 * Closes the current modal dialog
	 */
	close(): void {
		if (this.dialog?.open) {
			this.dialog.close();
		}
	}

	/**
	 * Closes the current non-modal dialog
	 */
	closeNonModal(): void {
		if (this.nonModalDialog?.open) {
			this.nonModalDialog.close();
		}
	}

	/**
	 * Cleans up internal state after closing
	 */
	private cleanup(): void {
		this.currentOnClose = null;
	}

	/** Return focus to the control that opened the modal dialog. Prefers the original node;
	 *  if a re-render replaced it (same id), re-finds it by id; if it's truly gone, leaves
	 *  focus where the browser put it. */
	private restoreOpenerFocus(): void {
		const target = this.opener?.isConnected
			? this.opener
			: (this.openerId ? document.getElementById(this.openerId) : null);
		this.opener = null;
		this.openerId = '';
		(target as HTMLElement | null)?.focus?.();
	}

	// ==========================================
	// PRESETS - Common predefined dialogs
	// ==========================================


	/**
	 * Buy confirmation dialog (Yes/No). Used by the "Buy property" action in the
	 * action bar: the player chose to buy, this confirms before spending money and
	 * surfaces the group-ownership context. Cancelling leaves the offer pending so
	 * the player can still mortgage/trade and buy later, or end the turn to decline.
	 */
	showBuyConfirm(options: {
		squareName: string;
		price: number;
		groupStatusMessage?: string;
		onConfirm: () => void | Promise<void>;
		onCancel?: () => void;
	}): void {
		const groupStatusHtml = options.groupStatusMessage
			? `<p class="dialog-group-status">${escapeHtml(options.groupStatusMessage)}</p>`
			: '';

		this.show({
			title: options.squareName,
			titleI18nKey: 'game.buy_confirm_title',
			titleI18nVars: { property: options.squareName },
			content: `<p class="dialog-property-info">${escapeHtml(options.squareName)} - ${escapeHtml(money(options.price))}</p>${groupStatusHtml}`,
			className: 'dialog-purchase',
			buttons: [
				{
					label: 'Yes',
					i18nKey: 'game.buy_confirm_yes',
					i18nVars: { price: options.price },
					variant: 'primary',
					action: async () => {
						await options.onConfirm();
						this.close();
					}
				},
				{
					label: 'No',
					i18nKey: 'game.buy_confirm_no',
					variant: 'secondary',
					action: () => {
						this.close();
						options.onCancel?.();
					}
				}
			]
		});
	}

	/**
	 * Generic confirmation dialog
	 */
	showConfirm(options: {
		title: string;
		titleI18nKey?: string;
		message: string;
		messageI18nKey?: string;
		messageI18nVars?: Record<string, any>;
		confirmLabel?: string;
		confirmI18nKey?: string;
		cancelLabel?: string;
		cancelI18nKey?: string;
		/** Start with focus on the CONFIRM button (the question's expected answer) instead
		 *  of Cancel. For confirmations invoked deliberately (the hand's discard), landing
		 *  on the answer saves a Tab on every round. */
		focusConfirm?: boolean;
		onConfirm: () => void | Promise<void>;
		onCancel?: () => void;
	}): void {
		const message = options.messageI18nKey
			? tSync(options.messageI18nKey, options.messageI18nVars || {})
			: options.message;

		this.show({
			title: options.title,
			titleI18nKey: options.titleI18nKey,
			content: `<p>${escapeHtml(message)}</p>`,
			className: 'dialog-confirm',
			buttons: [
				{
					label: options.cancelLabel || 'Cancel',
					i18nKey: options.cancelI18nKey || 'common.cancel',
					variant: 'secondary',
					action: () => {
						options.onCancel?.();
						this.close();
					}
				},
				{
					label: options.confirmLabel || 'Confirm',
					i18nKey: options.confirmI18nKey || 'common.confirm',
					variant: 'primary',
					focus: options.focusConfirm,
					action: async () => {
						await options.onConfirm();
						this.close();
					}
				}
			]
		});
	}

	/**
	 * Information dialog (OK button only)
	 */
	showInfo(options: {
		title: string;
		titleI18nKey?: string;
		message: string;
		messageI18nKey?: string;
		messageI18nVars?: Record<string, any>;
		onClose?: () => void;
	}): void {
		const message = options.messageI18nKey
			? tSync(options.messageI18nKey, options.messageI18nVars || {})
			: options.message;

		this.show({
			title: options.title,
			titleI18nKey: options.titleI18nKey,
			content: `<p>${escapeHtml(message)}</p>`,
			className: 'dialog-info',
			onClose: options.onClose,
			buttons: [
				{
					label: 'OK',
					i18nKey: 'common.ok',
					variant: 'primary',
					action: () => {
						options.onClose?.();
						this.close();
					}
				}
			]
		});
	}
}

// Singleton
export const dialogManager = new DialogManagerClass();
