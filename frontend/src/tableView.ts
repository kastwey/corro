// tableView.ts — the table between matches, on the game page.
//
// A table is the group of people; a match is one game they play (see docs/tables.md). This is
// what the game page shows while no match is running: who is here, the code to invite someone
// else, and — for the host — the way to start the next one. It lives on the GAME page, not the
// lobby, for one reason above all: chat and voice are mounted there and must not be torn down
// between matches. A page navigation would drop the LiveKit connection and cut everyone off
// mid-sentence, exactly when they are talking about the game that just ended.
//
// It owns no state of its own. What it shows always comes from an authoritative payload.

import { createPlayerIdentity } from './lobby/playerListItem.js';
import { convertTokenToSnakeCase, getTokenName } from './lobby/tokens.js';
import type { LobbyPlayer } from './models.js';

export interface TableViewDeps {
	t: (key: string, vars?: Record<string, unknown>) => string;
	/** True when the local player may start the next match. */
	isHost: () => boolean;
	/** Ask the server to start the next match; rejects with a server error code. */
	start: () => Promise<void>;
	/** Speak a line through the game's own announcer (never a second live region). */
	announce: (key: string, vars?: Record<string, unknown>, instant?: boolean) => void;
	/** Copy the invite code, reporting whether it reached the clipboard. */
	copyCode?: (code: string) => Promise<boolean>;
}

export class TableView {
	private deps: TableViewDeps | null = null;
	private root: HTMLElement | null = null;
	private gameSurface: HTMLElement | null = null;
	private surfaceIntro: HTMLElement | null = null;
	private heading: HTMLElement | null = null;
	private players: HTMLUListElement | null = null;
	private code: HTMLElement | null = null;
	private startButton: HTMLButtonElement | null = null;
	private copyButton: HTMLButtonElement | null = null;
	private starting = false;

	init(deps: TableViewDeps): void {
		this.deps = deps;
		this.root = document.getElementById('table-view');
		this.gameSurface = document.getElementById('game-layout');
		// The keyboard introduction ("focus will move to your hand") describes a game that is not
		// running while the table is up, so it travels with the board rather than staying behind
		// to tell people about a surface that is not there.
		this.surfaceIntro = document.getElementById('game-surface-intro');
		this.heading = document.getElementById('table-heading');
		this.players = document.getElementById('table-players') as HTMLUListElement | null;
		this.code = document.getElementById('table-code');
		this.startButton = document.getElementById('table-start-btn') as HTMLButtonElement | null;
		this.copyButton = document.getElementById('table-copy-code') as HTMLButtonElement | null;

		this.startButton?.addEventListener('click', () => void this.startMatch());
		this.copyButton?.addEventListener('click', () => void this.copyInviteCode());
	}

	isVisible(): boolean {
		return !!this.root && !this.root.hidden;
	}

	/**
	 * Show the table and put the game surface away. `focus` moves the reading position to the
	 * heading — true when the player ARRIVES here (a match ended, the end dialog was dismissed),
	 * false when the table is merely the page's starting state and focus is placed elsewhere.
	 */
	show(options: { focus?: boolean } = {}): void {
		if (!this.root) return;
		this.root.hidden = false;
		if (this.gameSurface) this.gameSurface.hidden = true;
		if (this.surfaceIntro) this.surfaceIntro.hidden = true;
		this.render();
		if (options.focus) this.heading?.focus();
	}

	/** Put the table away: a match is running and the board is what matters. */
	hide(): void {
		if (!this.root) return;
		this.root.hidden = true;
		if (this.gameSurface) this.gameSurface.hidden = false;
		if (this.surfaceIntro) this.surfaceIntro.hidden = false;
	}

	/** The people at the table, from the authoritative roster. */
	setPlayers(players: readonly LobbyPlayer[]): void {
		if (!this.players || !this.deps) return;
		const t = this.deps.t;
		this.players.replaceChildren();
		for (const player of players) {
			const tokenKey = convertTokenToSnakeCase(player.token as unknown as string);
			const item = document.createElement('li');
			item.className = 'player-item';
			// Same identity the waiting room builds, commas and all: the parts are laid out with a
			// CSS gap, and without a real separator a screen reader reads them glued together.
			item.appendChild(createPlayerIdentity({
				tokenKey,
				playerName: player.name,
				tokenName: getTokenName(tokenKey, key => t(key)),
				statusText: '',
				hostText: player.isHost ? ` ${t('lobby.playerHost')}` : '',
				botText: player.isBot ? ` ${t('lobby.playerBot')}` : '',
			}));
			this.players.appendChild(item);
		}
	}

	/** The code that brings someone else to this table. */
	setInviteCode(code: string | null | undefined): void {
		if (!this.code) return;
		this.code.textContent = code ?? '';
		if (this.copyButton) this.copyButton.hidden = !code;
	}

	private render(): void {
		if (!this.deps || !this.startButton) return;
		// Only the host starts matches, and the control is absent — not disabled — for everyone
		// else: a dead button in the tab order is noise, and there is nothing to explain.
		this.startButton.hidden = !this.deps.isHost();
		this.startButton.textContent = this.deps.t('table.start');
		this.startButton.setAttribute('aria-disabled', this.starting ? 'true' : 'false');
	}

	private async startMatch(): Promise<void> {
		if (!this.deps || this.starting) return;
		this.starting = true;
		this.render();
		try {
			await this.deps.start();
		} catch {
			// The next match is the whole point of the button; failing silently would leave the
			// host pressing it again with no idea why nothing happens.
			this.deps.announce('table.start_failed', {}, true);
		} finally {
			this.starting = false;
			this.render();
		}
	}

	private async copyInviteCode(): Promise<void> {
		if (!this.deps?.copyCode) return;
		const code = this.code?.textContent ?? '';
		if (!code) return;
		const copied = await this.deps.copyCode(code);
		this.deps.announce(copied ? 'table.code_copied' : 'table.code_copy_failed', {}, true);
	}
}

export const tableView = new TableView();
