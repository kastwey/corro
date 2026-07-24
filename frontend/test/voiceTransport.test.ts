import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import {
	createVoiceTransport,
	type VoiceTransportCallbacks,
} from '../src/voiceTransport.js';

before(() => setupDom());

const roomEvents = {
	ParticipantConnected: 'participantConnected',
	ParticipantDisconnected: 'participantDisconnected',
	TrackSubscribed: 'trackSubscribed',
	TrackUnsubscribed: 'trackUnsubscribed',
	TrackMuted: 'trackMuted',
	TrackUnmuted: 'trackUnmuted',
	ActiveSpeakersChanged: 'activeSpeakersChanged',
	ParticipantNameChanged: 'participantNameChanged',
	Reconnecting: 'reconnecting',
	Reconnected: 'reconnected',
	AudioPlaybackStatusChanged: 'audioPlaybackStatusChanged',
	MediaDevicesChanged: 'mediaDevicesChanged',
	ActiveDeviceChanged: 'activeDeviceChanged',
	Disconnected: 'disconnected',
};

let currentRoom: FakeRoom;
let calls: string[];
let devicesChanged: number;
let fallbacks: string[];

class FakeRoom {
	static async getLocalDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
		const devices = kind === 'audioinput'
			? [
				device('audioinput', 'default', 'Default'),
				device('audioinput', 'mic-usb', 'USB microphone'),
				device('audioinput', 'mic-usb', 'USB microphone duplicate'),
			]
			: [device('audiooutput', 'out-headset', 'Headset')];
		return devices as MediaDeviceInfo[];
	}

	localParticipant = {
		identity: 'me',
		name: 'Ana',
		isLocal: true,
		isMicrophoneEnabled: false,
		isSpeaking: false,
		audioTrackPublications: new Map(),
		setMicrophoneEnabled: async (enabled: boolean) => {
			calls.push(`microphone:${enabled}`);
			this.localParticipant.isMicrophoneEnabled = enabled;
			return {};
		},
	};
	remoteParticipants = new Map();
	activeSpeakers: any[] = [];
	canPlaybackAudio = true;
	private handlers = new Map<string, Array<(...args: any[]) => void>>();

	constructor() { currentRoom = this; }
	async connect() { calls.push('connect'); }
	async startAudio() { calls.push('startAudio'); }
	async disconnect() { calls.push('disconnect'); }
	async switchActiveDevice(kind: MediaDeviceKind, id: string) {
		calls.push(`device:${kind}:${id}`);
		if (id === 'missing') throw new Error('missing device');
		this.emit(roomEvents.ActiveDeviceChanged, kind, id);
		return true;
	}
	on(event: string, handler: (...args: any[]) => void) {
		this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
		return this;
	}
	emit(event: string, ...args: any[]) {
		for (const handler of this.handlers.get(event) ?? []) handler(...args);
	}
}

function device(kind: MediaDeviceKind, deviceId: string, label: string): Partial<MediaDeviceInfo> {
	return { kind, deviceId, label, groupId: '', toJSON: () => ({}) };
}

function callbacks(): VoiceTransportCallbacks {
	return {
		onParticipantJoined: () => {},
		onParticipantLeft: () => {},
		onParticipantsChanged: () => {},
		onReconnecting: () => {},
		onReconnected: () => {},
		onDisconnected: () => {},
		onPlaybackBlocked: () => {},
		onDevicesChanged: () => { devicesChanged++; },
		onDevicePreferenceFallback: kind => { fallbacks.push(kind); },
	};
}

beforeEach(() => {
	calls = [];
	devicesChanged = 0;
	fallbacks = [];
	delete (window as any).__corroVoiceTransportFactory;
	delete (window as any).__corroVoiceDeviceProvider;
	Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} });
	(window as any).LivekitClient = {
		Room: FakeRoom,
		RoomEvent: roomEvents,
		Track: { Kind: { Audio: 'audio' } },
		supportsAudioOutputSelection: () => true,
	};
});

test('saved devices are applied before the microphone is published', async () => {
	const transport = createVoiceTransport(callbacks());
	await transport.connect('wss://voice.test', 'token', {
		microphoneId: 'mic-usb',
		outputId: 'out-headset',
	});

	assert.deepEqual(calls.slice(0, 5), [
		'connect',
		'startAudio',
		'device:audioinput:mic-usb',
		'device:audiooutput:out-headset',
		'microphone:true',
	]);
	assert.equal(devicesChanged, 2, 'LiveKit active-device events propagate');
});

test('device snapshots omit duplicate default entries and switches delegate to LiveKit', async () => {
	const transport = createVoiceTransport(callbacks());
	await transport.connect('wss://voice.test', 'token');
	const snapshot = await transport.getDeviceSnapshot();

	assert.deepEqual(snapshot.microphones, [{ deviceId: 'mic-usb', label: 'USB microphone' }]);
	assert.deepEqual(snapshot.outputs, [{ deviceId: 'out-headset', label: 'Headset' }]);
	assert.equal(snapshot.outputSelectionSupported, true);
	await transport.setMicrophoneDevice('default');
	await transport.setOutputDevice('out-headset');
	assert.ok(calls.includes('device:audioinput:default'));
	assert.ok(calls.includes('device:audiooutput:out-headset'));

	currentRoom.emit(roomEvents.MediaDevicesChanged);
	assert.ok(devicesChanged >= 3);
});

test('an unavailable saved device falls back without failing voice join', async () => {
	const transport = createVoiceTransport(callbacks());
	await transport.connect('wss://voice.test', 'token', {
		microphoneId: 'missing',
		outputId: 'default',
	});

	assert.deepEqual(fallbacks, ['audioinput']);
	assert.ok(calls.includes('microphone:true'));
});

test('an output granted by the browser prompt is switched through LiveKit', async () => {
	Object.defineProperty(navigator, 'mediaDevices', {
		configurable: true,
		value: {
			selectAudioOutput: async () => device('audiooutput', 'out-dock', 'Dock speakers'),
		},
	});
	const transport = createVoiceTransport(callbacks());
	await transport.connect('wss://voice.test', 'token');

	const selected = await transport.requestOutputDevice();
	assert.deepEqual(selected, { deviceId: 'out-dock', label: 'Dock speakers' });
	assert.ok(calls.includes('device:audiooutput:out-dock'));
});
