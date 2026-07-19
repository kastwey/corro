// connectionPanel.ts — always-visible side panel showing the player's live
// connection status and two escape hatches:
//   - "Leave game": abandon permanently (declares bankruptcy, freeing every owned
//     property back to the bank) after a confirmation.
//   - "Disconnect": drop the SignalR connection, leaving the other players waiting.
// It is one of the F6 landmark regions and an ARIA toolbar: focusing it lands on the
// first action (roving tabindex, ArrowLeft/Right move between the actions) while the
// live status is exposed via the toolbar's description so it is read on entry.

import { tSync } from './i18nBinder.js';

const t = (key: string, vars?: Record<string, any>) => tSync(`game.${key}`, vars);

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface ConnectionPanelDeps {
	/** Abandon the game for good (confirmed leave → bankruptcy, frees properties). */
	onLeaveGame: () => void;
	/** Drop the SignalR connection, leaving the others waiting. */
	onDisconnect: () => void;
	/** Copy the re-entry code to the clipboard (and announce the outcome). */
	onCopyRejoinCode?: (code: string) => void;
}

export class ConnectionPanel {
	private container: HTMLElement | null = null;
	private statusText: HTMLElement | null = null;
	private buttons: HTMLButtonElement[] = [];
	private activeIndex = 0;
	private deps: ConnectionPanelDeps | null = null;
	private status: ConnectionStatus = 'connected';
	private rejoinCode: string | null = null;
	private rejoinBtn: HTMLButtonElement | null = null;
	private actionsEl: HTMLElement | null = null;

	init(mount: HTMLElement, deps: ConnectionPanelDeps): void {
		this.deps = deps;
		if (this.container) return;

		// A toolbar role is not permitted on <aside>; the labelled toolbar itself
		// provides the complete semantic identity without an invalid host role.
		const aside = document.createElement('div');
		aside.id = 'connection-panel';
		aside.className = 'connection-panel';
		// The panel is an ARIA toolbar of its actions (roving tabindex), so focusing it
		// lands on the first action rather than the container.
		aside.setAttribute('role', 'toolbar');
		aside.setAttribute('aria-orientation', 'horizontal');
		aside.setAttribute('aria-label', t('conn_panel_title'));
		// Expose the live status as the toolbar's description so entering it reads
		// "Connection. Connected." — without this the status would go unheard on entry.
		aside.setAttribute('aria-describedby', 'connection-panel-status');
		aside.dataset.status = this.status;
		aside.addEventListener('keydown', (ev) => this.onKeyDown(ev));

		const title = document.createElement('h2');
		title.className = 'connection-panel__title';
		title.setAttribute('aria-hidden', 'true');
		title.textContent = t('conn_panel_title');

		const statusRow = document.createElement('p');
		statusRow.className = 'connection-panel__status';

		const dot = document.createElement('span');
		dot.className = 'connection-panel__dot';
		dot.setAttribute('aria-hidden', 'true');

		const statusText = document.createElement('span');
		statusText.className = 'connection-panel__status-text';
		statusText.id = 'connection-panel-status';
		statusText.setAttribute('aria-live', 'polite');
		statusText.textContent = t(`conn_status_${this.status}`);

		statusRow.append(dot, statusText);

		const actions = document.createElement('div');
		actions.className = 'connection-panel__actions';

		const leaveBtn = document.createElement('button');
		leaveBtn.type = 'button';
		leaveBtn.className = 'connection-panel__btn connection-panel__btn--leave';
		leaveBtn.textContent = t('conn_leave_action');
		leaveBtn.tabIndex = 0;
		leaveBtn.addEventListener('click', () => this.deps?.onLeaveGame());

		const disconnectBtn = document.createElement('button');
		disconnectBtn.type = 'button';
		disconnectBtn.className = 'connection-panel__btn connection-panel__btn--disconnect';
		disconnectBtn.textContent = t('conn_disconnect_action');
		disconnectBtn.tabIndex = -1;
		disconnectBtn.addEventListener('click', () => this.deps?.onDisconnect());

		actions.append(leaveBtn, disconnectBtn);
		aside.append(title, statusRow, actions);
		mount.appendChild(aside);

		this.container = aside;
		this.statusText = statusText;
		this.actionsEl = actions;
		this.buttons = [leaveBtn, disconnectBtn];
		if (this.rejoinCode) this.renderRejoinButton();
	}

	/**
	 * Show the player's RE-ENTRY code as one more toolbar action: its accessible name IS
	 * the code ("Re-entry code: A2B3C4D5. Press to copy"), so a player can re-read it any
	 * time, and activating it copies the code for safekeeping. This is the only thing a
	 * player needs to note down to survive losing the browser data (see the lobby's
	 * code box, which accepts it back).
	 */
	setRejoinCode(code: string | null): void {
		if (code === this.rejoinCode) return;
		this.rejoinCode = code;
		this.renderRejoinButton();
	}

	private renderRejoinButton(): void {
		if (!this.actionsEl) return;
		if (!this.rejoinCode) {
			if (this.rejoinBtn) {
				this.buttons = this.buttons.filter(b => b !== this.rejoinBtn);
				this.rejoinBtn.remove();
				this.rejoinBtn = null;
			}
			return;
		}
		if (!this.rejoinBtn) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'connection-panel__btn connection-panel__btn--rejoin-code';
			btn.tabIndex = -1;
			btn.addEventListener('click', () => {
				if (this.rejoinCode) this.deps?.onCopyRejoinCode?.(this.rejoinCode);
			});
			this.actionsEl.appendChild(btn);
			this.buttons.push(btn);
			this.rejoinBtn = btn;
		}
		this.rejoinBtn.textContent = t('conn_rejoin_code', { code: this.rejoinCode });
	}

	/** Reflect the current connection state in the panel (text + styling hook). */
	setStatus(status: ConnectionStatus): void {
		this.status = status;
		if (this.container) this.container.dataset.status = status;
		if (this.statusText) this.statusText.textContent = t(`conn_status_${status}`);
	}

	/** Move keyboard focus to the first action so a screen reader reads the toolbar
	 *  (and its status description) on entry. */
	focus(): boolean {
		if (!this.container || this.buttons.length === 0) return false;
		this.setActiveIndex(0, true);
		return true;
	}

	private setActiveIndex(index: number, focus: boolean): void {
		if (this.buttons.length === 0) return;
		this.activeIndex = Math.max(0, Math.min(index, this.buttons.length - 1));
		this.buttons.forEach((b, i) => { b.tabIndex = i === this.activeIndex ? 0 : -1; });
		if (focus) this.buttons[this.activeIndex]?.focus();
	}

	private onKeyDown(ev: KeyboardEvent): void {
		if (this.buttons.length === 0) return;
		switch (ev.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				ev.preventDefault();
				this.setActiveIndex((this.activeIndex + 1) % this.buttons.length, true);
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				ev.preventDefault();
				this.setActiveIndex((this.activeIndex - 1 + this.buttons.length) % this.buttons.length, true);
				break;
			case 'Home':
				ev.preventDefault();
				this.setActiveIndex(0, true);
				break;
			case 'End':
				ev.preventDefault();
				this.setActiveIndex(this.buttons.length - 1, true);
				break;
		}
	}
}

export const connectionPanel = new ConnectionPanel();
