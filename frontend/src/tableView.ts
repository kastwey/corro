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
import { winningSide } from './endScreen.js';
import { applyHouseRuleValues, readHouseRuleValues, renderHouseRules } from './houseRules.js';
import { RovingToolbar, type ToolbarItem } from './rovingToolbar.js';
import { RovingToolbarList } from './accessibleList.js';
import type { GameInfo, GameState, PackageUploadResponse } from './models.js';

export interface TableViewDeps {
	t: (key: string, vars?: Record<string, unknown>) => string;
	/** True when the local player may start the next match and change the shared deck. */
	isHost: () => boolean;
	/** Ask the server to start the next match; rejects with a server error code. */
	start: () => Promise<void>;
	/** Host-only: change the deck the whole table plays with. */
	setContentLanguage?: (language: string) => Promise<void>;
	/** This table's package (rules, pieces), or null when the server cannot produce it. */
	loadRules?: () => Promise<PackageUploadResponse | null>;
	/** Host-only: keep these rule values for the next match. */
	saveRules?: (values: Record<string, boolean | number | string>) => Promise<void>;
	/** Host-only: seat a bot (an empty name lets the server pick one), or send one away. */
	addBot?: () => void;
	removeBot?: (playerId: string) => Promise<void>;
	/** Go back to the lobby, keeping this seat. */
	backToLobby?: () => void;
	/** Give this seat up for good (confirmed by the caller). */
	abandon?: () => void;
	/** Host only: end the table for everyone (confirmed by the caller). */
	deleteTable?: () => void;
	/** Host only: hand the sceptre to another human at this table. */
	makeHost?: (playerId: string) => Promise<void>;
	/** Open the full standings of a finished match (the same end screen it raised). */
	showStandings?: (match: GameState) => void;
	/** Speak a line through the game's own announcer (never a second live region). */
	announce: (text: string) => void;
	/**
	 * Turn a refused server call into the reason it refused, when it carries one. A table that
	 * cannot start because somebody has no team must say THAT, not "it could not be started".
	 */
	explainError?: (error: unknown) => string | null;
	/**
	 * Re-run the standard translation pass over freshly built markup. The rules panel is painted
	 * from the package DEFINITION, which lands before the package's WORDS do, so its labels have
	 * to be re-resolved once those arrive rather than staying frozen as the keys they were built
	 * with.
	 */
	translateDom?: (element: HTMLElement) => void;
	/** Copy text, reporting whether it reached the clipboard. */
	copy?: (text: string, buttonId: string) => Promise<boolean>;
	/** This player's re-entry code for THIS table, or null when they have none saved. */
	rejoinCode?: () => string | null;
	/**
	 * Ask somebody at this table to be friends, addressed by their SEAT. Absent when the local
	 * player is not signed in, which is when there would be nothing to ask with.
	 *
	 * It exists beside the list of who is online because that list is opt-in: somebody who keeps
	 * to themselves there would otherwise be unreachable by the very people they play with.
	 */
	askToBeFriends?: (playerId: string) => Promise<void>;
	/** This player's own seat, so the roster never offers to befriend them to themselves. */
	selfPlayerId?: () => string | null;
}

export class TableView {
	private deps: TableViewDeps | null = null;
	private root: HTMLElement | null = null;
	private gameSurface: HTMLElement | null = null;
	private surfaceIntro: HTMLElement | null = null;
	private heading: HTMLElement | null = null;
	private players: HTMLUListElement | null = null;
	/** The roster's keyboard model, built once the list element is known. */
	private playerNav: RovingToolbarList | null = null;
	private code: HTMLElement | null = null;
	private inviteUrl: HTMLElement | null = null;
	private rejoinMount: HTMLElement | null = null;
	private deckGroup: HTMLElement | null = null;
	private deckSelect: HTMLSelectElement | null = null;
	private deckSummary: HTMLElement | null = null;
	private waitingHint: HTMLElement | null = null;
	private copyCodeButton: HTMLButtonElement | null = null;
	private copyLinkButton: HTMLButtonElement | null = null;
	private addBotButton: HTMLButtonElement | null = null;
	/** The table's actions, described per render rather than toggled in the markup. */
	private readonly actions = new RovingToolbar();
	private lastMatchBox: HTMLElement | null = null;
	private lastMatchLine: HTMLElement | null = null;
	private standingsButton: HTMLButtonElement | null = null;
	private lastMatch: GameState | null = null;
	private intro: HTMLElement | null = null;
	/** How many matches this table has finished: the first game is not "another" one. */
	private matchesPlayed = 0;
	private rulesBox: HTMLDetailsElement | null = null;
	private rulesFields: HTMLElement | null = null;
	/** The package whose rules are on screen, so they are fetched and built once per table. */
	private rulesPackageToken: string | null = null;
	/**
	 * Set while a bot the host just asked for is on its way. The table it comes back in may no
	 * longer offer the chair, so the next render decides where the keyboard goes: another bot if
	 * there is still room, otherwise the thing they were filling the table FOR.
	 */
	private claimFocusAfterSeatingBot = false;
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
		this.intro = document.getElementById('table-intro');
		this.players = document.getElementById('table-players') as HTMLUListElement | null;
		this.code = document.getElementById('table-code');
		this.inviteUrl = document.getElementById('table-invite-url');
		this.rejoinMount = document.getElementById('table-rejoin-mount');
		this.deckGroup = document.getElementById('table-content-language-group');
		this.deckSelect = document.getElementById('table-content-language') as HTMLSelectElement | null;
		this.deckSummary = document.getElementById('table-content-language-current');
		this.waitingHint = document.getElementById('table-waiting-host');
		this.copyCodeButton = document.getElementById('table-copy-code') as HTMLButtonElement | null;
		this.copyLinkButton = document.getElementById('table-copy-link') as HTMLButtonElement | null;
		this.addBotButton = document.getElementById('table-add-bot') as HTMLButtonElement | null;

		const actionsHost = document.getElementById('table-actions');
		if (actionsHost) {
			this.actions.mount(actionsHost, {
				label: deps.t('table.actionsLabel'),
				className: 'table-view__actions',
				buttonClassName: 'secondary-button',
				classPrefix: 'table-actions',
				announce: text => deps.announce(text),
			});
		}
		this.rulesBox = document.getElementById('table-rules') as HTMLDetailsElement | null;
		this.rulesFields = document.getElementById('table-rules-fields');
		this.lastMatchBox = document.getElementById('table-last-match');
		this.lastMatchLine = document.getElementById('table-last-match-line');
		this.standingsButton = document.getElementById('table-standings') as HTMLButtonElement | null;

		this.addBotButton?.addEventListener('click', () => {
			// Seating a bot may be the act that FILLS the table, and then the chair the host just
			// used stops existing. Claim the next authoritative repaint so the keyboard lands
			// somewhere deliberate instead of falling to the top of the page.
			this.claimFocusAfterSeatingBot = true;
			this.deps?.addBot?.();
		});
		this.standingsButton?.addEventListener('click', () => {
			if (this.lastMatch) this.deps?.showStandings?.(this.lastMatch);
		});
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
		this.matchesPlayed = table.matchesPlayed ?? 0;
		this.renderPlayers(table);
		this.renderInvites(table);
		this.renderRejoinCode();
		this.renderContentLanguage(table);
		this.renderBotChair(table);
		this.renderLastMatch(table);
		void this.renderRules(table);
		this.render();
	}

	/**
	 * The board's own house rules, for the NEXT match — the host's to change while nothing is
	 * running. Built once per table (the package's rule catalogue does not change under it) and
	 * opened on the values the last match was played with, not on the board's defaults.
	 *
	 * Offered to the host alone. A guest reading a rule they cannot change, in a panel that
	 * repaints under them whenever the host moves something, is worse than the board's own guide.
	 */
	private async renderRules(table: GameInfo): Promise<void> {
		if (!this.rulesBox || !this.rulesFields || !this.deps) return;
		const token = table.packageToken ?? null;
		const offered = !!token && this.deps.isHost() && !!this.deps.loadRules && !!this.deps.saveRules;
		if (!offered) {
			this.rulesBox.hidden = true;
			return;
		}
		if (this.rulesPackageToken !== token) {
			this.rulesPackageToken = token;
			const pkg = await this.deps.loadRules!();
			const rules = pkg?.houseRules ?? [];
			if (rules.length === 0) {
				// A board that declares no rules has nothing to offer here.
				this.rulesBox.hidden = true;
				this.rulesFields.replaceChildren();
				return;
			}
			this.rulesFields.innerHTML = renderHouseRules(
				pkg!.ruleGroups ?? [], rules, key => this.deps!.t(key));
			this.rulesFields.addEventListener('change', () => void this.saveRules());
			this.rulesBox.hidden = false;
		}
		// The labels carry their own keys, so the translation pass resolves them wherever the
		// package's words happen to be in flight — including on a table that painted this panel
		// before they arrived, which showed a rulebook written in identifiers.
		this.deps.translateDom?.(this.rulesFields);
		// Re-applied on every authoritative table, so a host who changed them in another tab — or
		// whose own change was refused — sees what the server actually holds.
		if (!this.rulesBox.hidden) {
			applyHouseRuleValues(this.rulesFields, table.ruleValues);
		}
	}

	private async saveRules(): Promise<void> {
		if (!this.rulesFields || !this.deps?.saveRules) return;
		try {
			await this.deps.saveRules(readHouseRuleValues(this.rulesFields));
			this.deps.announce(this.deps.t('table.rulesSaved'));
		} catch (error) {
			this.deps.announce(this.deps.explainError?.(error) ?? this.deps.t('table.rulesFailed'));
		}
	}

	/**
	 * What the table remembers of the game it just played. The end screen is raised once, live,
	 * for whoever was there when it finished; this is how everyone else finds out — someone who
	 * reconnected a minute later, or who dismissed it and wants to look again. Without it, a
	 * dropped connection at the wrong moment meant never learning who won.
	 */
	private renderLastMatch(table: GameInfo): void {
		if (!this.lastMatchBox || !this.lastMatchLine || !this.deps) return;
		const match = table.lastMatch ?? null;
		this.lastMatch = match;
		this.lastMatchBox.hidden = !match;
		if (this.standingsButton) this.standingsButton.hidden = !match || !this.deps.showStandings;
		if (!match) {
			this.lastMatchLine.textContent = '';
			return;
		}
		const side = winningSide(match);
		const winner = side.teamName ?? match.winnerName ?? '';
		this.lastMatchLine.textContent = winner
			? this.deps.t('table.lastMatchWinner').replace('{{winner}}', winner)
			: this.deps.t('table.lastMatchNoWinner');
	}

	/**
	 * Who is here, as the SAME widget the match itself uses for its roster: one tab stop for the
	 * whole list, Up/Down between people, Right into a person's actions, Shift+F10 for the menu.
	 *
	 * The host's buttons used to be plain tab stops on the row, so walking past a table of eight
	 * people meant sixteen presses on the way to anything else. Each row is now a single focus
	 * stop whose label reads the whole row in one sentence, and its actions live behind the arrow
	 * key — exactly the bargain the players panel already makes in game.
	 */
	private renderPlayers(table: GameInfo): void {
		if (!this.players || !this.deps) return;
		const t = this.deps.t;
		const host = this.deps.isHost();
		this.players.replaceChildren();
		for (const player of table.players ?? []) {
			const tokenKey = convertTokenToSnakeCase(player.token as unknown as string);
			// getTokenName resolves a PACKAGE key and falls back to a readable name; the fallback
			// has to be honoured or an unresolved key is printed as itself, which is what a table
			// showed before its package's words had arrived.
			const tokenName = getTokenName(tokenKey, (key, fallback) => {
				const translated = t(key);
				return translated === key ? fallback ?? key : translated;
			});
			const hostText = player.isHost ? ` ${t('lobby.playerHost')}` : '';
			const botText = player.isBot ? ` ${t('lobby.playerBot')}` : '';
			// The public name of whoever holds this seat, shown to everybody at the table. It is a
			// name chosen to be public, and the people they dealt into a game are not the strangers
			// their presence setting is about. The account display name is still never shown.
			const handleText = player.handle
				? ` ${t('table.playerHandle', { handle: player.handle })}`
				: '';

			const item = document.createElement('li');
			item.className = 'player-item';
			item.dataset.playerId = player.id;
			item.tabIndex = -1;
			// The row speaks as ONE line, so the label is written as one rather than left to be
			// assembled out of the visible parts a screen reader would otherwise glue together.
			item.setAttribute('aria-label',
				[player.name, handleText.trim(), tokenName, hostText.trim(), botText.trim()]
					.filter(Boolean).join(', ') + '.');
			// Same identity the waiting room builds, commas and all: the parts are laid out with a
			// CSS gap, and without a real separator a screen reader reads them glued together.
			item.appendChild(createPlayerIdentity({
				tokenKey,
				playerName: player.name + handleText,
				tokenName,
				statusText: '',
				hostText,
				botText,
			}));

			const actions = document.createElement('div');
			actions.className = 'player-item__actions';
			// A bot is the host's to send away again; a person is not.
			if (host && player.isBot && this.deps.removeBot) {
				actions.appendChild(this.rowAction(
					'player-item__remove-bot',
					t('lobby.removeBot'),
					t('lobby.removeBotOf').replace('{{name}}', player.name),
					() => void this.deps?.removeBot?.(player.id)));
			}
			// The sceptre can be handed over on purpose, not only by leaving — and only to another
			// person: a bot cannot host a table.
			if (host && !player.isBot && !player.isHost && this.deps.makeHost) {
				actions.appendChild(this.rowAction(
					'player-item__make-host',
					t('table.makeHost'),
					t('table.makeHostOf').replace('{{name}}', player.name),
					() => void this.deps?.makeHost?.(player.id)));
			}
			// Anybody signed in, other than yourself. A bot has no account, so the check that a seat
			// holds one covers it — but it is named here too, because "ask the robot to be friends"
			// is the kind of thing that should be impossible for a stated reason.
			if (this.deps.askToBeFriends && !player.isBot && player.hasAccount
				&& player.id !== this.deps.selfPlayerId?.()) {
				actions.appendChild(this.rowAction(
					'player-item__befriend',
					t('table.askToBeFriends'),
					t('table.askToBeFriendsOf').replace('{{name}}', player.name),
					() => void this.deps?.askToBeFriends?.(player.id)));
			}
			if (actions.childElementCount > 0) item.appendChild(actions);
			this.players.appendChild(item);
		}
		this.ensurePlayerNav();
		this.playerNav?.refreshRovingTabindex();
	}

	private rowAction(
		className: string,
		label: string,
		accessibleName: string,
		onActivate: () => void,
	): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = `secondary-button ${className}`;
		button.tabIndex = -1; // the row is the tab stop; Right arrow comes in here
		button.textContent = label;
		button.setAttribute('aria-label', accessibleName);
		button.addEventListener('click', onActivate);
		return button;
	}

	private ensurePlayerNav(): void {
		if (this.playerNav || !this.players) return;
		this.playerNav = new RovingToolbarList({
			list: this.players,
			itemSelector: '.player-item',
			toolbarButtonSelector: '.player-item__actions button',
			menuLabel: () => this.deps?.t('table.playerMenuLabel') ?? '',
			menuClass: 'player-context-menu',
			menuItemClass: 'player-context-menu-item',
			// Inside the table's own section, not on <body>: a menu left at the top level is
			// visible content belonging to no landmark, which is a real Axe violation and, more to
			// the point, content a reader browsing by landmark would never find. The menu is
			// position:fixed, so where it hangs changes nothing about where it appears.
			menuHost: () => this.players?.closest('#table-view') ?? null,
		});
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

		if (!this.claimFocusAfterSeatingBot) return;
		this.claimFocusAfterSeatingBot = false;
		// Another chair if the table still has room — seating bots is usually done in a run — and
		// otherwise the match itself, which is what a full table is for. Never nothing: a control
		// that vanishes under the keyboard drops the reader on <body>, which reads as the page
		// having jumped to the top (reported live).
		if (offered) this.addBotButton.focus();
		else (document.getElementById('table-start-btn') ?? this.heading)?.focus();
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
		const t = this.deps.t;
		const host = this.deps.isHost();

		// Written for whoever is reading it. The host is not waiting for the host, and telling
		// them to wait for themselves is the kind of copy that makes a product feel unfinished.
		// The key is swapped along with the text so a language change re-translates the RIGHT one.
		if (this.intro) {
			const key = host ? 'table.introHost' : 'table.introGuest';
			this.intro.setAttribute('data-i18n', key);
			this.intro.textContent = t(key);
		}

		if (this.waitingHint) this.waitingHint.hidden = host;
		this.actions.setLabel(t('table.actionsLabel'));
		this.actions.render(this.actionItems(host));
	}

	/**
	 * What THIS reader may do at the table, right now. Described rather than toggled: only the
	 * host starts a match or ends the table, and an action that is not on offer is simply not in
	 * the list — no button left in the document to be kept hidden, and nothing for a screen
	 * reader to count that is not really there.
	 *
	 * The host's controls are ABSENT for a guest rather than disabled. The never-`disabled` rule
	 * is about refusals a player could plausibly reach and deserves an explanation for; "you are
	 * not the host" is not a refusal, it is a different set of choices. What a guest gets instead
	 * is the line above, telling them plainly what they are waiting for.
	 */
	private actionItems(host: boolean): ToolbarItem[] {
		const t = (key: string) => this.deps!.t(key);
		const items: ToolbarItem[] = [];

		if (host) {
			items.push({
				id: 'start',
				elementId: 'table-start-btn',
				// A table that has never played is not starting "another" game.
				label: t(this.matchesPlayed > 0 ? 'table.startAnother' : 'table.start'),
				className: 'primary-button',
				busy: this.starting,
				onActivate: () => void this.startMatch(),
			});
		}
		// Three different goodbyes, named as three different things: the lobby keeps your seat,
		// leaving gives it up for good, and deleting ends the table for everyone.
		if (this.deps!.backToLobby) {
			items.push({
				id: 'back', elementId: 'table-back', label: t('table.backToLobby'),
				onActivate: () => this.deps!.backToLobby!(),
			});
		}
		if (this.deps!.abandon) {
			items.push({
				id: 'abandon', elementId: 'table-abandon', label: t('table.abandon'),
				onActivate: () => this.deps!.abandon!(),
			});
		}
		if (host && this.deps!.deleteTable) {
			items.push({
				id: 'delete', elementId: 'table-delete', label: t('table.delete'),
				onActivate: () => this.deps!.deleteTable!(),
			});
		}
		return items;
	}

	private async startMatch(): Promise<void> {
		if (!this.deps || this.starting) return;
		this.starting = true;
		this.render();
		try {
			await this.deps.start();
		} catch (error) {
			// The next match is the whole point of the button; failing silently would leave the
			// host pressing it again with no idea why nothing happens — and the server's own
			// reason ("somebody still has no team") is far more useful than a generic refusal.
			this.deps.announce(this.deps.explainError?.(error) ?? this.deps.t('table.start_failed'));
		} finally {
			this.starting = false;
			this.render();
		}
	}

	private async copy(text: string, buttonId: string): Promise<void> {
		if (!this.deps?.copy || !text) return;
		const copied = await this.deps.copy(text, buttonId);
		this.deps.announce(this.deps.t(copied ? 'table.copied' : 'table.copy_failed'));
	}
}

export const tableView = new TableView();
