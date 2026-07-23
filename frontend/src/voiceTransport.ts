import type {
	Participant,
	RemoteAudioTrack,
	RemoteParticipant,
	RemoteTrack,
	RemoteTrackPublication,
	Room,
	TrackPublication,
} from 'livekit-client';

export interface VoiceParticipant {
	id: string;
	name: string;
	local: boolean;
	muted: boolean;
	speaking: boolean;
	volume: number;
}

export interface VoiceTransportCallbacks {
	onParticipantJoined(participant: VoiceParticipant): void;
	onParticipantLeft(participant: VoiceParticipant): void;
	onParticipantsChanged(participants: VoiceParticipant[]): void;
	onReconnecting(): void;
	onReconnected(): void;
	onDisconnected(unexpected: boolean): void;
	onPlaybackBlocked(): void;
}

export interface VoiceTransport {
	connect(url: string, token: string): Promise<void>;
	disconnect(): Promise<void>;
	setMuted(muted: boolean): Promise<void>;
	setParticipantVolume(participantId: string, volume: number): void;
	getParticipants(): VoiceParticipant[];
	getActiveSpeakers(): VoiceParticipant[];
}

declare global {
	interface Window {
		/** Browser runtime loaded lazily from dist/libs/livekit-client.umd.js. */
		LivekitClient?: typeof import('livekit-client');
		/** Test hook: E2E supplies a deterministic transport without a real SFU or microphone. */
		__corroVoiceTransportFactory?: (callbacks: VoiceTransportCallbacks) => VoiceTransport;
	}
}

/** Clamp a user volume percentage to the SDK's 0..1 range. Exported for unit tests. */
export function clampVoiceVolume(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(1, Math.max(0, value));
}

export function createVoiceTransport(callbacks: VoiceTransportCallbacks): VoiceTransport {
	return window.__corroVoiceTransportFactory?.(callbacks)
		?? new LiveKitVoiceTransport(callbacks);
}

class LiveKitVoiceTransport implements VoiceTransport {
	private room: Room | null = null;
	private intentionalDisconnect = false;
	private readonly volumes = new Map<string, number>();
	private readonly attachedTracks = new Map<string, RemoteTrack>();
	private audioHost: HTMLElement | null = null;

	constructor(private readonly callbacks: VoiceTransportCallbacks) { }

	async connect(url: string, token: string): Promise<void> {
		if (this.room) return;
		const sdk = window.LivekitClient;
		if (!sdk) {
			throw new Error('LiveKit browser client is unavailable.');
		}

		const room = new sdk.Room({ adaptiveStream: false, dynacast: false });
		this.room = room;
		this.intentionalDisconnect = false;
		this.bindRoom(room);

		try {
			await room.connect(url, token, { autoSubscribe: true });
			// Joining is an explicit user gesture: start playback and publish the microphone
			// immediately. If permission fails, leave rather than appearing to listen silently.
			await room.startAudio();
			const microphone = await room.localParticipant.setMicrophoneEnabled(true);
			if (!microphone) throw new Error('The microphone could not be published.');
			this.emitParticipants();
		} catch (error) {
			this.intentionalDisconnect = true;
			await room.disconnect().catch(() => undefined);
			this.room = null;
			throw error;
		}
	}

	async disconnect(): Promise<void> {
		const room = this.room;
		if (!room) return;
		this.intentionalDisconnect = true;
		this.room = null;
		await room.disconnect(true);
		this.cleanupAudio();
	}

	async setMuted(muted: boolean): Promise<void> {
		if (!this.room) throw new Error('Voice chat is not connected.');
		await this.room.localParticipant.setMicrophoneEnabled(!muted);
		this.emitParticipants();
	}

	setParticipantVolume(participantId: string, volume: number): void {
		const normalized = clampVoiceVolume(volume);
		this.volumes.set(participantId, normalized);
		const participant = this.room?.remoteParticipants.get(participantId);
		participant?.audioTrackPublications.forEach(publication => {
			(publication.track as RemoteAudioTrack | undefined)?.setVolume(normalized);
		});
		this.emitParticipants();
	}

	getParticipants(): VoiceParticipant[] {
		const room = this.room;
		if (!room) return [];
		return [
			this.projectParticipant(room.localParticipant),
			...Array.from(room.remoteParticipants.values(), participant => this.projectParticipant(participant)),
		].sort((a, b) => Number(b.local) - Number(a.local) || a.name.localeCompare(b.name));
	}

	getActiveSpeakers(): VoiceParticipant[] {
		const room = this.room;
		if (!room) return [];
		return room.activeSpeakers
			.filter(participant => participant.isSpeaking)
			.map(participant => this.projectParticipant(participant));
	}

	private bindRoom(room: Room): void {
		const sdk = window.LivekitClient!;
		const events = sdk.RoomEvent;
		room.on(events.ParticipantConnected, (participant: RemoteParticipant) => {
			this.callbacks.onParticipantJoined(this.projectParticipant(participant));
			this.emitParticipants();
		});
		room.on(events.ParticipantDisconnected, (participant: RemoteParticipant) => {
			this.callbacks.onParticipantLeft(this.projectParticipant(participant));
			this.volumes.delete(participant.identity);
			this.emitParticipants();
		});
		room.on(events.TrackSubscribed, (
			track: RemoteTrack,
			publication: RemoteTrackPublication,
			participant: RemoteParticipant,
		) => {
			if (track.kind !== sdk.Track.Kind.Audio) return;
			const audioTrack = track as RemoteAudioTrack;
			audioTrack.setVolume(this.volumes.get(participant.identity) ?? 1);
			const element = track.attach();
			element.dataset.voiceParticipant = participant.identity;
			this.ensureAudioHost().appendChild(element);
			this.attachedTracks.set(publication.trackSid, audioTrack);
			this.emitParticipants();
		});
		room.on(events.TrackUnsubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
			track.detach().forEach(element => element.remove());
			this.attachedTracks.delete(publication.trackSid);
			this.emitParticipants();
		});
		room.on(events.TrackMuted, (_publication: TrackPublication, _participant: Participant) => this.emitParticipants());
		room.on(events.TrackUnmuted, (_publication: TrackPublication, _participant: Participant) => this.emitParticipants());
		room.on(events.ActiveSpeakersChanged, () => this.emitParticipants());
		room.on(events.ParticipantNameChanged, () => this.emitParticipants());
		room.on(events.Reconnecting, () => this.callbacks.onReconnecting());
		room.on(events.Reconnected, () => {
			this.callbacks.onReconnected();
			this.emitParticipants();
		});
		room.on(events.AudioPlaybackStatusChanged, () => {
			if (!room.canPlaybackAudio) this.callbacks.onPlaybackBlocked();
		});
		room.on(events.Disconnected, () => {
			const unexpected = !this.intentionalDisconnect;
			this.room = null;
			this.cleanupAudio();
			this.callbacks.onDisconnected(unexpected);
		});
	}

	private projectParticipant(participant: Participant): VoiceParticipant {
		return {
			id: participant.identity,
			name: participant.name || participant.identity,
			local: participant.isLocal,
			muted: !participant.isMicrophoneEnabled,
			speaking: participant.isSpeaking,
			volume: participant.isLocal ? 1 : this.volumes.get(participant.identity) ?? 1,
		};
	}

	private emitParticipants(): void {
		this.callbacks.onParticipantsChanged(this.getParticipants());
	}

	private ensureAudioHost(): HTMLElement {
		if (this.audioHost) return this.audioHost;
		const host = document.createElement('div');
		host.id = 'voice-audio';
		host.setAttribute('aria-hidden', 'true');
		document.body.appendChild(host);
		this.audioHost = host;
		return host;
	}

	private cleanupAudio(): void {
		this.attachedTracks.forEach(track => track.detach().forEach(element => element.remove()));
		this.attachedTracks.clear();
		this.audioHost?.remove();
		this.audioHost = null;
	}
}