// tableView.ts — the table, on the game page.
//
// A table is the group of people; a match is one game they play (see docs/tables.md). This is
// what the game page shows while no match is running: who is here, the code and link that bring
// someone else, the player's own way back in, the shared deck the table plays with, and — for
// the host — the way to start. It lives on the GAME page, not the lobby, for one reason above
// all: chat and voice are mounted there and must not be torn down between matches. A page
// navigation would drop the LiveKit connection and cut everyone off mid-sentence.
//
// It owns no state of its own. What it shows always comes from an authoritative table document.

import { createPlayerIdentity } from './lobby/playerListItem.js';
import { convertTokenToSnakeCase, getTokenName } from './lobby/tokens.js';
import {
	chooseContentLanguage, contentLanguageName, fillContentLanguageSelect,
} from './lobby/contentLanguage.js';
import { familyHasBots } from './familyTraits.js';
import type { GameInfo } from './models.js';

export interface TableViewDeps {
	t: (key: string, vars?: Record<string, unknown>) => string;
	/** True when the local player may start the next match and change the shared deck. */
	isHost: () => boolean;
	/** Ask the server to start the next match; rejects with a server error code. */
	start: () => Promise<void>;
	/** Host-only: change the deck the whole table plays with. */
	setContentLanguage?: (language: string) => Promise<void>;
	/** Host-only: seat a bot (an empty name lets the server pick one), or send one away. */
	addBot?: () => void;
	removeBot?: (playerId: string) => Promise<void>;
	/** Leave this table and go back to the lobby. */
	leave?: () => void;
	/** Speak a line through the game's own announcer (never a second live region). */
	announce: (key: string, vars?: Record<string, unknown>, instant?: boolean) => void;
	/** Copy text, reporting whether it reached the clipboard. */
	copy?: (text: string, buttonId: string) => Promise<boolean>;
	/** This player's re-entry code for THIS table, or null when they have none saved. */
	rejoinCode?: () => string | null;
}

export class TableView {
	private deps: TableViewDeps | null = null;
	private root: HTMLElement | null = null;
	private gameSurface: HTMLElement | null = null;
	private surfaceIntro: HTMLElement | null = null;
	private heading: HTMLElement | null = null;
	private players: HTMLUListElement | null = null;
	private code: HTMLElement | null = null;
	private inviteUrl: HTMLElement | null = null;
	private rejoinMount: HTMLElement | null = null;
	private deckGroup: HTMLElement | null = null;
	private deckSelect: HTMLSelectElement | null = null;
	private deckSummary: HTMLElement | null = null;
	private startButton: HTMLButtonElement | null = null;
	private waitingHint: HTMLElement | null = null;
	private copyCodeButton: HTMLButtonElement | null = null;
	private copyLinkButton: HTMLButtonElement | null = null;
	private addBotButton: HTMLButtonElement | null = null;
	private leaveButton: HTMLButtonElement | null = null;
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
		this.inviteUrl = document.getElementById('table-invite-url');
		this.rejoinMount = document.getElementById('table-rejoin-mount');
		this.deckGroup = document.getElementById('table-content-language-group');
		this.deckSelect = document.getElementById('table-content-language') as HTMLSelectElement | null;
		this.deckSummary = document.getElementById('table-content-language-current');
		this.startButton = document.getElementById('table-start-btn') as HTMLButtonElement | null;
		this.waitingHint = document.getElementById('table-waiting-host');
		this.copyCodeButton = document.getElementById('table-copy-code') as HTMLButtonElement | null;
		this.copyLinkButton = document.getElementById('table-copy-link') as HTMLButtonElement | null;
		this.addBotButton = document.getElementById('table-add-bot') as HTMLButtonElement | null;
		this.leaveButton = document.getElementById('table-leave') as HTMLButtonElement | null;

		this.startButton?.addEventListener('click', () => void this.startMatch());
		this.addBotButton?.addEventListener('click', () => this.deps?.addBot?.());
		this.leaveButton?.addEventListener('click', () => this.deps?.leave?.());
		this.copyCodeButton?.addEventListener('click', () =>
			void this.copy(this.code?.textContent ?? '', 'table-copy-code'));
		this.copyLinkButton?.addEventListener('click', () =>
			void this.copy(this.inviteUrl?.textContent ?? '', 'table-copy-link'));
		this.deckSelect?.addEventListener('change', event => {
			void this.deps?.setContentLanguage?.((event.target as HTMLSelectElement).value);
		});
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

	/** Apply an authoritative table document: the roster, the ways in, and the shared deck. */
	setTable(table: GameInfo): void {
		this.renderPlayers(table);
		this.renderInvites(table);
		this.renderRejoinCode();
		this.renderContentLanguage(table);
		this.renderBotChair(table);
		this.render();
	}

	private renderPlayers(table: GameInfo): void {
		if (!this.players || !this.deps) return;
		const t = this.deps.t;
		const host = this.deps.isHost();
		this.players.replaceChildren();
		for (const player of table.players ?? []) {
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
			// A bot is the host's to send away again; a person is not.
			if (host && player.isBot && this.deps.removeBot) {
				const remove = document.createElement('button');
				remove.type = 'button';
				remove.className = 'secondary-button player-item__remove-bot';
				remove.textContent = t('lobby.removeBot');
				remove.setAttribute('aria-label', t('lobby.removeBotOf').replace('{{name}}', player.name));
				remove.addEventListener('click', () => void this.deps?.removeBot?.(player.id));
				item.appendChild(remove);
			}
			this.players.appendChild(item);
		}
	}

	/**
	 * The empty chair, offered only where it means something: to the host, on a family that has a
	 * bot brain, while the table is not already full.
	 */
	private renderBotChair(table: GameInfo): void {
		if (!this.addBotButton || !this.deps) return;
		const offered = this.deps.isHost()
			&& !!this.deps.addBot
			&& familyHasBots(table.gameType ?? undefined)
			&& (table.players?.length ?? 0) < (table.maxPlayers ?? 0);
		this.addBotButton.hidden = !offered;
	}

	private renderInvites(table: GameInfo): void {
		const code = table.inviteCode ?? '';
		if (this.code) this.code.textContent = code;
		if (this.inviteUrl) this.inviteUrl.textContent = code ? `${window.location.origin}?code=${code}` : '';
		if (this.copyCodeButton) this.copyCodeButton.hidden = !code;
		if (this.copyLinkButton) this.copyLinkButton.hidden = !code;
	}

	/**
	 * The player's own RE-ENTRY code: the one thing worth noting down, since typed back into the
	 * lobby's code box it recovers this seat from any browser — the saved session may not survive.
	 */
	private renderRejoinCode(): void {
		if (!this.rejoinMount || !this.deps) return;
		const code = this.deps.rejoinCode?.() ?? null;
		this.rejoinMount.replaceChildren();
		if (!code) return;
		const t = this.deps.t;

		const box = document.createElement('div');
		box.className = 'invite-code rejoin-code';
		const title = document.createElement('h3');
		title.textContent = t('lobby.rejoin.codeTitle');
		const value = document.createElement('div');
		value.className = 'invite-code__value';
		value.textContent = code;
		const copyButton = document.createElement('button');
		copyButton.type = 'button';
		copyButton.className = 'secondary-button';
		copyButton.id = 'table-copy-rejoin';
		copyButton.textContent = t('lobby.rejoin.copy');
		copyButton.addEventListener('click', () => void this.copy(code, copyButton.id));
		const hint = document.createElement('p');
		hint.className = 'form-hint';
		hint.textContent = t('lobby.rejoin.hint');
		box.append(title, value, copyButton, hint);
		this.rejoinMount.appendChild(box);
	}

	/** The host gets a real select; everyone else one read-only sentence. */
	private renderContentLanguage(table: GameInfo): void {
		if (!this.deps) return;
		const t = this.deps.t;
		const languages = table.contentLanguages ?? [];
		const selected = chooseContentLanguage(languages, table.language);
		const offered = languages.length > 0 && !!selected;
		const host = offered && this.deps.isHost() && !!this.deps.setContentLanguage;

		if (this.deckGroup) this.deckGroup.hidden = !host;
		if (this.deckSelect && host) {
			// Rebuilding under the player's fingers would lose the focus they are using to choose.
			const focused = document.activeElement === this.deckSelect;
			fillContentLanguageSelect(this.deckSelect, languages, selected, key => t(key));
			if (focused) this.deckSelect.focus();
		}

		if (this.deckSummary) {
			const showSummary = offered && !host;
			this.deckSummary.hidden = !showSummary;
			this.deckSummary.textContent = showSummary
				? t('lobby.contentLanguageCurrent').replace('{{language}}', contentLanguageName(selected, key => t(key)))
				: '';
		}
	}

	private render(): void {
		if (!this.deps) return;
		const host = this.deps.isHost();
		// Only the host starts matches, and the control is absent — not disabled — for everyone
		// else: a dead button in the tab order is noise, and there is nothing to explain. What a
		// guest gets instead is the plain truth about what they are waiting for.
		if (this.startButton) {
			this.startButton.hidden = !host;
			this.startButton.textContent = this.deps.t('table.start');
			this.startButton.setAttribute('aria-disabled', this.starting ? 'true' : 'false');
		}
		if (this.waitingHint) this.waitingHint.hidden = host;
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

	private async copy(text: string, buttonId: string): Promise<void> {
		if (!this.deps?.copy || !text) return;
		const copied = await this.deps.copy(text, buttonId);
		this.deps.announce(copied ? 'table.copied' : 'table.copy_failed', {}, true);
	}
}

export const tableView = new TableView();
