/**
 * Lobby - Main orchestrator for game creation and joining
 */
import {
	TokenKey, GameInfo, LobbyPlayer,
	CreateGameRequest, CreateGameResponse, JoinGameResponse, ResolvedJoinCode,
	GameSettings, SavedGameInfo, PackageUploadResponse, ShippedBoard
} from '../models.js';
import { gameClient } from '../gameClient.js';
import { hasUnlockCode, addUnlockCode } from '../unlockCodes.js';
import { i18nBinder } from '../i18nBinder.js';
import { randomBotName } from '../botNames.js';
import { familyHasBots } from '../familyTraits.js';
import { teamDisplayName } from '../enginePalette.js';
import { popupMenu } from '../popupMenu.js';
import { renderHouseRules, readHouseRuleValues } from '../houseRules.js';
import { GameSessionStore, SavedGame } from '../sessionUtils.js';
import { dialogManager } from '../dialogManager.js';
import { FocusTrap } from '../focusTrap.js';
import {
	convertTokenToSnakeCase, getUsedTokens, getTokenName, renderTokenSelector
} from './tokens.js';
import { renderSeatSelector, getUsedSeats } from './seats.js';
import { LatestOnly } from './latestOnly.js';
import { tokenIconHtml, setPackageTokens } from '../tokenIcons.js';
import { initThemeToggle } from '../themeToggle.js';
import { applyRuleSettings, readRuleSettings } from './ruleFields.js';
import { buildBotNameForm } from './botNameForm.js';
import { createPlayerIdentity } from './playerListItem.js';
import {
	t, translateServerError, showLoading, showError,
	showSection, hideSection, showView, focusFirstField, getElement, getInputValue, getSelectedRadio,
	copyToClipboard, updateUrlWithGame, clearUrlParams, getUrlParam, localizeBoardName, formatGameDate, parseHubErrorCode, isResumableToBoardStatus,
	pickPackageName, renderBoardOptions, lobbyViewFromState, LobbyView
} from './ui.js';

class UnifiedLobbyUI {
	private currentGame: GameInfo | null = null;
	private currentPlayerId: string = '';
	private isHost: boolean = false;
	/** The shipped boards offered in the picker (engine boards served as packages). */
	private shippedBoards: ShippedBoard[] = [];
	/** The staged package for this game (a shipped board OR a custom upload) — always set once ready. */
	private uploadedPackage: PackageUploadResponse | null = null;
	/** Serialises board staging so a superseded selection's late result never overwrites the current one. */
	private staging = new LatestOnly();
	/** The package operation Create must wait for. A user can select a board and submit before its
	 *  POST+i18n chain settles; reading uploadedPackage earlier created the PREVIOUS game instead. */
	private pendingPackageStage: Promise<void> = Promise.resolve();

	constructor() {
		this.init();
	}

	private async init(): Promise<void> {
		await this.initializeI18n();
		this.setupThemeToggle();
		dialogManager.init(); // Initialize DialogManager
		// Keep keyboard focus inside the lobby: Tab / Shift+Tab wrap instead of
		// escaping to the browser chrome. Yields while a modal <dialog> is open.
		new FocusTrap({ getRoot: () => document.body, scopeToOpenModal: true }).activate();
		// Wire the client + DOM listeners BEFORE any network call so the lobby is interactive
		// immediately. Otherwise a slow or failing shipped-boards fetch would leave every button
		// (create / join / navigation) dead until it resolved.
		this.setupEventHandlers();
		this.setupUI();
		await this.connectToServer();
		await this.fetchLobbyOptions();
		this.checkExistingSession();
	}

	private setupThemeToggle(): void {
		const mount = document.getElementById('theme-toggle-mount');
		if (mount) {
			initThemeToggle(mount);
		}
	}

	private async initializeI18n(): Promise<void> {
		const { i18nBinder } = await import('../i18nBinder.js');
		await i18nBinder.init();
		await i18nBinder.applyI18n(); // Apply translations to DOM
	}

	private async fetchLobbyOptions(): Promise<void> {
		try {
			this.shippedBoards = await gameClient.getShippedBoards();
			this.renderBoardSelector();
			this.renderAllTokenSelectors();
			// Stage the initially-selected shipped board so the lobby has a valid package from the
			// start (its rules + tokens fill the panel), exactly as if it had been uploaded.
			const first = getElement<HTMLSelectElement>('board-selector')?.value || this.shippedBoards[0]?.id;
			if (first) await this.trackPackageStage(this.selectShippedBoard(first));
		} catch (error) {
			console.error('Error fetching lobby options:', error);
		}
	}

	private async connectToServer(): Promise<void> {
		try {
			await gameClient.connect();
		} catch (error) {
			console.error('Error connecting to server:', error);
			showError(t('lobby.errors.connectionFailed', 'Connection failed'));
		}
	}

	private setupEventHandlers(): void {
		gameClient.on('connected', () => console.debug('Connected to server'));
		gameClient.on('disconnected', () => showError(t('lobby.errors.disconnected')));
		gameClient.on('gameCreated', (data) => this.handleGameCreated(data));
		gameClient.on('gameJoined', (data) => this.handleGameJoined(data));
		gameClient.on('playerJoined', (data) => this.handlePlayerJoined(data));
		gameClient.on('lobbyUpdated', (data) => this.handleLobbyUpdated(data));
		gameClient.on('teamAssigned', (data) => this.handleTeamAssigned(data));
		gameClient.on('gameStarted', (data) => this.handleGameStarted(data));
		gameClient.on('gameDeleted', (data) => this.handleGameDeleted(data));
		gameClient.on('error', (msg) => showError(translateServerError(msg)));

		// Language change handler
		window.addEventListener('languageChanged', () => {
			this.onLanguageChanged();
		});
	}

	private setupUI(): void {
		this.setupLanguageSelector();
		this.setupHomeNavigation();
		this.setupBoardUpload();
		this.setupCreateGameForm();
		this.setupJoinGameForm();
		this.setupCopyLinkButton();
		this.setupCopyCodeButton();
		this.setupStartGameButton();
		this.setupUnlockShortcut();
	}

	/**
	 * Ctrl+Shift+Alt+C opens the unlock-code prompt (a self-hosting feature): entering a code reveals
	 * the hidden boards that share it. Keyed off `code` (physical C key) so an Alt-modified character on
	 * some layouts doesn't miss. A deliberately obscure chord — it isn't discoverable by accident, which
	 * is the point.
	 */
	private setupUnlockShortcut(): void {
		const handleShortcut = (e: KeyboardEvent) => {
			const isC = e.code === 'KeyC' || e.key.toLowerCase() === 'c';
			if (!e.ctrlKey || !e.shiftKey || !e.altKey || !isC) return;
			e.preventDefault();
			e.stopPropagation();
			this.openUnlockDialog();
		};
		// Capture at window level so the chord remains global while focus is in a create/join
		// form control, even if that control consumes bubbling keyboard events. Listen on keyup
		// too: some browser/keyboard combinations reserve the Ctrl+Shift+C keydown but still
		// deliver its release. openUnlockDialog() makes the second event an idempotent no-op.
		window.addEventListener('keydown', handleShortcut, true);
		window.addEventListener('keyup', handleShortcut, true);
	}

	/**
	 * The unlock-code prompt: a native <dialog> with one text field. Enter (or Unlock) tests the code
	 * against the server; a code that reveals nothing is not saved. Focus lands on the input directly
	 * and the prompt is in the title, so a screen-reader user hears what to type on open.
	 */
	private openUnlockDialog(): void {
		// One prompt at a time: ignore the chord while a dialog is already open.
		if (getElement<HTMLDialogElement>('game-dialog')?.open) return;

		const wrap = document.createElement('div');
		const prompt = document.createElement('p');
		prompt.textContent = t('lobby.unlock.prompt', 'Enter a code to reveal hidden boards.');
		const input = document.createElement('input');
		input.type = 'text';
		input.id = 'unlock-code-input';
		input.className = 'dialog-unlock-input';
		input.autocomplete = 'off';
		input.setAttribute('aria-label', t('lobby.unlock.label', 'Unlock code'));
		wrap.appendChild(prompt);
		wrap.appendChild(input);

		const submit = () => {
			const value = input.value;
			dialogManager.close();
			void this.applyUnlockCode(value);
		};
		// Enter in the field submits, matching the Unlock button.
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); submit(); }
		});

		dialogManager.show({
			title: t('lobby.unlock.title', 'Unlock code'),
			titleI18nKey: 'lobby.unlock.title',
			contentElement: wrap,
			className: 'dialog-unlock',
			initialFocus: input,
			buttons: [
				{ label: t('common.cancel'), i18nKey: 'common.cancel', variant: 'secondary', action: () => dialogManager.close() },
				{ label: t('lobby.unlock.submit', 'Unlock'), i18nKey: 'lobby.unlock.submit', variant: 'primary', action: submit },
			],
		});
	}

	/**
	 * Tests an entered code: asks the server for the board list WITH the candidate folded in and diffs
	 * against what is shown now. New boards -> persist the code, re-render the picker, announce them.
	 * Nothing new -> the code is not saved and the player is told. The server holds no state; the codes
	 * live in the browser and are replayed, so this both validates and (on success) unlocks.
	 */
	private async applyUnlockCode(raw: string): Promise<void> {
		const code = raw.trim();
		if (!code) return;
		if (hasUnlockCode(code)) {
			this.announceInLobby(t('lobby.unlock.already', 'That code is already active.'));
			return;
		}
		try {
			const before = new Set(this.shippedBoards.map(b => b.id));
			const boards = await gameClient.getShippedBoards(code);
			const revealed = boards.filter(b => !before.has(b.id));
			if (revealed.length === 0) {
				this.announceInLobby(t('lobby.unlock.none', 'No board was unlocked with that code.'));
				return;
			}
			addUnlockCode(code);
			this.shippedBoards = boards;
			this.renderBoardSelector();
			const lang = i18nBinder.getCurrentLanguage();
			const names = revealed.map(b => pickPackageName(b.name, lang)).join(', ');
			this.announceInLobby(t('lobby.unlock.revealed', 'Unlocked: {{names}}').replace('{{names}}', names));
		} catch (error) {
			console.error('Error applying unlock code:', error);
			showError(t('lobby.unlock.error', 'Could not check that code.'));
		}
	}

	// === Event Handlers ===

	private handleGameCreated(data: CreateGameResponse): void {
		this.currentGame = data.game;
		// The real hostId is in game.hostId, hostSecretId is only for authentication
		this.currentPlayerId = data.game.hostId;
		this.isHost = true;
		const host = data.game.players.find(p => p.id === data.game.hostId);
		const board = this.uploadedPackage ? this.localizePackageName(this.uploadedPackage.name) : '';
		GameSessionStore.saveGame({
			gameId: data.game.gameId,
			playerId: data.game.hostId,
			playerSecretId: data.hostSecretId,
			playerName: host?.name ?? '',
			token: (host?.token as unknown as string) ?? '',
			board,
			isHost: true,
			rejoinCode: data.hostRejoinCode
		});
		this.showGameCreated(data.game, data.inviteCode);
	}

	private handleGameJoined(data: JoinGameResponse): void {
		this.currentGame = data.game;
		this.currentPlayerId = data.playerId;
		this.isHost = false;
		const me = data.game.players.find(p => p.id === data.playerId);
		GameSessionStore.saveGame({
			gameId: data.game.gameId,
			playerId: data.playerId,
			playerSecretId: data.playerSecretId,
			playerName: me?.name ?? '',
			token: (me?.token as unknown as string) ?? '',
			board: '',
			isHost: false,
			rejoinCode: data.rejoinCode
		});
		this.showGameJoined(data.game);
	}

	private handlePlayerJoined(_data: { playerId: string; playerName: string }): void {
		if (this.currentGame) {
			// Refresh game state to get updated player list
			this.refreshGameState();
		}
	}

	private handleLobbyUpdated(game: GameInfo): void {
		// Server sent updated game state, update our local state and UI
		this.currentGame = game;
		this.updatePlayerList(game.players);
	}

	private handleGameStarted(data: { gameId: string }): void {
		window.location.href = `board.html?gameId=${data.gameId}`;
	}

	private async refreshGameState(): Promise<void> {
		if (!this.currentGame) return;
		try {
			const gameInfo = await gameClient.getGameByInviteCode(this.currentGame.gameId);
			if (gameInfo) {
				this.currentGame = gameInfo;
				this.updatePlayerList(gameInfo.players);
			}
		} catch (error) {
			console.error('Error refreshing game state:', error);
		}
	}

	// === Form Setup ===

	private setupLanguageSelector(): void {
		const selector = getElement<HTMLSelectElement>('language-selector');
		const applyBtn = getElement<HTMLButtonElement>('language-apply-btn');
		if (!selector || !applyBtn) return;

		const getCurrentLang = () => (window as any).i18next?.language || 'en';
		selector.value = getCurrentLang();

		applyBtn.addEventListener('click', async () => {
			const { changeLanguage } = await import('../i18nBinder.js');
			await changeLanguage(selector.value);
		});
	}

	private setupCreateGameForm(): void {
		const form = getElement('create-form');
		const btn = getElement('create-button');
		const handler = async (e: Event) => { e.preventDefault(); await this.createGame(); };
		form?.addEventListener('submit', handler);
		btn?.addEventListener('click', handler);
		// The valid team counts depend on the CHOSEN player count: refresh them together.
		getElement<HTMLSelectElement>('max-players')?.addEventListener('change', () => {
			if (this.uploadedPackage) this.renderTeamCountOptions(this.uploadedPackage);
		});
	}

	/** Wires the .corro upload control: upload on file pick; a Remove button clears it. */
	private setupBoardUpload(): void {
		const input = getElement<HTMLInputElement>('board-upload');
		input?.addEventListener('change', () => {
			const file = input.files?.[0];
			if (file) void this.trackPackageStage(this.uploadSelectedPackage(file));
		});
		getElement('board-upload-remove')?.addEventListener('click', () => this.clearUploadedPackage());
		// Picking a shipped board stages it (replacing any custom upload) through the same path.
		getElement<HTMLSelectElement>('board-selector')?.addEventListener('change', (e) => {
			const id = (e.target as HTMLSelectElement).value;
			if (id) void this.trackPackageStage(this.selectShippedBoard(id));
		});
	}

	/** Record the newest package operation. Create waits until this exact chain — including any
	 *  fallback stage it starts — is the last one still pending. */
	private trackPackageStage(stage: Promise<void>): Promise<void> {
		this.pendingPackageStage = stage;
		return stage;
	}

	private async waitForPackageStage(): Promise<void> {
		for (;;) {
			const pending = this.pendingPackageStage;
			await pending;
			if (pending === this.pendingPackageStage) return;
		}
	}

	/**
	 * Swaps the UI between the built-in board picker and the "uploaded board" state: with a package
	 * active the picker is hidden (no stale "Spain" showing) and replaced by the uploaded-board
	 * name plus a Remove button; without one, the picker is shown again.
	 */
	private setUploadedPackageActive(active: boolean): void {
		getElement('board-selector-group')?.classList.toggle('hidden', active);
		getElement('board-uploaded-group')?.classList.toggle('hidden', !active);
		getElement('board-upload-remove')?.classList.toggle('hidden', !active);
	}

	/**
	 * Applies a freshly-staged package (shipped or uploaded) to the lobby: merge its i18n, offer its
	 * tokens, and fill the rules panel from its declarations (or its defaults). Shared by the
	 * shipped-board picker and the upload control so both drive the identical package flow.
	 */
	private async applyStagedPackage(pkg: PackageUploadResponse, ticket?: number): Promise<void> {
		// Merge the package's i18n so its rule names (and other keys) resolve here in the lobby.
		await i18nBinder.loadPackageResources(pkg.token);
				// A newer board selection may have superseded this one while the i18n loaded: stop so a
		// stale default can't overwrite the chosen board's tokens/rules (see LatestOnly).
		if (ticket !== undefined && !this.staging.isCurrent(ticket)) return;
		this.uploadedPackage = pkg;
		// Offer the package's own tokens (if any); empty falls back to the built-in set.
		setPackageTokens(pkg.tokens);
		this.renderAllTokenSelectors();
		// A race board also offers its seats (squadron colours): the host picks theirs here;
		// joiners pick from the remaining ones. Hidden (and never submitted) for property.
		const seatFieldset = getElement('seat-fieldset');
		const seatList = getElement('seat-list');
		const raceSeats = pkg.seats ?? [];
		seatFieldset?.classList.toggle('hidden', raceSeats.length === 0);
		if (seatList && raceSeats.length > 0) renderSeatSelector(seatList, raceSeats, t);
		// Classic pairs need two teams of two on opposite seats: exactly a 4-seat board.
		const teamsGroup = getElement('teams-group');
		teamsGroup?.classList.toggle('hidden', raceSeats.length !== 4);
		const teamsBox = getElement<HTMLInputElement>('race-teams');
		if (teamsBox) teamsBox.checked = false;
		// Fill the player-count selector from this board's supported range (min..max).
		this.renderPlayerCount(pkg);
		// Journey boards can split the table into equal teams: offer the valid team counts
		// for the chosen player count (the group hides when nothing divides).
		this.renderTeamCountOptions(pkg);
		// Reset any previous board's dynamic rules, then render this board's.
		const pkgRules = getElement('package-rules');
		if (pkgRules) { pkgRules.innerHTML = ''; pkgRules.classList.add('hidden'); }
		const details = getElement<HTMLDetailsElement>('rules-details');
		details?.classList.remove('rules-details--package');
		details?.classList.remove('hidden');
		if (pkg.houseRules && pkg.houseRules.length > 0) {
			this.renderPackageRules(pkg);  // the package declares its own rules
		} else if ((pkg.gameType ?? 'property') === 'property') {
			this.applyPackageSettingsToRulesPanel(pkg.settings); // built-in PROPERTY panel fallback
		} else {
			// Another family with no declared rules (e.g. a race board): the built-in fieldsets
			// are property rules and would be nonsense here — hide the whole panel.
			details?.classList.add('hidden');
		}
		// Open the rules panel so the host actually sees the board's rules (both the shipped-board
		// picker and the upload land here; previously only the upload path opened it, so a shipped
		// board rendered its rules into a still-collapsed <details> — "nothing showed up inside").
		if (details && !details.classList.contains('hidden')) details.open = true;
	}

	/** Stages the chosen shipped board and applies it; the picker stays visible (no Remove button). */
	private async selectShippedBoard(id: string): Promise<void> {
		// Arrowing through the picker can stage several boards in quick succession. This status is
		// deliberately outside any live region and aria-hidden: the select already voices each
		// option, so announcing "Loading game board" after every Arrow press only interrupts it.
		const status = getElement('board-loading-status');
		const uploadStatus = getElement('board-upload-status');
		const ticket = this.staging.begin();
		this.uploadedPackage = null;
		getElement('create-form')?.setAttribute('aria-busy', 'true');
		if (uploadStatus) uploadStatus.textContent = '';
		if (status) status.textContent = t('game.loading_board', 'Loading game…');
		try {
			const pkg = await gameClient.stageShippedBoard(id);
			// Superseded by a newer pick while this one staged: drop it so it can't win the race.
			if (!this.staging.isCurrent(ticket)) return;
			await this.applyStagedPackage(pkg, ticket);
			if (!this.staging.isCurrent(ticket)) return;
			if (status) status.textContent = '';
			// A shipped board is the default state: keep the picker, drop the uploaded-board chrome.
			const input = getElement<HTMLInputElement>('board-upload');
			if (input) input.value = '';
			this.setUploadedPackageActive(false);
		} catch (error) {
			if (!this.staging.isCurrent(ticket)) return;
			const message = (error instanceof Error && error.message) ? error.message
				: t('lobby.uploadError', 'Could not load the package');
			if (status) status.textContent = message;
			showError(message);
			console.error('Error staging shipped board:', error);
		} finally {
			if (this.staging.isCurrent(ticket)) getElement('create-form')?.removeAttribute('aria-busy');
		}
	}

	/** Uploads the chosen .corro and pre-fills the rules panel from the package's defaults. */
	private async uploadSelectedPackage(file: File): Promise<void> {
		const status = getElement('board-upload-status');
		const ticket = this.staging.begin();
		this.uploadedPackage = null;
		getElement('create-form')?.setAttribute('aria-busy', 'true');
		if (status) status.textContent = t('lobby.uploading', 'Uploading…');
		try {
			const pkg = await gameClient.uploadPackage(file);
			// A shipped-board pick made while the upload was in flight wins; abandon the upload.
			if (!this.staging.isCurrent(ticket)) return;
			await this.applyStagedPackage(pkg, ticket);
			if (!this.staging.isCurrent(ticket)) return;
			// Replace the board picker with the uploaded-board name; clear the transient status.
			const uploadedName = getElement('board-uploaded-name');
			if (uploadedName) {
				uploadedName.textContent = t('lobby.uploadUsing', 'Uploaded board: {{name}}')
					.replace('{{name}}', this.localizePackageName(pkg.name));
			}
			if (status) status.textContent = '';
			this.setUploadedPackageActive(true);
			// Open the rules panel so the host sees (and can tweak) the package's defaults.
			const details = getElement<HTMLDetailsElement>('rules-details');
			if (details) details.open = true;
		} catch (error) {
			// Surface the server's specific reason ("board must have 40 squares…") when it sent one,
			// so the host knows why the board was rejected; fall back to a generic message.
			const reason = (error instanceof Error && error.message) ? error.message : '';
			const message = reason || t('lobby.uploadError', 'Could not load the package');
			if (status) status.textContent = message;
			showError(message);
			console.error('Error uploading package:', error);
			this.clearUploadedPackage(); // revert to the selected shipped board
		} finally {
			if (this.staging.isCurrent(ticket)) getElement('create-form')?.removeAttribute('aria-busy');
		}
	}

	/** Discards a custom upload and reverts to the shipped board currently chosen in the picker. */
	private clearUploadedPackage(): void {
		const input = getElement<HTMLInputElement>('board-upload');
		if (input) input.value = '';
		const uploadedName = getElement('board-uploaded-name');
		if (uploadedName) uploadedName.textContent = '';
		const id = getElement<HTMLSelectElement>('board-selector')?.value || this.shippedBoards[0]?.id;
		if (id) void this.trackPackageStage(this.selectShippedBoard(id));
		else this.setUploadedPackageActive(false);
	}

	/**
	 * Journey boards only: fills the team-count combo with the divisors of the CHOSEN player
	 * count that give at least two equal teams of at least two players («2 equipos de 2»…).
	 * Hidden for other families, and when no count divides (e.g. 5 players). Rebuilt when the
	 * board is staged and whenever the player count changes.
	 */
	private renderTeamCountOptions(pkg: PackageUploadResponse): void {
		const group = getElement('team-count-group');
		const select = getElement<HTMLSelectElement>('team-count');
		if (!group || !select) return;

		const chosen = select.value;
		const players = Number(getElement<HTMLSelectElement>('max-players')?.value) || pkg.maxPlayers || 0;
		const counts: number[] = [];
		if ((pkg.gameType ?? 'property') === 'journey') {
			for (let teams = 2; teams <= players / 2; teams++) {
				if (players % teams === 0) counts.push(teams);
			}
		}

		select.innerHTML = '';
		const none = document.createElement('option');
		none.value = '0';
		none.textContent = t('lobby.teamsNone');
		select.appendChild(none);
		for (const n of counts) {
			const option = document.createElement('option');
			option.value = String(n);
			option.textContent = t('lobby.teamsOf')
				.replace('{{teams}}', String(n))
				.replace('{{size}}', String(players / n));
			select.appendChild(option);
		}
		// Keep the host's pick when it survives the new player count; else back to "none".
		select.value = counts.includes(Number(chosen)) ? chosen : '0';
		group.classList.toggle('hidden', counts.length === 0);
	}

	/**
	 * Fills the player-count selector with this board's supported range (min..max), defaulting to the
	 * maximum. The range is per-board, so the options are rebuilt every time a board is staged.
	 */
	private renderPlayerCount(pkg: PackageUploadResponse): void {
		const select = getElement<HTMLSelectElement>('max-players');
		if (!select) return;
		const min = pkg.minPlayers || 2;
		const max = Math.max(pkg.maxPlayers || 8, min);
		select.innerHTML = '';
		for (let n = min; n <= max; n++) {
			const option = document.createElement('option');
			option.value = String(n);
			option.textContent = t('lobby.playersOption', '{{count}} players').replace('{{count}}', String(n));
			select.appendChild(option);
		}
		select.value = String(max); // default to a full table
	}

	/** Renders the package's declared rules into the panel and hides the built-in fieldsets. */
	private renderPackageRules(pkg: PackageUploadResponse): void {
		const container = getElement('package-rules');
		if (!container) return;
		container.innerHTML = renderHouseRules(pkg.ruleGroups ?? [], pkg.houseRules ?? [], k => i18nBinder.tSync(k));
		container.classList.remove('hidden');
		getElement('rules-details')?.classList.add('rules-details--package');
	}

	/** Picks the package name in the active UI language, via the pure (tested) helper. */
	private localizePackageName(name: Record<string, string>): string {
		return pickPackageName(name, i18nBinder.getCurrentLanguage());
	}

	/** Mirrors a package's rule defaults into the rules-panel inputs (the host can still tweak them). */
	private applyPackageSettingsToRulesPanel(s: GameSettings): void {
		applyRuleSettings(s,
			(id, value) => { const el = getElement<HTMLInputElement>(id); if (el) el.value = String(value); },
			(id, value) => { const el = getElement<HTMLInputElement>(id); if (el) el.checked = value; });
	}

	private setupJoinGameForm(): void {
		// Step 1: Validate code
		const step1Form = getElement('join-step1-form');
		const validateBtn = getElement('validate-code-button');
		const validateHandler = async (e: Event) => { e.preventDefault(); await this.validateInviteCode(); };
		step1Form?.addEventListener('submit', validateHandler);
		validateBtn?.addEventListener('click', validateHandler);

		// Back button
		getElement('back-button')?.addEventListener('click', () => this.showJoinStep1());

		// Step 2: Join
		const joinForm = getElement('join-step2-form');
		const joinBtn = getElement('join-final-button');
		const joinHandler = async (e: Event) => { e.preventDefault(); await this.joinGame(); };
		joinForm?.addEventListener('submit', joinHandler);
		joinBtn?.addEventListener('click', joinHandler);
	}

	private setupCopyLinkButton(): void {
		getElement('copy-link-btn')?.addEventListener('click', async () => {
			const url = getElement('invite-url')?.textContent || '';
			if (!url || !await copyToClipboard(url, 'copy-link-btn')) {
				showError(t('lobby.errors.copyLink'));
			}
		});
	}

	private setupCopyCodeButton(): void {
		getElement('copy-code-btn')?.addEventListener('click', async () => {
			const code = getElement('lobby-code')?.textContent || '';
			if (!code || !await copyToClipboard(code, 'copy-code-btn')) {
				showError(t('lobby.errors.copyCode'));
			}
		});
	}

	private setupStartGameButton(): void {
		getElement('start-game-btn')?.addEventListener('click', () => this.startGame());
		getElement('add-bot-btn')?.addEventListener('click', () => this.promptBotName());
	}

	/**
	 * Adding a bot asks for its NAME first: type one, or roll the hat («Dame uno
	 * aleatorio») for a silly road-trip name in the host's language. Left empty, the
	 * server falls back to its plain "Bot N".
	 */
	private promptBotName(): void {
		const { content, input, submit } = buildBotNameForm({
			t,
			rollName: (current) => randomBotName(i18nBinder.getCurrentLanguage(), current),
			onSubmit: (name) => {
				dialogManager.close();
				void this.addBot(name);
			},
		});

		dialogManager.show({
			title: t('lobby.botNameTitle'),
			contentElement: content,
			className: 'dialog-bot-name',
			// Focus returns to the Add-bot chair on close — passed explicitly because a
			// screen-reader activation of the button may not leave DOM focus on it.
			returnFocusTo: 'add-bot-btn',
			buttons: [
				{
					label: 'Cancel', i18nKey: 'common.cancel', variant: 'secondary',
					action: () => dialogManager.close(),
				},
				{
					label: 'Add', i18nKey: 'lobby.botNameAdd', variant: 'primary',
					action: submit,
				},
			],
		});
		// Land ON the name box (the dialog's own initial focus goes to a button at ~50ms).
		window.setTimeout(() => input.focus(), 80);
	}

	private async addBot(name?: string): Promise<void> {
		if (!this.currentGame || !this.isHost) return;
		try {
			await gameClient.addBot({ gameId: this.currentGame.gameId, hostId: this.currentPlayerId, name });
		} catch (error) {
			console.error('Error adding bot:', error);
			showError(t('lobby.errors.addBot'));
		}
	}

	/**
	 * Wires the top-level navigation between views: the home entry buttons (create /
	 * join) and the "back to home" buttons on the create, join and waiting views. Going
	 * back to home is always non-destructive — a created/joined game keeps living on the
	 * server and in this browser's saved list, so it simply reappears in the home list.
	 */
	private setupHomeNavigation(): void {
		getElement('go-create-btn')?.addEventListener('click', () => this.showCreateView());
		getElement('go-join-btn')?.addEventListener('click', () => this.showJoinView());
		// The in-page "Back" buttons unwind history so the on-screen button and the browser's
		// Back button traverse the same stack (create/join → home) — never off the site.
		getElement('create-back-btn')?.addEventListener('click', () => window.history.back());
		getElement('join-back-btn')?.addEventListener('click', () => window.history.back());
		getElement('waiting-back-btn')?.addEventListener('click', () => this.showHome());
		// Browser Back/Forward moves BETWEEN lobby views instead of leaving the site: without this
		// the create/join form was the first history entry, so Back walked off to the prior site.
		window.addEventListener('popstate', (e) => this.renderLobbyView(lobbyViewFromState(e.state)));
	}

	/** Show the home view (games list + entry buttons) and refresh the saved games. */
	private showHome(): void {
		clearUrlParams();
		showView('view-home');
		void this.refreshSavedGames();
	}

	/** Enter the create view (user-initiated): render it AND record a history entry so Back returns home. */
	private showCreateView(): void {
		this.renderCreateView();
		window.history.pushState({ lobbyView: 'view-create' }, '');
	}

	/** Enter the join view (user-initiated): render it AND record a history entry so Back returns home. */
	private showJoinView(): void {
		this.renderJoinView();
		window.history.pushState({ lobbyView: 'view-join' }, '');
	}

	/** Route a Back/Forward navigation to the matching view WITHOUT pushing a new entry (avoids a loop). */
	private renderLobbyView(view: LobbyView): void {
		if (view === 'view-create') this.renderCreateView();
		else if (view === 'view-join') this.renderJoinView();
		else this.showHome();
	}

	/** Render the create-game view, landing focus on the first field (the board picker). */
	private renderCreateView(): void {
		showView('view-create');
		focusFirstField('view-create');
	}

	/** Render the join view, reset to step 1 (enter code), focus the code field. */
	private renderJoinView(): void {
		this.showJoinStep1();
		showView('view-join');
		focusFirstField('view-join');
	}

	// === Game Actions ===

	private async createGame(): Promise<void> {
		// A board selection starts a POST + package-i18n chain. A fast submit must use the NEW
		// package, never the previous staged one (hidden packages made this race easy to hit).
		await this.waitForPackageStage();
		const hostName = getInputValue('host-name');
		const token = getSelectedRadio('#create-form', 'token') as TokenKey | null;

		if (!hostName) return showError(t('lobby.errors.enterName'));
		if (!token) return showError(t('lobby.errors.selectToken'));
		// Every board is a staged package now (shipped or uploaded); one must be ready.
		if (!this.uploadedPackage) return showError(t('lobby.errors.selectBoard'));

		// A package that declares its own rules sends the host's chosen values; otherwise the
		// built-in rules panel is read into settings.
		const pkgRules = getElement('package-rules');
		const ruleValues = (this.uploadedPackage.houseRules?.length && pkgRules)
			? readHouseRuleValues(pkgRules) : undefined;

		// The player-count selector is populated from the staged board's min..max range.
		const maxPlayers = Number(getElement<HTMLSelectElement>('max-players')?.value) || this.uploadedPackage.maxPlayers || 8;

		// The host's seat pick (race boards only; the fieldset stays hidden for property).
		const hostSeatId = getSelectedRadio('#seat-list', 'seat') ?? undefined;
		// Classic pairs: only offered (and only submitted) for 4-seat race boards.
		const raceTeams = getElement<HTMLInputElement>('race-teams')?.checked
			&& !getElement('teams-group')?.classList.contains('hidden') || undefined;

		// Journey team mode: only when the combo is offered and a count is picked.
		const teamCount = (!getElement('team-count-group')?.classList.contains('hidden')
			&& Number(getElement<HTMLSelectElement>('team-count')?.value)) || undefined;

		const request: CreateGameRequest = {
			hostName, hostToken: token, language: i18nBinder.getCurrentLanguage(), maxPlayers,
			// `board` is just the display label; the server uses packageToken.
			board: this.localizePackageName(this.uploadedPackage.name),
			packageToken: this.uploadedPackage.token,
			ruleValues,
			hostSeatId,
			raceTeams,
			teamCount,
			settings: this.readGameSettings()
		};

		// A board may carry a create-time NOTICE (a package-authored warning key, e.g. "play this only
		// with blind people"). The engine doesn't know or interpret the text — it resolves the package's
		// key and asks the host to confirm before the game is created. Shown EVERY time, by design.
		const warningKey = this.uploadedPackage.warning;
		if (warningKey) {
			dialogManager.showConfirm({
				title: t('lobby.boardNotice.title', 'Notice'),
				titleI18nKey: 'lobby.boardNotice.title',
				message: t(warningKey),
				confirmI18nKey: 'lobby.boardNotice.confirm',
				cancelI18nKey: 'common.cancel',
				focusConfirm: true,
				onConfirm: () => void this.submitCreateGame(request),
			});
			return;
		}

		await this.submitCreateGame(request);
	}

	/** Sends the create-game request. Shared by the direct path and the post-notice confirmation. */
	private async submitCreateGame(request: CreateGameRequest): Promise<void> {
		try {
			showLoading(true);
			await gameClient.createGame(request);
		} catch (error) {
			console.error('Error creating game:', error);
			showError(t('lobby.errors.createGame'));
		} finally {
			showLoading(false);
		}
	}

	/** Reads the optional "Game rules" panel into a GameSettings payload (via the shared rule table). */
	private readGameSettings(): GameSettings {
		return readRuleSettings(
			id => getElement<HTMLInputElement>(id)?.value,
			id => getElement<HTMLInputElement>(id)?.checked ?? false);
	}

	private async joinGame(): Promise<void> {
		const playerName = getInputValue('player-name-step2');
		const token = getSelectedRadio('#join-token-list', 'token') as TokenKey | null;

		if (!this.currentGame) return showError(t('lobby.errors.enterCode'));
		if (!playerName) return showError(t('lobby.errors.enterName'));
		if (!token) return showError(t('lobby.errors.selectToken'));

		const request = {
			gameId: this.currentGame.gameId,
			playerName,
			playerToken: token,
			// The seat pick (race boards only; the hidden fieldset yields undefined).
			seatId: getSelectedRadio('#join-seat-list', 'seat') ?? undefined
		};
		try {
			showLoading(true);
			await gameClient.joinGame(request);
		} catch (error: any) {
			console.error('Error joining game:', error);
			console.error('   Error message:', error?.message);
			console.error('   Error stack:', error?.stack);
			const msg = translateServerError(error?.message || '');
			showError(msg || t('lobby.errors.joinGame'));
		} finally {
			showLoading(false);
		}
	}

	private async startGame(): Promise<void> {
		if (!this.currentGame || !this.isHost) return showError(t('lobby.errors.hostOnly'));

		try {
			showLoading(true);
			await gameClient.startGame({
				gameId: this.currentGame.gameId,
				hostId: this.currentPlayerId
			});
		} catch (error) {
			console.error('Error starting game:', error);
			showError(t('lobby.errors.startGame'));
		} finally {
			showLoading(false);
		}
	}

	private async validateInviteCode(): Promise<void> {
		const code = getInputValue('lobby-code-input').toUpperCase();
		if (!code) return showError(t('lobby.errors.enterCode'));

		try {
			showLoading(true);
			// The one code box accepts an INVITE code (join as a new player) or a
			// player's RE-ENTRY code (reclaim their seat) — the server tells which.
			const resolved = await gameClient.resolveJoinCode(code);
			if (resolved.kind === 'seat') {
				this.showRejoinConfirm(code, resolved);
			} else if (resolved.game) {
				this.currentGame = resolved.game;
				await this.showJoinStep2(resolved.game);
			}
		} catch (error) {
			console.error('Error validating code:', error);
			showError(this.inviteErrorMessage(error));
		} finally {
			showLoading(false);
		}
	}

	/**
	 * A RE-ENTRY code was typed: show who the seat belongs to and ask before claiming —
	 * claiming rotates the seat's secret (it kicks any stale session out for good), so it
	 * must never happen as a side effect of just LOOKING a code up.
	 */
	private showRejoinConfirm(code: string, seat: ResolvedJoinCode): void {
		if (seat.gameOver) {
			showError(translateServerError('GAME_OVER'));
			return;
		}
		hideSection('join-step1-form');
		hideSection('join-step2');
		showSection('rejoin-confirm');

		const title = getElement('rejoin-confirm-title');
		if (title) title.textContent = t('lobby.rejoin.title');
		const desc = getElement('rejoin-confirm-desc');
		if (desc) {
			desc.textContent = `${t('lobby.rejoin.found')} ${seat.playerName ?? ''}. `
				+ (seat.status === 'WaitingForPlayers'
					? t('lobby.rejoin.statusWaiting')
					: t('lobby.rejoin.statusActive'));
		}

		const warning = getElement('rejoin-confirm-warning');
		if (warning) {
			warning.textContent = t('lobby.rejoin.connectedWarning');
			warning.classList.toggle('hidden', !seat.connected);
		}

		const enter = getElement<HTMLButtonElement>('rejoin-confirm-enter');
		if (enter) {
			enter.textContent = t('lobby.rejoin.enter');
			enter.onclick = () => { void this.claimRejoinCode(code); };
		}
		const cancel = getElement<HTMLButtonElement>('rejoin-confirm-cancel');
		if (cancel) {
			cancel.textContent = t('lobby.rejoin.cancel');
			cancel.onclick = () => {
				hideSection('rejoin-confirm');
				this.showJoinStep1();
			};
		}
		getElement('rejoin-confirm-title')?.focus();
	}

	/** Claim the seat: save the FRESH session (rotated secret) and resume the game. */
	private async claimRejoinCode(code: string): Promise<void> {
		try {
			showLoading(true);
			const session = await gameClient.claimSeatByRejoinCode(code);
			GameSessionStore.saveGame({
				gameId: session.gameId,
				playerId: session.playerId,
				playerSecretId: session.playerSecretId,
				playerName: session.playerName,
				token: session.token,
				board: session.board,
				isHost: session.isHost,
				rejoinCode: session.rejoinCode,
			});
			if (session.status === 'WaitingForPlayers') {
				// Back to the waiting room (host or guest view, like a normal resume).
				hideSection('rejoin-confirm');
				const saved = GameSessionStore.getGame(session.gameId);
				if (saved) await this.attemptReconnect(saved);
			} else {
				window.location.href = `board.html?gameId=${session.gameId}`;
			}
		} catch (error) {
			console.error('Error claiming seat:', error);
			const code2 = parseHubErrorCode(error);
			showError(code2 ? translateServerError(code2) : t('lobby.errors.validateCode'));
		} finally {
			showLoading(false);
		}
	}

	// === Session & Reconnection ===

	private checkExistingSession(): void {
		const inviteCode = getUrlParam('code');
		const gameIdFromUrl = getUrlParam('gameId');

		if (inviteCode) {
			showView('view-join');
			this.autoValidateInviteCode(inviteCode);
			return;
		}

		// Deep link to a specific game we already belong to: jump straight back into it.
		if (gameIdFromUrl) {
			const saved = GameSessionStore.getGame(gameIdFromUrl);
			if (saved) {
				this.attemptReconnect(saved);
				return;
			}
		}

		// Otherwise show the home view with the list of games this browser is part of.
		showView('view-home');
		void this.refreshSavedGames();
	}

	/**
	 * Load live info for every locally-saved game, prune the ones the server no longer
	 * knows about, and render the "your games" list. When the list is empty an
	 * empty-state hint is shown instead, so the home view always has content.
	 */
	private async refreshSavedGames(): Promise<void> {
		const list = getElement('your-games-list');
		if (!list) return;

		const saved = GameSessionStore.getGames();
		if (saved.length === 0) {
			this.renderSavedGamesEmptyState(list);
			return;
		}

		let infos: SavedGameInfo[] = [];
		try {
			infos = await gameClient.getGamesInfo(saved.map(g => g.gameId));
		} catch (error) {
			console.error('Error loading saved games info:', error);
		}

		// Prune games the server no longer knows (deleted / expired).
		const liveIds = new Set(infos.map(i => i.gameId));
		for (const g of saved) {
			if (!liveIds.has(g.gameId)) {
				GameSessionStore.removeGame(g.gameId);
			}
		}

		const remaining = GameSessionStore.getGames();
		if (remaining.length === 0) {
			this.renderSavedGamesEmptyState(list);
			return;
		}

		list.innerHTML = '';
		for (const game of remaining) {
			const info = infos.find(i => i.gameId === game.gameId);
			list.appendChild(this.renderSavedGameItem(game, info));
		}
		hideSection('your-games-empty');
	}

	/** Clear the list and show the "no games yet" hint in the home view. */
	private renderSavedGamesEmptyState(list: HTMLElement): void {
		list.innerHTML = '';
		showSection('your-games-empty');
	}

	/** Build a single "your games" list item with resume + delete/remove actions. */
	private renderSavedGameItem(game: SavedGame, info?: SavedGameInfo): HTMLElement {
		const li = document.createElement('li');
		li.className = 'saved-game-item';

		const tokenKey = convertTokenToSnakeCase((info?.players.find(p => p.id === game.playerId)?.token ?? game.token) as string);
		const boardName = localizeBoardName(info?.board || game.board || '');
		const statusKey = info ? `lobby.savedGames.status.${info.status}` : 'lobby.savedGames.status.unknown';
		const statusText = t(statusKey, info?.status ?? '');

		const connectedCount = info ? info.players.filter(p => p.connected).length : 0;
		const totalCount = info ? info.players.length : 0;
		const connectedText = info
			? t('lobby.savedGames.connectedCount', '{{connected}}/{{total}} connected')
				.replace('{{connected}}', String(connectedCount))
				.replace('{{total}}', String(totalCount))
			: '';

		const createdDate = info ? formatGameDate(info.createdAt) : '';
		const createdText = createdDate
			? t('lobby.savedGames.created', 'Created {{date}}').replace('{{date}}', createdDate)
			: '';

		const infoWrap = document.createElement('div');
		infoWrap.className = 'saved-game-info';
		// The pieces are joined with a non-breaking space so screen readers do not run the
		// texts together (a flex `gap` is purely visual and is not spoken).
		infoWrap.innerHTML =
			`<span class="saved-game-icon">${game.token ? tokenIconHtml(tokenKey) : ''}</span>` +
			`<span class="saved-game-name">${boardName || game.gameId}</span>` +
			`<span class="saved-game-status">&nbsp;${statusText}</span>` +
			(connectedText ? `<span class="saved-game-connected">&nbsp;${connectedText}</span>` : '') +
			(createdText ? `<span class="saved-game-created">&nbsp;${createdText}</span>` : '');
		li.appendChild(infoWrap);

		const actions = document.createElement('div');
		actions.className = 'saved-game-actions';

		const resumeBtn = document.createElement('button');
		resumeBtn.type = 'button';
		resumeBtn.className = 'btn btn-primary saved-game-resume';
		resumeBtn.textContent = t('lobby.savedGames.resume', 'Resume');
		resumeBtn.setAttribute('aria-label', `${t('lobby.savedGames.resume', 'Resume')} ${boardName || game.gameId}`);
		resumeBtn.addEventListener('click', () => this.resumeSavedGame(game, info));
		actions.appendChild(resumeBtn);

		if (game.isHost) {
			const deleteBtn = document.createElement('button');
			deleteBtn.type = 'button';
			deleteBtn.className = 'btn btn-danger saved-game-delete';
			deleteBtn.textContent = t('lobby.savedGames.delete', 'Delete game');
			deleteBtn.setAttribute('aria-label', `${t('lobby.savedGames.delete', 'Delete game')} ${boardName || game.gameId}`);
			deleteBtn.addEventListener('click', () => this.confirmDeleteSavedGame(game));
			actions.appendChild(deleteBtn);
		} else {
			const removeBtn = document.createElement('button');
			removeBtn.type = 'button';
			removeBtn.className = 'btn btn-secondary saved-game-remove';
			removeBtn.textContent = t('lobby.savedGames.remove', 'Remove from list');
			removeBtn.setAttribute('aria-label', `${t('lobby.savedGames.remove', 'Remove from list')} ${boardName || game.gameId}`);
			removeBtn.addEventListener('click', () => {
				GameSessionStore.removeGame(game.gameId);
				void this.refreshSavedGames();
			});
			actions.appendChild(removeBtn);
		}

		li.appendChild(actions);
		return li;
	}

	/** Resume a saved game: active games go to the board, pending ones back to the waiting room. */
	private resumeSavedGame(game: SavedGame, info?: SavedGameInfo): void {
		if (isResumableToBoardStatus(info?.status)) {
			window.location.href = `board.html?gameId=${game.gameId}`;
		} else {
			void this.attemptReconnect(game);
		}
	}

	/** Host-only: confirm then ask the server to permanently delete a game. */
	private confirmDeleteSavedGame(game: SavedGame): void {
		dialogManager.init();
		dialogManager.showConfirm({
			title: 'Delete game',
			titleI18nKey: 'lobby.savedGames.deleteConfirm.title',
			message: 'Everyone connected will be disconnected and progress will be lost.',
			messageI18nKey: 'lobby.savedGames.deleteConfirm.message',
			confirmI18nKey: 'lobby.savedGames.deleteConfirm.confirm',
			cancelI18nKey: 'lobby.savedGames.deleteConfirm.cancel',
			onConfirm: async () => {
				try {
					await gameClient.deleteGame(game.gameId, game.playerId, game.playerSecretId);
				} catch (error) {
					console.error('Error deleting game:', error);
					showError(t('lobby.errors.deleteGame', 'Could not delete the game'));
				}
			}
		});
	}

	/** The host deleted a game: drop it from this browser's list and refresh. */
	private handleGameDeleted(data: { gameId: string }): void {
		GameSessionStore.removeGame(data.gameId);
		void this.refreshSavedGames();
	}

	private async autoValidateInviteCode(code: string): Promise<void> {
		try {
			showLoading(true);
			const resolved = await gameClient.resolveJoinCode(code);
			if (resolved.kind === 'seat') {
				this.showRejoinConfirm(code.toUpperCase(), resolved);
			} else if (resolved.game) {
				this.currentGame = resolved.game;
				hideSection('join-step1-form');
				await this.showJoinStep2(resolved.game);
			}
		} catch (error) {
			console.error('Error validating code:', error);
			this.recoverFromFailedInvite(this.inviteErrorMessage(error));
		} finally {
			showLoading(false);
		}
	}

	/**
	 * A deep-link invite code failed (expired/invalid/server error): return to the home
	 * view (games list + entry buttons) and surface the reason, instead of leaving the
	 * user stranded on an empty join form after the error auto-hides.
	 */
	private recoverFromFailedInvite(message: string): void {
		this.showJoinStep1();
		this.showHome();
		showError(message);
	}

	/** Maps a SignalR HubException to a readable, translated lobby error. */
	private inviteErrorMessage(error: unknown): string {
		const code = parseHubErrorCode(error);
		if (!code) {
			return t('lobby.errors.validateCode');
		}
		if (code === 'GAME_NOT_FOUND') {
			return t('lobby.errors.invalidInviteCode');
		}
		return translateServerError(code);
	}

	private async attemptReconnect(session: SavedGame): Promise<void> {
		try {
			showLoading(true);
			const gameState = await gameClient.getGameState(session.gameId);
			if (gameState) {
				this.currentGame = gameState as any;
				this.currentPlayerId = session.playerId;
				this.isHost = gameState.hostId === session.playerId;
				if (this.isHost) {
					// Pass the real invite code (not the gameId) so the shared link is
					// `?code=<inviteCode>`. The join flow resolves it via
					// GetByInviteCodeAsync, which only matches the inviteCode field —
					// a `?code=<gameId>` link would always report "game not found".
					this.showGameCreated(gameState as any, gameState.inviteCode);
				} else {
					this.showGameJoined(gameState as any);
				}
			} else {
				GameSessionStore.removeGame(session.gameId);
				clearUrlParams();
			}
		} catch (error) {
			console.error('Error reconnecting:', error);
			GameSessionStore.removeGame(session.gameId);
			clearUrlParams();
		} finally {
			showLoading(false);
		}
	}

	// === View Updates ===

	private showJoinStep1(): void {
		showSection('join-step1-form');
		hideSection('join-step2');
	}

	private async showJoinStep2(gameInfo: GameInfo): Promise<void> {
		hideSection('join-step1-form');
		showSection('join-step2');
		// "Next" lands the player on the first field of step 2 (the name box) rather than on
		// the now-hidden button — done now, before the async package loads below delay it.
		focusFirstField('join-step2');

		const details = getElement('lobby-details');
		if (details) {
			const count = gameInfo.players?.length || 1;
			const max = gameInfo.maxPlayers || 4;
			details.innerHTML = `
				<li>${t('lobby.playersCount', 'Players')}: ${count}/${max}</li>
				<li>${t('lobby.statusWaiting', 'Waiting for players')}</li>
			`;
		}

		// A joiner only has the lobby info, not the staged package, so load the board's own tokens
		// (and their localized names) before rendering — otherwise the selector falls back to the
		// built-in pieces. setPackageTokens(undefined) clears them for a built-in board.
		if (gameInfo.packageToken) {
			try { await i18nBinder.loadPackageResources(gameInfo.packageToken); } catch { /* names fall back to ids */ }
		}
		setPackageTokens(gameInfo.tokens);

		// Render join token selector with used tokens
		const container = getElement('join-token-list');
		if (container) {
			const usedTokens = getUsedTokens(gameInfo);
			renderTokenSelector(container, t, null, usedTokens);
		}

		// A race board also offers its seats; the ones already picked say who holds them
		// and bounce the selection (accessible unavailability, no `disabled`).
		const seatFieldset = getElement('join-seat-fieldset');
		const seatList = getElement('join-seat-list');
		const seats = gameInfo.seats ?? [];
		seatFieldset?.classList.toggle('hidden', seats.length === 0);
		if (seatList && seats.length > 0) {
			renderSeatSelector(seatList, seats, t, getUsedSeats(gameInfo.players));
		}
	}

	private showGameCreated(game: GameInfo, inviteCode: string): void {
		updateUrlWithGame(game.gameId);
		showSection('lobby-created');
		hideSection('lobby-joined');
		showView('view-waiting', 'game-created-message');
		this.updateGameInfo(game, inviteCode);
		this.updatePlayerList(game.players);
		this.renderRejoinCode('created-rejoin-mount', game.gameId);
	}

	private showGameJoined(game: GameInfo): void {
		updateUrlWithGame(game.gameId);
		hideSection('lobby-created');
		showSection('lobby-joined');
		showView('view-waiting', 'game-joined-message');
		this.updateGameInfo(game);
		this.updatePlayerList(game.players);
		this.renderRejoinCode('joined-rejoin-mount', game.gameId);
	}

	/**
	 * The player's own RE-ENTRY code in the waiting room, with a copy button: the one
	 * thing worth noting down — typed back in the code box it recovers this seat from
	 * any browser (the saved-session localStorage may not survive).
	 */
	private renderRejoinCode(mountId: string, gameId: string): void {
		const mount = getElement(mountId);
		if (!mount) return;
		const code = GameSessionStore.getGame(gameId)?.rejoinCode;
		if (!code) { mount.innerHTML = ''; return; }
		mount.innerHTML = '';

		const box = document.createElement('div');
		box.className = 'invite-code rejoin-code';
		const title = document.createElement('h3');
		title.textContent = t('lobby.rejoin.codeTitle');
		const value = document.createElement('div');
		value.className = 'invite-code__value';
		value.id = `${mountId}-value`;
		value.textContent = code;
		const copyBtn = document.createElement('button');
		copyBtn.className = 'copy-button';
		copyBtn.id = `${mountId}-copy`;
		copyBtn.textContent = t('lobby.rejoin.copy');
		copyBtn.addEventListener('click', () => { void copyToClipboard(code, copyBtn.id); });
		const hint = document.createElement('p');
		hint.className = 'hint';
		hint.textContent = t('lobby.rejoin.hint');
		box.append(title, value, copyBtn, hint);
		mount.appendChild(box);
	}

	private updateGameInfo(game: GameInfo, inviteCode?: string): void {
		const codeEl = getElement('lobby-code');
		const urlEl = getElement('invite-url');
		const code = inviteCode || game.gameId;
		if (codeEl) codeEl.textContent = code;
		if (urlEl) urlEl.textContent = `${window.location.origin}?code=${code}`;
	}

	private updatePlayerList(players: LobbyPlayer[]): void {
		// Update both lists if they exist (host sees host-player-list, guest sees joined-player-list)
		const hostContainer = getElement('host-player-list');
		const guestContainer = getElement('joined-player-list');

		// NOTE: no status check here — these lists only render in the WAITING room (an
		// active game lives on board.html), and the hub payload's status encoding differs
		// from the REST one, so comparing it here is a trap.
		const updateContainer = (container: HTMLElement | null, interactive: boolean) => {
			if (!container) return;
			container.innerHTML = '';
			players.forEach(player => {
				const tokenKey = convertTokenToSnakeCase(player.token as unknown as string);
				const tokenName = getTokenName(tokenKey, t);
				const statusText = player.isReady
					? t('lobby.playerReady', '(ready)')
					: t('lobby.playerWaiting', '(waiting)');
				const hostText = player.isHost ? ` ${t('lobby.playerHost', '(host)')}` : '';
				const botText = player.isBot ? ` ${t('lobby.playerBot', '(bot)')}` : '';
				const li = document.createElement('li');
				li.className = 'player-item';
				// The spans are laid out with a CSS flex `gap`, so there is NO real text
				// node between them — only visual spacing. Screen readers (JAWS) ignore the
				// gap and read adjacent spans glued together ("NúriaPerro Escocés"). A normal
				// space doesn't help because it collapses; we suffix each part with a comma
				// plus a non-breaking space, which is a real, non-collapsible
				// character in the accessibility tree, so each part is read distinctly.
				li.appendChild(createPlayerIdentity({
					tokenKey,
					playerName: player.name,
					tokenName,
					statusText,
					hostText,
					botText,
				}));
				// The host can send a bot away while waiting.
				if (interactive && player.isBot) {
					const remove = document.createElement('button');
					remove.type = 'button';
					remove.className = 'secondary-button player-item__remove-bot';
					remove.textContent = t('lobby.removeBot');
					remove.setAttribute('aria-label', t('lobby.removeBotOf').replace('{{name}}', player.name));
					remove.addEventListener('click', () => void this.removeBot(player.id));
					li.appendChild(remove);
				}
				container.appendChild(li);
			});
		};

		updateContainer(hostContainer, this.isHost);
		updateContainer(guestContainer, false);
		this.renderTeamPanels();
		// The add-bot chair: host only, on a family that HAS bots (trivia/race/property ship no
		// bot policy — the server rejects them), while there is room at the table. The host holds
		// the selected package, whose gameType names the family.
		const canAddBot = this.isHost
			&& familyHasBots(this.uploadedPackage?.gameType)
			&& players.length < (this.currentGame?.maxPlayers ?? 0);
		const addBotBtn = getElement('add-bot-btn');
		// Hiding the focused chair (the table just filled, e.g. after adding the last bot)
		// would strand focus on <body>: hand it to Start first so the keyboard user keeps a
		// sensible landing spot.
		if (addBotBtn && !canAddBot && document.activeElement === addBotBtn) {
			getElement('start-game-btn')?.focus();
		}
		addBotBtn?.classList.toggle('hidden', !canAddBot);
	}

	private async removeBot(playerId: string): Promise<void> {
		if (!this.currentGame || !this.isHost) return;
		try {
			await gameClient.removeBot({ gameId: this.currentGame.gameId, hostId: this.currentPlayerId, playerId });
		} catch (error) {
			console.error('Error removing bot:', error);
			showError(t('lobby.errors.addBot'));
		}
	}

	// === Journey team mode (waiting room) ─ the host arranges, the room watches ===

	/** The team's spoken identity («Equipo Rojo») — palette colour word by team index. */
	private teamName(index: number): string {
		return teamDisplayName(index, (k, v) => i18nBinder.tSync(k, v));
	}

	private renderTeamPanels(): void {
		const game = this.currentGame;
		const teamCount = game?.teamCount ?? 0;
		const hostPanel = getElement('host-team-panel');
		const guestPanel = getElement('joined-team-panel');
		hostPanel?.classList.toggle('hidden', teamCount < 2);
		guestPanel?.classList.toggle('hidden', teamCount < 2);
		if (!game || teamCount < 2) return;
		// The host's panel carries the controls; the guests' is the same picture, read-only.
		if (hostPanel) this.renderTeamPanel(hostPanel, game, this.isHost);
		if (guestPanel) this.renderTeamPanel(guestPanel, game, false);
	}

	private renderTeamPanel(panel: HTMLElement, game: GameInfo, interactive: boolean): void {
		const teamCount = game.teamCount!;
		const teamSize = Math.floor(game.maxPlayers / teamCount);
		const pool = game.players.filter(p => p.teamIndex == null);
		panel.innerHTML = '';

		const heading = document.createElement('h4');
		heading.textContent = t('lobby.teamsHeading');
		panel.appendChild(heading);

		for (let index = 0; index < teamCount; index++) {
			const members = game.players.filter(p => p.teamIndex === index);
			const box = document.createElement('fieldset');
			box.className = 'team-box';
			const legend = document.createElement('legend');
			legend.textContent = `${this.teamName(index)} (${members.length}/${teamSize})`;
			box.appendChild(legend);

			const list = document.createElement('ul');
			for (const member of members) {
				const item = document.createElement('li');
				const name = document.createElement('span');
				name.textContent = member.name;
				item.appendChild(name);
				if (interactive) {
					const remove = document.createElement('button');
					remove.type = 'button';
					remove.className = 'secondary-button team-box__remove';
					remove.textContent = t('lobby.teamRemove');
					remove.setAttribute('aria-label',
						t('lobby.teamRemoveOf').replace('{{name}}', member.name));
					remove.addEventListener('click', () => void this.assignTeam(member.id, null));
					item.appendChild(remove);
				}
				list.appendChild(item);
			}
			box.appendChild(list);

			if (interactive && members.length < teamSize && pool.length > 0) {
				const add = document.createElement('button');
				add.type = 'button';
				add.className = 'secondary-button team-box__add';
				add.textContent = t('lobby.teamAdd');
				add.setAttribute('aria-label',
					t('lobby.teamAddTo').replace('{{team}}', this.teamName(index)));
				add.addEventListener('click', () => this.openTeamPickMenu(add, index, pool));
				box.appendChild(add);
			}
			panel.appendChild(box);
		}

		// The shrinking pool of unassigned players, spelled out (the start guard needs it empty).
		const poolLine = document.createElement('p');
		poolLine.className = 'team-pool';
		poolLine.textContent = pool.length > 0
			? t('lobby.teamPool').replace('{{names}}', pool.map(p => p.name).join(', '))
			: t('lobby.teamPoolEmpty');
		panel.appendChild(poolLine);
	}

	/** The host's "add player" menu: only the UNASSIGNED players are offered. */
	private openTeamPickMenu(anchor: HTMLElement, teamIndex: number, pool: LobbyPlayer[]): void {
		popupMenu.open({
			ariaLabel: t('lobby.teamAddTo').replace('{{team}}', this.teamName(teamIndex)),
			anchor,
			items: pool.map(player => ({
				label: player.name,
				onSelect: () => void this.assignTeam(player.id, teamIndex),
			})),
			announce: text => this.announceInLobby(text),
			onClose: () => anchor.focus(),
		});
	}

	private async assignTeam(playerId: string, teamIndex: number | null): Promise<void> {
		if (!this.currentGame || !this.isHost) return;
		try {
			await gameClient.assignTeam({
				gameId: this.currentGame.gameId,
				hostId: this.currentPlayerId,
				playerId,
				teamIndex,
			});
		} catch (error) {
			console.error('Error assigning team:', error);
			showError(t('lobby.errors.assignTeam'));
		}
	}

	/** The whole room hears every team move (the LobbyUpdated repaint is silent). */
	private handleTeamAssigned(data: { playerId: string; playerName: string; teamIndex: number | null }): void {
		this.announceInLobby(data.teamIndex == null
			? t('lobby.teamUnassigned').replace('{{player}}', data.playerName)
			: t('lobby.teamAssigned')
				.replace('{{player}}', data.playerName)
				.replace('{{team}}', this.teamName(data.teamIndex)));
	}

	private announceInLobby(text: string): void {
		const live = getElement('lobby-live');
		if (!live) return;
		// Clear first so repeating the SAME text is still announced.
		live.textContent = '';
		window.setTimeout(() => { live.textContent = text; }, 30);
	}

	// === Rendering ===

	private renderBoardSelector(): void {
		const selector = getElement<HTMLSelectElement>('board-selector');
		if (!selector) return;
		// The pure helper fills the options in the active language AND preserves the current
		// selection, so a runtime language switch just re-calls this (see onLanguageChanged).
		renderBoardOptions(selector, this.shippedBoards, i18nBinder.getCurrentLanguage());
	}

	private renderAllTokenSelectors(): void {
		const createContainer = document.querySelector('.token-list:not(#join-token-list)') as HTMLElement;
		if (createContainer) {
			renderTokenSelector(createContainer, t);
		}
	}

	private onLanguageChanged(): void {
		// i18next has already switched by the time `languageChanged` fires. Re-render the bits we
		// build imperatively with t()/localizePackageName() — they set textContent rather than
		// data-i18n, so applyI18n never reaches them and they keep their old-language text: the
		// token selectors, the saved-games list, and the create-game selects below.
		this.renderAllTokenSelectors();
		// The shipped-board picker options are localized per board; rebuild them in the new
		// language (renderBoardOptions preserves the host's current choice on its own).
		this.renderBoardSelector();
		// The staged package's player- and team-count options also set textContent via t():
		// re-render them, preserving the host's selection (renderTeamCountOptions keeps its own).
		if (this.uploadedPackage) {
			const select = getElement<HTMLSelectElement>('max-players');
			const chosen = select?.value;
			this.renderPlayerCount(this.uploadedPackage);
			if (select && chosen) select.value = chosen;
			this.renderTeamCountOptions(this.uploadedPackage);
		}
		void this.refreshSavedGames();
	}
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => new UnifiedLobbyUI());

export { UnifiedLobbyUI };
