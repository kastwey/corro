/**
 * Makes a native <dialog> draggable by its title bar, so a floating (non-modal) dialog can
 * be moved off whatever board area the player wants to see. Pointer-based and additive:
 * keyboard users never need it (a non-modal dialog is left with Escape and re-entered with
 * F6 / Ctrl+D), so dragging is purely a convenience for mouse and touch.
 *
 * Implementation notes:
 * - Handlers are DELEGATED from the dialog element, because several dialogs rewrite their
 *   innerHTML per state (the trade dialog re-renders builder/review/waiting) and a listener
 *   on the title element itself would be thrown away with it.
 * - The dialog is re-anchored to fixed coordinates at its current visual position on the
 *   first grab (native dialogs center themselves with auto margins), then follows the
 *   pointer, clamped so the title bar can never leave the viewport entirely.
 * - Closing clears the inline position, so the next open re-centers as always.
 */
export function makeDialogDraggable(dialog: HTMLDialogElement): void {
	dialog.classList.add('dialog--draggable');

	dialog.addEventListener('pointerdown', ev => {
		const grabbed = (ev.target as HTMLElement | null)?.closest('.dialog-title');
		if (!grabbed || ev.button !== 0) return;

		const rect = dialog.getBoundingClientRect();
		dialog.style.position = 'fixed';
		dialog.style.margin = '0';
		dialog.style.left = `${rect.left}px`;
		dialog.style.top = `${rect.top}px`;

		const startX = ev.clientX;
		const startY = ev.clientY;

		const onMove = (e: PointerEvent) => {
			// Keep at least a grabbable sliver of the title on screen. Unknown dimensions
			// (a zero rect) fall back to the sliver itself so the clamp stays a no-op.
			const minVisible = 60;
			const width = rect.width || minVisible;
			const left = Math.min(
				Math.max(rect.left + e.clientX - startX, minVisible - width),
				(window.innerWidth || Number.MAX_SAFE_INTEGER) - minVisible);
			const top = Math.min(
				Math.max(rect.top + e.clientY - startY, 0),
				Math.max(0, (window.innerHeight || Number.MAX_SAFE_INTEGER) - minVisible));
			dialog.style.left = `${left}px`;
			dialog.style.top = `${top}px`;
		};
		const onUp = () => {
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onUp);
		};
		document.addEventListener('pointermove', onMove);
		document.addEventListener('pointerup', onUp);
		// No text selection / page scroll while dragging.
		ev.preventDefault();
	});

	dialog.addEventListener('close', () => {
		dialog.style.position = '';
		dialog.style.margin = '';
		dialog.style.left = '';
		dialog.style.top = '';
	});
}

/**
 * Adds a minimize toggle to a floating (non-modal) dialog, so a sighted player can shrink it to
 * just its title bar and see the whole board (the destination options stay clickable on the
 * board). A button, not a keyboard command: keyboard/screen-reader players leave with Escape and
 * pick on the board directly. Exposes `syncMinimize()` on the element so the manager re-expands it
 * on each fresh show. The dialog is expanded again on close.
 */
export function makeDialogMinimizable(
	dialog: HTMLDialogElement,
	labels: { minimize: () => string; expand: () => string },
	onMinimize?: () => void,
): void {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'dialog-minimize';

	const sync = () => {
		const min = dialog.classList.contains('dialog--minimized');
		btn.setAttribute('aria-expanded', String(!min));
		btn.setAttribute('aria-label', min ? labels.expand() : labels.minimize());
		btn.title = min ? labels.expand() : labels.minimize();
		btn.textContent = min ? '＋' : '－';
	};

	btn.addEventListener('pointerdown', ev => ev.stopPropagation()); // never start a title drag
	btn.addEventListener('click', ev => {
		ev.preventDefault();
		ev.stopPropagation();
		const minimized = dialog.classList.toggle('dialog--minimized');
		sync();
		// Shrinking is a "clear it off the board" gesture: hand focus to the board so the player
		// is right where the highlighted squares are. Expanding keeps focus on the button.
		if (minimized) onMinimize?.();
	});

	dialog.appendChild(btn);
	sync();
	(dialog as unknown as { syncMinimize?: () => void }).syncMinimize = sync;
	dialog.addEventListener('close', () => { dialog.classList.remove('dialog--minimized'); sync(); });
}
