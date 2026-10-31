// voicePanel.ts — opt-in, accessibility-first LiveKit voice controls.
//
// Presence and speaking indicators are visual continuously. Screen readers hear join/leave
// events, while "who is speaking?" is deliberately an on-demand shortcut so live human speech
// is never covered by a stream of automatic speaker-name announcements.

import { soundEvents } from './soundEvents.js';
import { RovingToolbarList } from './accessibleList.js';
import { RovingToolbar, type ToolbarItem } from './rovingToolbar.js';
import { reconcileChildren } from './domReconcile.js';
import { popupMenu, type PopupMenuItem } from './popupMenu.js';
import {
	createVoiceTransport,
	getAvailableVoiceDevices,
	requestVoiceOutputDevice,
	type VoiceDevice,
	type VoiceDevicePreferences,
	type VoiceDeviceSnapshot,
	type VoiceParticipant,
	type VoiceTransport,
	type VoiceTransportCallbacks,
} from './voiceTransport.js';

const DISCLAIMER_KEY = 'corro.voiceDisclaimerDismissed';
const DEVICE_PREFERENCES_KEY = 'corro.voiceDevices';
const DEFAULT_DEVICE_PREFERENCES: VoiceDevicePreferences = {
	microphoneId: 'default',
	outputId: 'default',
};

export interface VoicePanelDeps {
	t: (key: string, vars?: Record<string, unknown>) => string;
	gameId: string;
	getMyPlayerId: () => string;
	isHost: () => boolean;
	requestToken: () => Promise<{ url: string; token: string }>;
	setEnabled: (enabled: boolean) => Promise<void>;
	muteParticipant: (playerId: string) => Promise<void>;
	announce: (key: string, vars?: Record<string, unknown>, instant?: boolean) => void;
	/** Platform earcon boundary; injectable so tests pin voice-specific event ids. */
	playSoundEvent?: (event: string) => void;
	/** Pre-join device discovery/selection seams; production uses the browser + LiveKit. */
	getAvailableDevices?: () => Promise<VoiceDeviceSnapshot>;
	requestOutputDevice?: () => Promise<VoiceDevice | null>;
	/** Mirror read-only membership/mute/speaking state on the persistent player cards. */
	onPresenceChanged?: (participants: readonly VoiceVisualPresence[]) => void;
	/** Close another floating utility (currently text chat) before this panel docks. */
	beforeOpen?: () => void;
	createTransport?: (callbacks: VoiceTransportCallbacks) => VoiceTransport;
}

export interface VoiceVisualPresence {
	id: string;
	muted: boolean;
	speaking: boolean;
}

/** Maps browser media failures to honest, actionable localized feedback. */
export function voiceJoinErrorKey(error: unknown): string {
	const name = error && typeof error === 'object' && 'name' in error
		? String((error as { name?: unknown }).name)
		: '';
	if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'game.voice_permission_denied';
	if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'game.voice_microphone_missing';
	if (name === 'NotReadableError' || name === 'TrackStartError') return 'game.voice_microphone_busy';
	return 'game.voice_join_failed';
}

export function formatVoiceSpeakerNames(names: string[], locale: string): string {
	return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
}

export class VoicePanel {
	private deps: VoicePanelDeps | null = null;
	private headerButton: HTMLButtonElement | null = null;
	private microphoneButton: HTMLButtonElement | null = null;
	private panel: HTMLElement | null = null;
	private status: HTMLElement | null = null;
	private controls: HTMLElement | null = null;
	private deviceSettingsButton: HTMLButtonElement | null = null;
	private list: HTMLUListElement | null = null;
	/** The application wrapper around the roster — see the markup for why it is a wrapper. */
	private participantsSurface: HTMLElement | null = null;
	private participantNav: RovingToolbarList | null = null;
	/**
	 * The panel's own actions (join, mute, leave, open/close the room) as ONE tab stop with arrows
	 * inside, instead of one stop each. Reaching the list of who is here meant passing five stops
	 * first; this is four of them.
	 */
	private readonly controlsToolbar = new RovingToolbar();
	private deploymentAvailable = false;
	private gameEnabled = false;
	private connected = false;
	private joining = false;
	private changingAvailability = false;
	private selfMuted = false;
	private participants: VoiceParticipant[] = [];
	private transport: VoiceTransport | null = null;
	private statusKey = 'game.voice_unavailable';
	private readonly appliedVolumes = new Set<string>();
	private volumes: Record<string, number> = {};
	private publishedPresenceSignature = '';
	private devicePreferences: VoiceDevicePreferences = { ...DEFAULT_DEVICE_PREFERENCES };
	private deviceSnapshot: VoiceDeviceSnapshot | null = null;
	private deviceMenuOpen = false;
	private loadingDevices = false;

	init(controlsMount: HTMLElement, panelMount: HTMLElement, deps: VoicePanelDeps): void {
		this.deps = deps;
		this.volumes = readVolumes(deps.gameId);
		this.devicePreferences = readVoiceDevicePreferences();
		if (this.panel) return;
		this.createHeaderButtons(controlsMount);
		this.createPanel(panelMount);
		this.render();
	}

	isOpen(): boolean { return !!this.panel && !this.panel.hidden; }
	isConnected(): boolean { return this.connected; }
	isAvailable(): boolean { return this.deploymentAvailable; }

	setDeploymentAvailable(available: boolean): void {
		this.deploymentAvailable = available;
		if (this.headerButton) this.headerButton.hidden = !available;
		if (!available && this.connected) void this.leave(false);
		if (!available) this.setStatus('game.voice_unavailable');
		else if (!this.gameEnabled) this.setStatus('game.voice_off');
		else if (!this.connected) this.setStatus('game.voice_ready');
		this.render();
	}

	/** Apply authoritative game state. `announceChange` is true only for the dedicated
	 * SignalR event, not for an initial/repeated GameState snapshot. */
	setGameEnabled(enabled: boolean, announceChange = false): void {
		this.gameEnabled = enabled;
		if (!enabled && this.connected) void this.leave(true);
		if (!enabled) this.setStatus('game.voice_off');
		else if (this.deploymentAvailable && !this.connected) this.setStatus('game.voice_ready');
		if (announceChange) {
			this.deps?.announce(enabled ? 'game.voice_enabled' : 'game.voice_disabled');
		}
		this.render();
	}

	handleHostMute(event: {
		targetPlayerId: string;
		targetPlayerName: string;
		hostPlayerName: string;
	}): void {
		if (!this.connected || !this.deps) return;
		const mine = event.targetPlayerId === this.deps.getMyPlayerId();
		this.deps.announce(
			mine ? 'game.voice_muted_by_host_self' : 'game.voice_muted_by_host',
			{ player: event.targetPlayerName, host: event.hostPlayerName },
		);
		this.render();
	}

	togglePanel(): void {
		if (this.isOpen()) this.closePanel(); else this.openPanel();
	}

	openPanel(): void {
		if (!this.panel || !this.deploymentAvailable) return;
		this.deps?.beforeOpen?.();
		this.panel.hidden = false;
		this.syncHeaderButton();
		const notice = this.panel.querySelector<HTMLElement>('#voice-disclaimer-text');
		const banner = this.panel.querySelector<HTMLElement>('#voice-disclaimer');
		if (banner && !banner.hidden && notice) {
			notice.focus();
			return;
		}
		this.focus();
	}

	closePanel(): void {
		this.closeDeviceMenu();
		this.participantNav?.closeContextMenu();
		if (this.panel) this.panel.hidden = true;
		this.syncHeaderButton();
		this.headerButton?.focus();
	}

	focus(): boolean {
		if (!this.isOpen()) {
			this.openPanel();
			return this.isOpen();
		}
		const target = this.panel?.querySelector<HTMLElement>(
			'#voice-disclaimer:not([hidden]) #voice-disclaimer-text, .voice-controls button:not([hidden]), .voice-device-settings:not([hidden]), .voice-participant, #voice-panel-title',
		);
		if (!target) return false;
		target.focus();
		return true;
	}

	async toggleSelfMute(): Promise<boolean> {
		if (!this.connected || !this.transport || !this.deps) {
			this.deps?.announce('game.voice_not_joined', {}, true);
			return true;
		}
		try {
			const muted = !this.selfMuted;
			await this.transport.setMuted(muted);
			this.selfMuted = muted;
			this.setStatus(this.connectedStatusKey());
			this.deps.announce(muted ? 'game.voice_muted_self' : 'game.voice_unmuted_self', {}, true);
			this.render();
		} catch {
			this.deps.announce('game.voice_microphone_error', {}, true);
		}
		return true;
	}

	announceActiveSpeakers(): boolean {
		if (!this.connected || !this.transport || !this.deps) {
			this.deps?.announce('game.voice_not_joined', {}, true);
			return true;
		}
		const speakers = this.transport.getActiveSpeakers();
		if (speakers.length === 0) {
			this.deps.announce('game.voice_no_speakers', {}, true);
			return true;
		}
		const names = formatVoiceSpeakerNames(
			speakers.map(speaker => speaker.local ? this.deps!.t('game.voice_you') : speaker.name),
			document.documentElement.lang || navigator.language || 'en',
		);
		this.deps.announce('game.voice_speakers', { names }, true);
		return true;
	}

	private createHeaderButtons(mount: HTMLElement): void {
		const button = document.createElement('button');
		button.type = 'button';
		button.id = 'voice-toggle';
		button.className = 'icon-btn voice-toggle';
		button.hidden = true;
		button.setAttribute('aria-controls', 'voice-panel');
		button.setAttribute('aria-keyshortcuts', 'Control+Alt+V');
		button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg><span class="voice-toggle__dot" aria-hidden="true"></span>';
		button.addEventListener('click', () => this.togglePanel());
		mount.appendChild(button);
		this.headerButton = button;

		const microphone = document.createElement('button');
		microphone.type = 'button';
		microphone.id = 'voice-microphone-toggle';
		microphone.className = 'icon-btn voice-microphone-toggle';
		microphone.hidden = true;
		microphone.setAttribute('aria-keyshortcuts', 'Control+Alt+X');
		microphone.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>';
		microphone.addEventListener('click', () => void this.toggleSelfMute());
		mount.appendChild(microphone);
		this.microphoneButton = microphone;
	}

	private createPanel(mount: HTMLElement): void {
		const panel = document.createElement('div');
		panel.id = 'voice-panel';
		panel.className = 'voice-panel';
		panel.hidden = true;
		panel.setAttribute('aria-labelledby', 'voice-panel-title');
		panel.innerHTML = `
			<div class="voice-panel__surface">
				<h2 class="voice-panel__title" id="voice-panel-title" tabindex="-1"></h2>
				<div class="voice-disclaimer" id="voice-disclaimer" hidden>
					<p id="voice-disclaimer-text" tabindex="0"></p>
					<label><input type="checkbox" id="voice-disclaimer-dontshow"><span id="voice-disclaimer-dontshow-label"></span></label>
					<button type="button" id="voice-disclaimer-dismiss" class="btn btn-secondary"></button>
				</div>
				<!-- NOT focusable. It was a tab stop with no accessible name, sitting between the
					 close button and everything worth reaching, and the panel's state is spoken by
					 the announcer anyway — a stop that costs a keystroke and says nothing. -->
				<p class="voice-status" id="voice-status"></p>
				<div class="voice-controls" id="voice-controls"></div>
				<button type="button" id="voice-device-settings" class="btn btn-secondary voice-device-settings" hidden></button>
				<!-- The roster is a WIDGET you operate, not a passage you read, and it is wrapped in
					 an application so a screen reader treats it as one. Inside an application NVDA
					 builds no virtual buffer, so arriving at a row reads that ROW — its name and how
					 that person is heard — instead of walking the reader through every control of
					 every participant, which is what a browse-mode list does with rows that carry a
					 slider and two buttons each (reported live).

					 A WRAPPER, not the role on the <ul> itself: application would displace the list
					 semantics, and "list, 3 items" is worth keeping — it is how you learn how many
					 people are in the room. Scoped to the roster alone, so the panel's title, status
					 and controls stay ordinary browsable page. The same shape the chat uses for its
					 message list. -->
				<div class="voice-participants-application" role="application" id="voice-participants-surface">
					<ul class="voice-participants" id="voice-participants" role="list"></ul>
				</div>
			</div>`;
		mount.appendChild(panel);
		this.panel = panel;
		this.status = panel.querySelector('#voice-status');
		this.controls = panel.querySelector('#voice-controls');
		if (this.controls) {
			this.controlsToolbar.mount(this.controls, {
				label: '', // named in render(), once the translator is known
				className: 'voice-controls__bar',
				buttonClassName: 'btn btn-secondary',
				classPrefix: 'voice-controls',
			});
		}
		this.deviceSettingsButton = panel.querySelector('#voice-device-settings');
		this.list = panel.querySelector('#voice-participants');
		this.participantsSurface = panel.querySelector('#voice-participants-surface');
		this.participantNav = new RovingToolbarList({
			list: this.list!,
			itemSelector: '.voice-participant',
			toolbarButtonSelector: '.voice-participant__volume:not([hidden]) .voice-participant__volume-action, .voice-participant__actions > button:not([hidden])',
			menuLabel: () => this.deps?.t('game.voice_participant_menu') ?? '',
			menuClass: 'voice-participant-context-menu',
			menuItemClass: 'voice-participant-context-menu-item',
			// Keep the popup inside the active page landmark, never orphaned under body.
			menuHost: () => this.panel?.closest('main') ?? this.panel,
			fallbackFocus: () => this.panel?.querySelector<HTMLElement>(
				'.voice-controls button:not([hidden]), .voice-device-settings:not([hidden]), #voice-panel-title',
			) ?? null,
		});
		this.deviceSettingsButton?.setAttribute('aria-haspopup', 'menu');
		this.deviceSettingsButton?.setAttribute('aria-expanded', 'false');

		this.deviceSettingsButton?.addEventListener('click', () => void this.openDeviceSettings());
		panel.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			this.closePanel();
		});

		const banner = panel.querySelector<HTMLElement>('#voice-disclaimer')!;
		if (!disclaimerDismissed()) banner.hidden = false;
		panel.querySelector('#voice-disclaimer-dismiss')!.addEventListener('click', () => {
			banner.hidden = true;
			if ((panel.querySelector('#voice-disclaimer-dontshow') as HTMLInputElement).checked) {
				persistDisclaimerDismissed();
			}
			this.focus();
		});
	}

	private async join(): Promise<void> {
		if (!this.deps || this.connected || this.joining || !this.gameEnabled) return;
		this.joining = true;
		this.setStatus('game.voice_joining');
		this.render();

		let transport: VoiceTransport | null = null;
		try {
			const credentials = await this.deps.requestToken();
			// Not const: the callbacks on the next line close over `created` BEFORE it is
			// assigned, which is exactly what the definite-assignment form expresses.
			// eslint-disable-next-line prefer-const
			let created!: VoiceTransport;
			const callbacks = this.transportCallbacks(() => created);
			created = this.deps.createTransport?.(callbacks) ?? createVoiceTransport(callbacks);
			transport = created;
			this.transport = created;
			await created.connect(credentials.url, credentials.token, this.devicePreferences);
			if (this.transport !== created) return;
			this.connected = true;
			this.selfMuted = false;
			this.syncParticipants(created.getParticipants());
			void this.refreshDeviceSnapshot(false);
			this.setStatus(this.connectedStatusKey());
			this.deps.announce('game.voice_joined_self');
			this.playSoundEvent('voice.join');
		} catch (error) {
			if (transport && this.transport === transport) this.transport = null;
			this.connected = false;
			this.participants = [];
			this.publishPresence();
			const key = voiceJoinErrorKey(error);
			this.setStatus(key);
			this.deps.announce(key, {}, true);
		} finally {
			this.joining = false;
			this.render();
		}
	}

	private async leave(announce: boolean): Promise<void> {
		const transport = this.transport;
		const wasConnected = this.connected;
		this.transport = null;
		this.closeDeviceMenu();
		this.deviceSnapshot = null;
		this.connected = false;
		this.joining = false;
		this.selfMuted = false;
		this.participants = [];
		this.publishPresence();
		this.appliedVolumes.clear();
		this.render();
		if (transport) await transport.disconnect().catch(() => undefined);
		this.setStatus(!this.deploymentAvailable
			? 'game.voice_unavailable'
			: this.gameEnabled ? 'game.voice_ready' : 'game.voice_off');
		if (announce && wasConnected && this.deps) {
			this.deps.announce('game.voice_left_self');
			this.playSoundEvent('voice.leave');
		}
		this.render();
	}

	private transportCallbacks(current: () => VoiceTransport): VoiceTransportCallbacks {
		return {
			onParticipantJoined: participant => {
				if (this.transport !== current()) return;
				if (this.connected) {
					this.deps?.announce('game.voice_joined', { player: participant.name });
					this.playSoundEvent('voice.join');
				}
			},
			onParticipantLeft: participant => {
				if (this.transport !== current()) return;
				this.appliedVolumes.delete(participant.id);
				if (this.connected) {
					this.deps?.announce('game.voice_left', { player: participant.name });
					this.playSoundEvent('voice.leave');
				}
			},
			onParticipantsChanged: participants => {
				if (this.transport !== current()) return;
				this.syncParticipants(participants);
			},
			onReconnecting: () => {
				if (this.transport !== current()) return;
				this.setStatus('game.voice_reconnecting');
				this.deps?.announce('game.voice_reconnecting');
			},
			onReconnected: () => {
				if (this.transport !== current()) return;
				this.setStatus(this.connectedStatusKey());
				this.deps?.announce('game.voice_reconnected');
			},
			onDisconnected: unexpected => {
				if (this.transport !== current()) return;
				this.transport = null;
				this.closeDeviceMenu();
				this.deviceSnapshot = null;
				this.connected = false;
				this.participants = [];
				this.publishPresence();
				if (unexpected) {
					this.setStatus('game.voice_connection_lost');
					this.deps?.announce('game.voice_connection_lost', {}, true);
				}
				this.render();
			},
			onPlaybackBlocked: () => {
				if (this.transport !== current()) return;
				this.setStatus('game.voice_playback_blocked');
				this.deps?.announce('game.voice_playback_blocked', {}, true);
			},
			onDevicesChanged: () => {
				if (this.transport !== current() || !this.connected) return;
				void this.refreshDeviceSnapshot(true);
			},
			onDevicePreferenceFallback: kind => {
				if (this.transport !== current()) return;
				this.resetDevicePreference(kind, true);
			},
		};
	}

	private syncParticipants(participants: VoiceParticipant[]): void {
		this.participants = participants;
		const me = participants.find(participant => participant.local);
		this.selfMuted = me?.muted ?? this.selfMuted;
		if (this.connected) this.setStatus(this.connectedStatusKey());
		this.publishPresence();
		for (const participant of participants) {
			if (participant.local || this.appliedVolumes.has(participant.id)) continue;
			this.appliedVolumes.add(participant.id);
			const saved = this.volumes[participant.id];
			if (typeof saved === 'number') this.transport?.setParticipantVolume(participant.id, saved);
		}
		this.render();
	}

	private publishPresence(): void {
		const snapshot = this.participants.map(({ id, muted, speaking }) => ({ id, muted, speaking }));
		const signature = snapshot
			.map(participant => `${participant.id}:${Number(participant.muted)}:${Number(participant.speaking)}`)
			.sort()
			.join('|');
		// Volume changes also refresh the LiveKit roster; avoid rebuilding player-card labels
		// when the only changed value lives exclusively in the expanded settings panel.
		if (signature === this.publishedPresenceSignature) return;
		this.publishedPresenceSignature = signature;
		this.deps?.onPresenceChanged?.(snapshot);
	}

	private async openDeviceSettings(): Promise<void> {
		if (!this.gameEnabled || !this.deviceSettingsButton || !this.deps || this.loadingDevices) {
			return;
		}
		this.loadingDevices = true;
		this.deviceSettingsButton.setAttribute('aria-busy', 'true');
		try {
			this.deviceSnapshot = this.connected && this.transport
				? await this.transport.getDeviceSnapshot()
				: await (this.deps.getAvailableDevices?.() ?? getAvailableVoiceDevices(true));
			this.reconcileUnavailablePreferences(false);
			const microphoneLabel = this.selectedDeviceLabel('audioinput');
			const outputLabel = this.selectedDeviceLabel('audiooutput');
			const items: PopupMenuItem[] = [
				{
					label: this.deps.t('game.voice_microphone_menu', { device: microphoneLabel }),
					submenu: {
						ariaLabel: this.deps.t('game.voice_microphone_group'),
						items: this.deviceOptions('audioinput'),
					},
				},
			];
			if (this.deviceSnapshot.outputSelectionSupported) {
				const outputItems = this.deviceOptions('audiooutput');
				if (this.deviceSnapshot.outputPromptSupported) {
					outputItems.push({
						label: this.deps.t('game.voice_choose_output'),
						onSelect: () => void this.requestOutputDevice(),
					});
				}
				items.push({
					label: this.deps.t('game.voice_output_menu', { device: outputLabel }),
					submenu: {
						ariaLabel: this.deps.t('game.voice_output_group'),
						items: outputItems,
					},
				});
			} else {
				items.push({
					label: this.deps.t('game.voice_output_system'),
					disabled: true,
					reason: this.deps.t('game.voice_output_unsupported'),
				});
			}

			this.deviceMenuOpen = true;
			popupMenu.open({
				ariaLabel: this.deps.t('game.voice_devices_menu'),
				items,
				anchor: this.deviceSettingsButton,
				announce: text => this.deps?.announce('_raw', { text }, true),
				onClose: () => {
					this.deviceMenuOpen = false;
					if (this.deviceSettingsButton?.isConnected && !this.deviceSettingsButton.hidden) {
						this.deviceSettingsButton.focus();
					}
				},
			});
		} catch (error) {
			const key = voiceJoinErrorKey(error) === 'game.voice_permission_denied'
				? 'game.voice_permission_denied'
				: 'game.voice_devices_failed';
			this.setStatus(key);
			this.deps.announce(key, {}, true);
		} finally {
			this.loadingDevices = false;
			this.deviceSettingsButton.removeAttribute('aria-busy');
		}
	}

	private deviceOptions(kind: 'audioinput' | 'audiooutput'): PopupMenuItem[] {
		const devices = kind === 'audioinput'
			? this.deviceSnapshot?.microphones ?? []
			: this.deviceSnapshot?.outputs ?? [];
		const selectedId = kind === 'audioinput'
			? this.devicePreferences.microphoneId
			: this.devicePreferences.outputId;
		const options: VoiceDevice[] = [
			{ deviceId: 'default', label: this.deps!.t('game.voice_device_default') },
			...devices,
		];
		return options.map((device, index) => {
			const label = device.label || this.deps!.t(
				kind === 'audioinput' ? 'game.voice_microphone_number' : 'game.voice_output_number',
				{ number: index },
			);
			return {
				label,
				checked: device.deviceId === selectedId,
				onSelect: () => void this.selectDevice(kind, device.deviceId, label),
			};
		});
	}

	private selectedDeviceLabel(kind: 'audioinput' | 'audiooutput'): string {
		const selectedId = kind === 'audioinput'
			? this.devicePreferences.microphoneId
			: this.devicePreferences.outputId;
		if (selectedId === 'default') return this.deps!.t('game.voice_device_default');
		const devices = kind === 'audioinput'
			? this.deviceSnapshot?.microphones ?? []
			: this.deviceSnapshot?.outputs ?? [];
		const index = devices.findIndex(device => device.deviceId === selectedId);
		const selected = index >= 0 ? devices[index] : null;
		return selected?.label || this.deps!.t(
			kind === 'audioinput' ? 'game.voice_microphone_number' : 'game.voice_output_number',
			{ number: Math.max(1, index + 1) },
		);
	}

	private async selectDevice(
		kind: 'audioinput' | 'audiooutput',
		deviceId: string,
		label: string,
	): Promise<void> {
		if (!this.deps) return;
		try {
			if (this.connected && this.transport) {
				if (kind === 'audioinput') await this.transport.setMicrophoneDevice(deviceId);
				else await this.transport.setOutputDevice(deviceId);
			}
			if (kind === 'audioinput') this.devicePreferences.microphoneId = deviceId;
			else this.devicePreferences.outputId = deviceId;
			writeVoiceDevicePreferences(this.devicePreferences);
			this.deps.announce(
				kind === 'audioinput' ? 'game.voice_microphone_selected' : 'game.voice_output_selected',
				{ device: label },
				true,
			);
			if (this.connected) await this.refreshDeviceSnapshot(false);
			else this.render();
		} catch {
			const key = kind === 'audioinput'
				? 'game.voice_microphone_switch_failed'
				: 'game.voice_output_switch_failed';
			this.setStatus(key);
			this.deps.announce(key, {}, true);
		}
	}

	private async requestOutputDevice(): Promise<void> {
		if (!this.deps) return;
		// Start the browser prompt synchronously from the menu activation. Awaiting anything
		// before this call would lose the transient user gesture required by the API.
		const selectionPromise = this.connected && this.transport
			? this.transport.requestOutputDevice()
			: (this.deps.requestOutputDevice?.() ?? requestVoiceOutputDevice());
		try {
			const device = await selectionPromise;
			if (!device) {
				this.deps.announce('game.voice_output_unsupported', {}, true);
				return;
			}
			this.devicePreferences.outputId = device.deviceId;
			if (this.deviceSnapshot
				&& !this.deviceSnapshot.outputs.some(output => output.deviceId === device.deviceId)) {
				this.deviceSnapshot.outputs.push(device);
			}
			writeVoiceDevicePreferences(this.devicePreferences);
			this.deps.announce('game.voice_output_selected', {
				device: device.label || this.deps.t('game.voice_output_number', { number: 1 }),
			}, true);
			if (this.connected) await this.refreshDeviceSnapshot(false);
			else this.render();
		} catch (error) {
			const name = error && typeof error === 'object' && 'name' in error
				? String((error as { name?: unknown }).name)
				: '';
			this.deps.announce(
				name === 'NotAllowedError' ? 'game.voice_output_not_changed' : 'game.voice_output_switch_failed',
				{},
				true,
			);
		}
	}

	private async refreshDeviceSnapshot(announceChange: boolean): Promise<void> {
		if (!this.connected || !this.transport) return;
		try {
			this.deviceSnapshot = await this.transport.getDeviceSnapshot();
			const changed = this.reconcileUnavailablePreferences(true);
			if (this.deviceMenuOpen) {
				this.closeDeviceMenu();
				if (announceChange && !changed) this.deps?.announce('game.voice_devices_changed', {}, true);
			}
			this.render();
		} catch {
			// A transient enumerateDevices failure must not disconnect otherwise healthy audio.
			if (announceChange) this.deps?.announce('game.voice_devices_failed', {}, true);
		}
	}

	private reconcileUnavailablePreferences(switchToDefault: boolean): boolean {
		if (!this.deviceSnapshot) return false;
		let changed = false;
		if (this.devicePreferences.microphoneId !== 'default'
			&& !this.deviceSnapshot.microphones.some(device => device.deviceId === this.devicePreferences.microphoneId)) {
			this.resetDevicePreference('audioinput', true);
			if (switchToDefault) void this.transport?.setMicrophoneDevice('default').catch(() => undefined);
			changed = true;
		}
		if (this.devicePreferences.outputId !== 'default'
			&& (!this.deviceSnapshot.outputSelectionSupported
				|| !this.deviceSnapshot.outputs.some(device => device.deviceId === this.devicePreferences.outputId))) {
			this.resetDevicePreference('audiooutput', true);
			if (switchToDefault && this.deviceSnapshot.outputSelectionSupported) {
				void this.transport?.setOutputDevice('default').catch(() => undefined);
			}
			changed = true;
		}
		return changed;
	}

	private resetDevicePreference(kind: 'audioinput' | 'audiooutput', announce: boolean): void {
		if (kind === 'audioinput') this.devicePreferences.microphoneId = 'default';
		else this.devicePreferences.outputId = 'default';
		writeVoiceDevicePreferences(this.devicePreferences);
		if (announce) {
			this.deps?.announce(
				kind === 'audioinput'
					? 'game.voice_microphone_fallback'
					: 'game.voice_output_fallback',
				{},
				true,
			);
		}
	}

	private closeDeviceMenu(): void {
		if (!this.deviceMenuOpen) return;
		popupMenu.close();
		this.deviceMenuOpen = false;
	}

	private async changeAvailability(enabled: boolean): Promise<void> {
		if (!this.deps || this.changingAvailability) return;
		this.changingAvailability = true;
		this.render();
		try {
			await this.deps.setEnabled(enabled);
		} catch {
			this.setStatus('game.voice_availability_error');
			this.deps.announce('game.voice_availability_error', {}, true);
		} finally {
			this.changingAvailability = false;
			this.render();
		}
	}

	private async hostMute(participant: VoiceParticipant, button: HTMLButtonElement): Promise<void> {
		if (!this.deps) return;
		if (participant.muted) {
			this.deps.announce('game.voice_already_muted', { player: participant.name }, true);
			return;
		}
		button.setAttribute('aria-disabled', 'true');
		try {
			await this.deps.muteParticipant(participant.id);
		} catch {
			this.deps.announce('game.voice_mute_failed', { player: participant.name }, true);
		} finally {
			// LiveKit's TrackMuted event will re-apply aria-disabled when moderation worked.
			// If the server rejected it, this one-shot pending guard must not become sticky.
			button.removeAttribute('aria-disabled');
		}
	}

	private setVolume(participantId: string, value: number): void {
		const normalized = Math.min(1, Math.max(0, value));
		this.volumes[participantId] = normalized;
		writeVolumes(this.deps?.gameId ?? '', this.volumes);
		this.transport?.setParticipantVolume(participantId, normalized);
	}

	private render(): void {
		if (!this.panel || !this.deps || !this.controls || !this.list) return;
		const t = this.deps.t;
		this.panel.querySelector('#voice-panel-title')!.textContent = t('game.voice_title');
		this.panel.querySelector('#voice-disclaimer-text')!.textContent = t('game.voice_disclaimer');
		this.panel.querySelector('#voice-disclaimer-dontshow-label')!.textContent = t('game.voice_disclaimer_dontshow');
		this.panel.querySelector<HTMLButtonElement>('#voice-disclaimer-dismiss')!.textContent = t('game.voice_disclaimer_dismiss');
		// The NAME goes on the application wrapper, not the list inside it: entering the roster
		// should announce what it is once, and a label on both would say it twice. The list keeps
		// its role, and with it the count — "list, 3 items" is how you learn who is in the room.
		this.participantsSurface?.setAttribute('aria-label', t('game.voice_participants'));
		if (this.deviceSettingsButton) {
			this.deviceSettingsButton.hidden = !this.deploymentAvailable || !this.gameEnabled || this.joining;
			this.deviceSettingsButton.textContent = t('game.voice_devices_button');
			this.deviceSettingsButton.setAttribute('aria-label', t('game.voice_devices_button'));
			if (this.deviceSettingsButton.hidden) this.closeDeviceMenu();
		}

		if (this.status) this.status.textContent = t(this.statusKey);
		// Described rather than appended: what this panel offers depends on who is reading it and
		// what the room is doing, and a control that is not on offer should not exist rather than
		// be hidden. Ids are stable so a button that SURVIVES a re-render is never rebuilt under
		// the keyboard — the point of reconciling (see rovingToolbar.ts).
		const controls: ToolbarItem[] = [];
		if (!this.deploymentAvailable) {
			// Capability is reflected by the hidden header control; no actions are rendered.
		} else if (!this.gameEnabled) {
			if (this.deps.isHost()) {
				controls.push(this.control('enable', t('game.voice_enable'),
					() => void this.changeAvailability(true), this.changingAvailability));
			}
		} else {
			if (!this.connected && !this.joining) {
				controls.push(this.control('join', t('game.voice_join'), () => void this.join()));
			}
			if (this.connected) {
				controls.push(this.control(
					'mute',
					t(this.selfMuted ? 'game.voice_unmute' : 'game.voice_mute'),
					() => void this.toggleSelfMute(),
					false,
					'Control+Alt+X',
				));
				controls.push(this.control('leave', t('game.voice_leave'), () => void this.leave(true)));
			}
			if (this.deps.isHost()) {
				controls.push(this.control('disable', t('game.voice_disable'),
					() => void this.changeAvailability(false), this.changingAvailability));
			}
		}
		this.controlsToolbar.setLabel(t('game.voice_controls_label'));
		this.controlsToolbar.render(controls);

		this.renderParticipants();
		this.syncHeaderButton();
	}

	private renderParticipants(): void {
		if (!this.list || !this.deps) return;
		reconcileChildren(this.list, {
			items: this.participants,
			key: participant => participant.id,
			keyOf: element => (element as HTMLElement).dataset.playerId,
			create: participant => {
				const row = this.createParticipantRow(participant.id);
				this.updateParticipantRow(row, participant);
				return row;
			},
			update: (row, participant) => this.updateParticipantRow(row, participant),
			onRemoved: () => this.participantNav?.closeContextMenu(),
			rescueFocus: () => this.list?.querySelector<HTMLElement>('.voice-participant')
				?? this.panel?.querySelector<HTMLElement>(
					'.voice-controls button:not([hidden]), .voice-device-settings:not([hidden]), #voice-panel-title',
				) ?? null,
		});
		this.list.hidden = this.participants.length === 0;
		this.participantNav?.refreshRovingTabindex();
	}

	private createParticipantRow(playerId: string): HTMLLIElement {
		const row = document.createElement('li');
		row.className = 'voice-participant';
		row.dataset.playerId = playerId;
		row.tabIndex = -1;
		row.innerHTML = `
			<div class="voice-participant__identity">
				<span class="voice-participant__name"></span>
				<span class="voice-participant__visual-state" aria-hidden="true"></span>
			</div>
			<div class="voice-participant__actions" role="toolbar">
				<div class="voice-participant__volume">
					<button type="button" class="voice-participant__volume-action" tabindex="-1"></button>
					<input type="range" min="0" max="100" step="5" tabindex="-1">
				</div>
				<button type="button" class="voice-participant__self-mute" tabindex="-1"></button>
				<button type="button" class="voice-participant__host-mute" tabindex="-1"></button>
				<span class="sr-only voice-participant__host-mute-reason"></span>
			</div>`;
		const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
		slider.addEventListener('input', () => this.setVolume(row.dataset.playerId!, Number(slider.value) / 100));
		slider.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			row.focus();
		});
		row.querySelector<HTMLButtonElement>('.voice-participant__volume-action')!
			.addEventListener('click', () => slider.focus());
		return row;
	}

	private updateParticipantRow(row: HTMLElement, participant: VoiceParticipant): void {
		const t = this.deps!.t;
		const displayName = participant.local
			? t('game.voice_participant_self', { player: participant.name })
			: participant.name;
		row.classList.toggle('voice-participant--speaking', participant.speaking && !participant.muted);
		row.classList.toggle('voice-participant--muted', participant.muted);
		// The row NAMES the person and says how they are heard. Its actions are a separate box that
		// only exists once the row is reached (voice.css), so what a reader gets while browsing the
		// list is who is here — not four controls each. The label is set at the END of this method,
		// once it is known whether this row has any actions to promise.
		const identity = t(
			participant.muted
				? 'game.voice_participant_label_muted'
				: 'game.voice_participant_label_listening',
			{ player: displayName },
		);
		row.querySelector('.voice-participant__name')!.textContent = displayName;
		row.querySelector('.voice-participant__visual-state')!.textContent = participant.muted
			? t('game.voice_muted_visual')
			: participant.speaking ? t('game.voice_speaking_visual') : t('game.voice_listening_visual');

		const actions = row.querySelector<HTMLElement>('.voice-participant__actions')!;
		actions.setAttribute('aria-label', t('game.actions_for', { name: displayName }));

		const volumeLabel = row.querySelector<HTMLElement>('.voice-participant__volume')!;
		this.hideParticipantAction(volumeLabel, participant.local, row);
		const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
		if (document.activeElement !== slider) slider.value = String(Math.round(participant.volume * 100));
		const sliderLabel = t('game.voice_volume', { player: participant.name, volume: slider.value });
		const volumeAction = row.querySelector<HTMLButtonElement>('.voice-participant__volume-action')!;
		volumeAction.textContent = sliderLabel;
		volumeAction.setAttribute('aria-label', sliderLabel);
		slider.setAttribute('aria-label', sliderLabel);

		const selfMute = row.querySelector<HTMLButtonElement>('.voice-participant__self-mute')!;
		this.hideParticipantAction(selfMute, !participant.local, row);
		selfMute.textContent = t(participant.muted ? 'game.voice_unmute' : 'game.voice_mute');
		selfMute.setAttribute('aria-label', selfMute.textContent);
		selfMute.onclick = () => void this.toggleSelfMute();

		const mute = row.querySelector<HTMLButtonElement>('.voice-participant__host-mute')!;
		this.hideParticipantAction(mute, participant.local || !this.deps!.isHost(), row);
		mute.textContent = t('game.voice_host_mute', { player: participant.name });
		mute.setAttribute('aria-label', t('game.voice_host_mute', { player: participant.name }));
		const muteReason = row.querySelector<HTMLElement>('.voice-participant__host-mute-reason')!;
		if (participant.muted) {
			mute.setAttribute('aria-disabled', 'true');
			muteReason.textContent = t('game.voice_already_muted', { player: participant.name });
			if (!muteReason.id) muteReason.id = `voice-mute-reason-${participant.id}`;
			mute.setAttribute('aria-describedby', muteReason.id);
		} else {
			mute.removeAttribute('aria-disabled');
			mute.removeAttribute('aria-describedby');
			muteReason.textContent = '';
		}
		mute.onclick = () => void this.hostMute(participant, mute);

		// …and only now, knowing what this row actually offers, does it say so. The Right Arrow is
		// the only way in — the actions are not in the reading order until focus arrives — so a row
		// that has some must announce the way, and a row that has none must not promise one.
		const hasActions = [volumeLabel, selfMute, mute].some(action => !action.hidden);
		const label = hasActions
			? `${identity} ${t('game.voice_participant_more_actions')}`
			: identity;
		if (row.getAttribute('aria-label') !== label) row.setAttribute('aria-label', label);
	}

	private hideParticipantAction(element: HTMLElement, hidden: boolean, row: HTMLElement): void {
		if (hidden && (document.activeElement === element || element.contains(document.activeElement))) {
			row.focus();
		}
		element.hidden = hidden;
	}

	/** One of the panel's own actions, as a descriptor for the controls toolbar. */
	private control(
		id: string,
		label: string,
		action: () => void,
		unavailable = false,
		keyShortcut?: string,
	): ToolbarItem {
		return {
			id,
			label,
			shortcut: keyShortcut,
			// aria-disabled, never the `disabled` attribute: an action in flight stays reachable.
			busy: unavailable,
			onActivate: () => { if (!unavailable) action(); },
		};
	}

	private setStatus(key: string): void {
		this.statusKey = key;
		if (this.status && this.deps) this.status.textContent = this.deps.t(key);
	}

	private connectedStatusKey(): string {
		return this.selfMuted ? 'game.voice_connected_muted' : 'game.voice_connected';
	}

	private playSoundEvent(event: string): void {
		(this.deps?.playSoundEvent ?? ((name: string) => soundEvents.playEvent(name)))(event);
	}

	private syncHeaderButton(): void {
		if (!this.headerButton || !this.deps) return;
		this.headerButton.hidden = !this.deploymentAvailable;
		this.headerButton.classList.toggle('voice-toggle--enabled', this.gameEnabled);
		this.headerButton.classList.toggle('voice-toggle--connected', this.connected);
		this.headerButton.setAttribute('aria-expanded', String(this.isOpen()));
		const label = this.connected ? this.deps.t('game.voice_open_connected')
			: this.gameEnabled ? this.deps.t('game.voice_open_ready')
			: this.deps.t('game.voice_open_off');
		this.headerButton.setAttribute('aria-label', label);
		this.headerButton.title = label;

		if (this.microphoneButton) {
			this.microphoneButton.hidden = !this.deploymentAvailable || !this.connected;
			// Muting strikes the icon through (voice.css) and rewrites the label, which
			// states the microphone's state AND what a press does. aria-pressed on top of
			// that was a third telling of the same fact, and the least clear of the three.
			this.microphoneButton.classList.toggle('voice-microphone-toggle--muted', this.selfMuted);
			const microphoneLabel = this.deps.t(this.selfMuted
				? 'game.voice_microphone_button_muted'
				: 'game.voice_microphone_button_on');
			this.microphoneButton.setAttribute('aria-label', microphoneLabel);
			this.microphoneButton.title = microphoneLabel;
		}
	}
}

function disclaimerDismissed(): boolean {
	try { return localStorage.getItem(DISCLAIMER_KEY) === '1'; } catch { return false; }
}

function persistDisclaimerDismissed(): void {
	try { localStorage.setItem(DISCLAIMER_KEY, '1'); } catch { /* session-only */ }
}

function volumeStorageKey(gameId: string): string { return `corro.voiceVolumes.${gameId}`; }

function readVolumes(gameId: string): Record<string, number> {
	try {
		const value = JSON.parse(localStorage.getItem(volumeStorageKey(gameId)) ?? '{}');
		return value && typeof value === 'object' ? value as Record<string, number> : {};
	} catch { return {}; }
}

function writeVolumes(gameId: string, volumes: Record<string, number>): void {
	if (!gameId) return;
	try { localStorage.setItem(volumeStorageKey(gameId), JSON.stringify(volumes)); } catch { /* session-only */ }
}

export function readVoiceDevicePreferences(): VoiceDevicePreferences {
	try {
		const parsed = JSON.parse(localStorage.getItem(DEVICE_PREFERENCES_KEY) ?? '{}') as Partial<VoiceDevicePreferences>;
		return {
			microphoneId: typeof parsed.microphoneId === 'string' && parsed.microphoneId
				? parsed.microphoneId : 'default',
			outputId: typeof parsed.outputId === 'string' && parsed.outputId
				? parsed.outputId : 'default',
		};
	} catch {
		return { ...DEFAULT_DEVICE_PREFERENCES };
	}
}

function writeVoiceDevicePreferences(preferences: VoiceDevicePreferences): void {
	try { localStorage.setItem(DEVICE_PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* session-only */ }
}

export const voicePanel = new VoicePanel();