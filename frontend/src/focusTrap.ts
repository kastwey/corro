// focusTrap.ts — a small, reusable Tab / Shift+Tab focus trap. It keeps keyboard
// focus inside a root element by wrapping around its edges (Tab past the last
// focusable returns to the first, Shift+Tab before the first jumps to the last), so
// focus can NEVER escape to the browser chrome (the address bar) — not even while a
// native modal <dialog> is open, whose UA trap would otherwise let Tab reach the
// browser chrome.
//
// The same mechanism backs every surface:
//   - the board page and the lobby page trap the whole document body;
//   - the auction dialog traps just its own subtree.
//
// Page-level traps set `scopeToOpenModal`. While a *modal* <dialog> is open the rest
// of the page is inert, so the page trap scopes to that dialog — focus stays inside
// the modal and never reaches the inert body or the browser chrome. A *non-modal*
// <dialog> (opened with .show()) keeps the page root, so Tab circulates the whole
// body (dialog + board) without escaping.

export interface FocusTrapOptions {
	/** The element keyboard focus must stay within (read lazily on each Tab). */
	getRoot: () => HTMLElement | null;
	/** Page-level traps set this. While a modal <dialog> is open the trap scopes to
	 *  that dialog (the rest of the page is inert) so focus stays inside the modal;
	 *  a non-modal <dialog> keeps the page root so Tab circulates the whole body. */
	scopeToOpenModal?: boolean;
}

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button',
	'input',
	'select',
	'textarea',
	'summary',
	'[tabindex]',
].join(',');

/** Collect the Tab-reachable elements inside `root`, in DOM order. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
		.filter(isKeyboardFocusable);
}

function isKeyboardFocusable(el: HTMLElement): boolean {
	if (el.hasAttribute('disabled')) return false;
	if (el.getAttribute('aria-hidden') === 'true') return false;
	if ((el as HTMLInputElement).type === 'hidden') return false;
	// Negative tabindex is script-focusable but not a Tab stop.
	const tabindex = el.getAttribute('tabindex');
	if (tabindex !== null && Number(tabindex) < 0) return false;
	return isVisible(el);
}

/** Whether `d` is a modal <dialog> (opened with showModal). The standard signal is the
 *  :modal pseudo-class; we guard for engines that don't support it (e.g. jsdom) and
 *  fall back to a `data-modal` marker that such hosts (and our tests) can set. */
function isModalDialog(d: HTMLDialogElement): boolean {
	try {
		if (typeof d.matches === 'function' && d.matches(':modal')) return true;
	} catch {
		/* :modal unsupported here — fall through to the marker. */
	}
	return d.dataset.modal === 'true';
}

/** The topmost open modal <dialog> on the page, if any. */
function openModalDialog(): HTMLElement | null {
	const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
	for (let i = dialogs.length - 1; i >= 0; i--) {
		if (isModalDialog(dialogs[i])) return dialogs[i];
	}
	return null;
}

/** Whether `el` (and all its ancestors) are actually rendered / reachable. */
function isVisible(el: HTMLElement): boolean {
	if (el.closest('[hidden]')) return false;
	const win = el.ownerDocument?.defaultView;
	const getComputed = win && typeof win.getComputedStyle === 'function'
		? (node: HTMLElement) => win.getComputedStyle(node)
		: null;
	for (let node: HTMLElement | null = el; node; node = node.parentElement) {
		// A closed <dialog> is display:none via the UA stylesheet — its descendants
		// are in the DOM but not focusable.
		if (node.tagName === 'DIALOG' && !(node as HTMLDialogElement).open) return false;
		if (getComputed) {
			const cs = getComputed(node);
			if (cs.display === 'none' || cs.visibility === 'hidden') return false;
		} else if (node.style.display === 'none' || node.style.visibility === 'hidden') {
			return false;
		}
	}
	return true;
}

export class FocusTrap {
	private active = false;
	private readonly handler = (e: KeyboardEvent) => this.onKeydown(e);

	constructor(private readonly opts: FocusTrapOptions) {}

	activate(): void {
		if (this.active) return;
		// Capture phase so we see Tab even if an inner handler stops propagation.
		document.addEventListener('keydown', this.handler, true);
		this.active = true;
	}

	deactivate(): void {
		if (!this.active) return;
		document.removeEventListener('keydown', this.handler, true);
		this.active = false;
	}

	get isActive(): boolean {
		return this.active;
	}

	/** The element focus must stay within for this Tab. A page-level trap scopes to an
	 *  open modal <dialog> (the rest of the page is inert) so focus stays inside it;
	 *  otherwise it uses the configured root. */
	private effectiveRoot(): HTMLElement | null {
		if (this.opts.scopeToOpenModal) {
			const modal = openModalDialog();
			if (modal) return modal;
		}
		return this.opts.getRoot();
	}

	private onKeydown(e: KeyboardEvent): void {
		if (e.key !== 'Tab' || e.defaultPrevented) return;

		const root = this.effectiveRoot();
		if (!root) return;
		const focusables = focusableWithin(root);
		if (focusables.length === 0) {
			// Nothing to focus inside the trap: keep focus from leaving anyway.
			e.preventDefault();
			return;
		}

		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		const active = document.activeElement as HTMLElement | null;

		// Focus somehow escaped the root (e.g. a dialog trapping its own subtree):
		// pull it back to the appropriate edge.
		if (!active || !root.contains(active)) {
			e.preventDefault();
			(e.shiftKey ? last : first).focus();
			return;
		}

		const index = focusables.indexOf(active);
		// `active` is inside the root but is not itself a Tab stop — e.g. a roving
		// tabindex=-1 toolbar button focused via the arrow-key model. Letting the
		// browser advance natively from such an element can jump past the root's edge to
		// the browser chrome (the address bar), so we move to the adjacent real Tab stop
		// by DOM order, wrapping at the edges so focus never leaves the root.
		if (index === -1) {
			e.preventDefault();
			if (e.shiftKey) {
				let prev: HTMLElement | null = null;
				for (const f of focusables) {
					if (active.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_PRECEDING) prev = f;
					else break;
				}
				(prev ?? last).focus();
			} else {
				const next = focusables.find(
					f => !!(active.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING)
				);
				(next ?? first).focus();
			}
			return;
		}

		if (e.shiftKey && index === 0) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && index === focusables.length - 1) {
			e.preventDefault();
			first.focus();
		}
	}
}
