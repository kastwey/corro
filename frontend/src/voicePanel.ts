// voicePanel.ts — opt-in, accessibility-first LiveKit voice controls.
//
// Presence and speaking indicators are visual continuously. Screen readers hear join/leave
// events, while "who is speaking?" is deliberately an on-demand shortcut so live human speech
// is never covered by a stream of automatic speaker-name announcements.

import { soundEvents } from './soundEvents.js';
import {
	createVoiceTransport,
	type VoiceParticipant,
	type VoiceTransport,
	type VoiceTransportCallbacks,
} from './voiceTransport.js';

const DISCLAIMER_KEY = 'corro.voiceDisclaimerDismissed';

export interface VoicePanelDeps {
	t: (key: string, vars?: Record<string, unknown>) => string;
	gameId: string;
	getMyPlayerId: () => string;
	isHost: () => boolean;
	requestToken: () => Promise<{ url: string; token: string }>;
	setEnabled: (enabled: boolean) => Promise<void>;
	muteParticipant: (playerId: string) => Promise<void>;
	announce: (key: string, vars?: Record<string, unknown>, instant?: boolean) => void;
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
	private dialog: HTMLDialogElement | null = null;
	private status: HTMLElement | null = null;
	private controls: HTMLElement | null = null;
	private list: HTMLUListElement | null = null;
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

	init(mount: HTMLElement, deps: VoicePanelDeps): void {
		this.deps = deps;
		this.volumes = readVolumes(deps.gameId);
		if (this.dialog) return;
		this.createHeaderButton(mount);
		this.createDialog();
		this.render();
	}

	isOpen(): boolean { return !!this.dialog?.open; }
	isConnected(): boolean { return this.connected; }

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
		if (!this.dialog || !this.deploymentAvailable) return;
		this.deps?.beforeOpen?.();
		if (!this.dialog.open) this.dialog.show();
		this.syncHeaderButton();
		const notice = this.dialog.querySelector<HTMLElement>('#voice-disclaimer-text');
		const banner = this.dialog.querySelector<HTMLElement>('#voice-disclaimer');
		if (banner && !banner.hidden && notice) {
			notice.focus();
			return;
		}
		this.focus();
	}

	closePanel(): void {
		if (this.dialog?.open) this.dialog.close();
		this.syncHeaderButton();
		this.headerButton?.focus();
	}

	focus(): boolean {
		if (!this.isOpen()) {
			this.openPanel();
			return this.isOpen();
		}
		const target = this.dialog?.querySelector<HTMLElement>(
			'#voice-disclaimer:not([hidden]) #voice-disclaimer-text, .voice-controls button:not([hidden]), .voice-participants input, .voice-panel__close',
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

	private createHeaderButton(mount: HTMLElement): void {
		const button = document.createElement('button');
		button.type = 'button';
		button.id = 'voice-toggle';
		button.className = 'icon-btn voice-toggle';
		button.hidden = true;
		button.setAttribute('aria-haspopup', 'dialog');
		button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg><span class="voice-toggle__dot" aria-hidden="true"></span>';
		button.addEventListener('click', () => this.togglePanel());
		mount.appendChild(button);
		this.headerButton = button;
	}

	private createDialog(): void {
		const dialog = document.createElement('dialog');
		dialog.id = 'voice-panel';
		dialog.className = 'game-dialog voice-panel';
		dialog.dataset.modal = 'false';
		dialog.setAttribute('aria-labelledby', 'voice-panel-title');
		dialog.innerHTML = `
			<div class="voice-panel__surface">
				<div class="dialog-title" id="voice-panel-title"></div>
				<button type="button" class="voice-panel__close"></button>
				<div class="voice-disclaimer" id="voice-disclaimer" hidden>
					<p id="voice-disclaimer-text" tabindex="0"></p>
					<label><input type="checkbox" id="voice-disclaimer-dontshow"><span id="voice-disclaimer-dontshow-label"></span></label>
					<button type="button" id="voice-disclaimer-dismiss" class="btn btn-secondary"></button>
				</div>
				<p class="voice-status" id="voice-status" tabindex="0"></p>
				<div class="voice-controls" id="voice-controls"></div>
				<ul class="voice-participants" id="voice-participants" role="list"></ul>
			</div>`;
		document.body.appendChild(dialog);
		this.dialog = dialog;
		this.status = dialog.querySelector('#voice-status');
		this.controls = dialog.querySelector('#voice-controls');
		this.list = dialog.querySelector('#voice-participants');

		dialog.querySelector('.voice-panel__close')!.addEventListener('click', () => this.closePanel());
		dialog.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			this.closePanel();
		});

		const banner = dialog.querySelector<HTMLElement>('#voice-disclaimer')!;
		if (!disclaimerDismissed()) banner.hidden = false;
		dialog.querySelector('#voice-disclaimer-dismiss')!.addEventListener('click', () => {
			banner.hidden = true;
			if ((dialog.querySelector('#voice-disclaimer-dontshow') as HTMLInputElement).checked) {
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
			let created!: VoiceTransport;
			const callbacks = this.transportCallbacks(() => created);
			created = this.deps.createTransport?.(callbacks) ?? createVoiceTransport(callbacks);
			transport = created;
			this.transport = created;
			await created.connect(credentials.url, credentials.token);
			if (this.transport !== created) return;
			this.connected = true;
			this.selfMuted = false;
			this.syncParticipants(created.getParticipants());
			this.setStatus('game.voice_connected');
			this.deps.announce('game.voice_joined_self');
			soundEvents.playEvent('voice.join');
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
			soundEvents.playEvent('voice.leave');
		}
		this.render();
	}

	private transportCallbacks(current: () => VoiceTransport): VoiceTransportCallbacks {
		return {
			onParticipantJoined: participant => {
				if (this.transport !== current()) return;
				if (this.connected) {
					this.deps?.announce('game.voice_joined', { player: participant.name });
					soundEvents.playEvent('voice.join');
				}
			},
			onParticipantLeft: participant => {
				if (this.transport !== current()) return;
				this.appliedVolumes.delete(participant.id);
				if (this.connected) {
					this.deps?.announce('game.voice_left', { player: participant.name });
					soundEvents.playEvent('voice.leave');
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
				this.setStatus('game.voice_connected');
				this.deps?.announce('game.voice_reconnected');
			},
			onDisconnected: unexpected => {
				if (this.transport !== current()) return;
				this.transport = null;
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
		};
	}

	private syncParticipants(participants: VoiceParticipant[]): void {
		this.participants = participants;
		this.publishPresence();
		const me = participants.find(participant => participant.local);
		this.selfMuted = me?.muted ?? this.selfMuted;
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
		// when the only changed value lives exclusively in the settings dialog.
		if (signature === this.publishedPresenceSignature) return;
		this.publishedPresenceSignature = signature;
		this.deps?.onPresenceChanged?.(snapshot);
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
		if (!this.dialog || !this.deps || !this.controls || !this.list) return;
		const t = this.deps.t;
		this.dialog.querySelector('#voice-panel-title')!.textContent = t('game.voice_title');
		const close = this.dialog.querySelector<HTMLButtonElement>('.voice-panel__close')!;
		close.textContent = t('game.voice_close');
		close.setAttribute('aria-label', t('game.voice_close'));
		this.dialog.querySelector('#voice-disclaimer-text')!.textContent = t('game.voice_disclaimer');
		this.dialog.querySelector('#voice-disclaimer-dontshow-label')!.textContent = t('game.voice_disclaimer_dontshow');
		this.dialog.querySelector<HTMLButtonElement>('#voice-disclaimer-dismiss')!.textContent = t('game.voice_disclaimer_dismiss');
		this.list.setAttribute('aria-label', t('game.voice_participants'));

		this.controls.replaceChildren();
		if (this.status) this.status.textContent = t(this.statusKey);
		if (!this.deploymentAvailable) {
			// Capability is reflected by the hidden header control; no actions are rendered.
		} else if (!this.gameEnabled) {
			if (this.deps.isHost()) {
				this.controls.appendChild(this.controlButton(
					t('game.voice_enable'),
					() => void this.changeAvailability(true),
					this.changingAvailability,
				));
			}
		} else {
			if (!this.connected && !this.joining) {
				this.controls.appendChild(this.controlButton(t('game.voice_join'), () => void this.join()));
			}
			if (this.connected) {
				this.controls.appendChild(this.controlButton(
					t(this.selfMuted ? 'game.voice_unmute' : 'game.voice_mute'),
					() => void this.toggleSelfMute(),
				));
				this.controls.appendChild(this.controlButton(t('game.voice_leave'), () => void this.leave(true)));
			}
			if (this.deps.isHost()) {
				this.controls.appendChild(this.controlButton(
					t('game.voice_disable'),
					() => void this.changeAvailability(false),
					this.changingAvailability,
				));
			}
		}

		this.renderParticipants();
		this.syncHeaderButton();
	}

	private renderParticipants(): void {
		if (!this.list || !this.deps) return;
		const ids = new Set(this.participants.map(participant => participant.id));
		for (const existing of Array.from(this.list.children) as HTMLElement[]) {
			if (!ids.has(existing.dataset.playerId ?? '')) existing.remove();
		}
		for (const participant of this.participants) {
			let row = Array.from(this.list.children)
				.find(child => (child as HTMLElement).dataset.playerId === participant.id) as HTMLElement | undefined;
			if (!row) {
				row = this.createParticipantRow(participant.id);
				this.list.appendChild(row);
			}
			this.updateParticipantRow(row, participant);
		}
		this.list.hidden = this.participants.length === 0;
	}

	private createParticipantRow(playerId: string): HTMLLIElement {
		const row = document.createElement('li');
		row.className = 'voice-participant';
		row.dataset.playerId = playerId;
		row.innerHTML = `
			<div class="voice-participant__identity">
				<span class="voice-participant__name"></span>
				<span class="voice-participant__visual-state" aria-hidden="true"></span>
				<span class="sr-only voice-participant__reader-state"></span>
			</div>
			<label class="voice-participant__volume">
				<span></span>
				<input type="range" min="0" max="100" step="5">
			</label>
			<button type="button" class="voice-participant__host-mute"></button>`;
		const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
		slider.addEventListener('input', () => this.setVolume(row.dataset.playerId!, Number(slider.value) / 100));
		return row;
	}

	private updateParticipantRow(row: HTMLElement, participant: VoiceParticipant): void {
		const t = this.deps!.t;
		row.classList.toggle('voice-participant--speaking', participant.speaking && !participant.muted);
		row.classList.toggle('voice-participant--muted', participant.muted);
		row.querySelector('.voice-participant__name')!.textContent = participant.local
			? t('game.voice_participant_self', { player: participant.name })
			: participant.name;
		row.querySelector('.voice-participant__visual-state')!.textContent = participant.muted
			? t('game.voice_muted_visual')
			: participant.speaking ? t('game.voice_speaking_visual') : t('game.voice_listening_visual');
		row.querySelector('.voice-participant__reader-state')!.textContent = participant.muted
			? t('game.voice_muted_visual') : t('game.voice_microphone_on');

		const volumeLabel = row.querySelector<HTMLElement>('.voice-participant__volume')!;
		volumeLabel.hidden = participant.local;
		const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
		if (document.activeElement !== slider) slider.value = String(Math.round(participant.volume * 100));
		const sliderLabel = t('game.voice_volume', { player: participant.name, volume: slider.value });
		volumeLabel.querySelector('span')!.textContent = sliderLabel;
		slider.setAttribute('aria-label', sliderLabel);

		const mute = row.querySelector<HTMLButtonElement>('.voice-participant__host-mute')!;
		mute.hidden = participant.local || !this.deps!.isHost();
		mute.textContent = t('game.voice_host_mute', { player: participant.name });
		mute.setAttribute('aria-label', t('game.voice_host_mute', { player: participant.name }));
		if (participant.muted) mute.setAttribute('aria-disabled', 'true');
		else mute.removeAttribute('aria-disabled');
		mute.onclick = () => void this.hostMute(participant, mute);
	}

	private controlButton(label: string, action: () => void, unavailable = false): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'btn btn-secondary';
		button.textContent = label;
		if (unavailable) button.setAttribute('aria-disabled', 'true');
		button.addEventListener('click', () => {
			if (!unavailable) action();
		});
		return button;
	}

	private setStatus(key: string): void {
		this.statusKey = key;
		if (this.status && this.deps) this.status.textContent = this.deps.t(key);
	}

	private syncHeaderButton(): void {
		if (!this.headerButton || !this.deps) return;
		this.headerButton.hidden = !this.deploymentAvailable;
		this.headerButton.classList.toggle('voice-toggle--enabled', this.gameEnabled);
		this.headerButton.classList.toggle('voice-toggle--connected', this.connected);
		this.headerButton.setAttribute('aria-expanded', String(this.isOpen()));
		this.headerButton.setAttribute('aria-pressed', String(this.connected));
		const label = this.connected ? this.deps.t('game.voice_open_connected')
			: this.gameEnabled ? this.deps.t('game.voice_open_ready')
			: this.deps.t('game.voice_open_off');
		this.headerButton.setAttribute('aria-label', label);
		this.headerButton.title = label;
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

export const voicePanel = new VoicePanel();