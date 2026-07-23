import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import {
	VoicePanel,
	formatVoiceSpeakerNames,
	voiceJoinErrorKey,
} from '../src/voicePanel.js';
import type {
	VoiceParticipant,
	VoiceTransport,
	VoiceTransportCallbacks,
} from '../src/voiceTransport.js';

before(() => setupDom());

let panel: VoicePanel;
let transport: FakeVoiceTransport;
let announcements: Array<{ key: string; vars: Record<string, unknown>; instant: boolean }>;
let availabilityChanges: boolean[];
let hostMutes: string[];
let presenceUpdates: Array<Array<{ id: string; muted: boolean; speaking: boolean }>>;
let host = true;
let nextConnectError: unknown = null;

class FakeVoiceTransport implements VoiceTransport {
	participants: VoiceParticipant[] = [
		{ id: 'me', name: 'Ana', local: true, muted: false, speaking: false, volume: 1 },
	];
	activeSpeakers: VoiceParticipant[] = [];
	connectedWith: { url: string; token: string } | null = null;
	disconnects = 0;
	muteChanges: boolean[] = [];
	volumeChanges: Array<{ id: string; volume: number }> = [];
	connectError: unknown = null;

	constructor(readonly callbacks: VoiceTransportCallbacks) { }

	async connect(url: string, token: string): Promise<void> {
		if (this.connectError) throw this.connectError;
		this.connectedWith = { url, token };
		this.callbacks.onParticipantsChanged(this.participants);
	}

	async disconnect(): Promise<void> { this.disconnects++; }

	async setMuted(muted: boolean): Promise<void> {
		this.muteChanges.push(muted);
		this.participants[0] = { ...this.participants[0], muted };
		this.callbacks.onParticipantsChanged(this.participants);
	}

	setParticipantVolume(participantId: string, volume: number): void {
		this.volumeChanges.push({ id: participantId, volume });
		this.participants = this.participants.map(p => p.id === participantId ? { ...p, volume } : p);
		this.callbacks.onParticipantsChanged(this.participants);
	}

	getParticipants(): VoiceParticipant[] { return this.participants; }
	getActiveSpeakers(): VoiceParticipant[] { return this.activeSpeakers; }

	addRemote(participant: VoiceParticipant): void {
		this.participants = [...this.participants, participant];
		this.callbacks.onParticipantJoined(participant);
		this.callbacks.onParticipantsChanged(this.participants);
	}

	removeRemote(id: string): void {
		const participant = this.participants.find(p => p.id === id)!;
		this.participants = this.participants.filter(p => p.id !== id);
		this.callbacks.onParticipantLeft(participant);
		this.callbacks.onParticipantsChanged(this.participants);
	}
}

function translate(key: string, vars?: Record<string, unknown>): string {
	return (window as any).i18next.t(key, vars);
}

function mountPanel(options: { enabled?: boolean; available?: boolean } = {}): void {
	const mount = document.createElement('div');
	document.body.appendChild(mount);
	panel.init(mount, {
		t: translate,
		gameId: 'game-1',
		getMyPlayerId: () => 'me',
		isHost: () => host,
		requestToken: async () => ({ url: 'wss://voice.test', token: 'join-token' }),
		setEnabled: async enabled => { availabilityChanges.push(enabled); },
		muteParticipant: async id => { hostMutes.push(id); },
		announce: (key, vars = {}, instant = false) => announcements.push({ key, vars, instant }),
		onPresenceChanged: participants => presenceUpdates.push(participants.map(participant => ({ ...participant }))),
		createTransport: callbacks => {
			transport = new FakeVoiceTransport(callbacks);
			transport.connectError = nextConnectError;
			return transport;
		},
	});
	panel.setDeploymentAvailable(options.available ?? true);
	panel.setGameEnabled(options.enabled ?? true);
}

async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

function openPastDisclaimer(): void {
	panel.openPanel();
	(document.getElementById('voice-disclaimer-dismiss') as HTMLButtonElement).click();
}

beforeEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	installFakeI18next('en');
	panel = new VoicePanel();
	transport = undefined as unknown as FakeVoiceTransport;
	announcements = [];
	availabilityChanges = [];
	hostMutes = [];
	presenceUpdates = [];
	host = true;
	nextConnectError = null;
});

test('host sees the deployment-gated control and can enable voice for the game', async () => {
	mountPanel({ enabled: false });
	const header = document.getElementById('voice-toggle') as HTMLButtonElement;
	assert.equal(header.hidden, false);
	panel.openPanel();
	assert.equal(document.activeElement, document.getElementById('voice-disclaimer-text'));
	(document.getElementById('voice-disclaimer-dismiss') as HTMLButtonElement).click();

	const enable = Array.from(document.querySelectorAll<HTMLButtonElement>('#voice-controls button'))
		.find(button => button.textContent === 'Enable voice chat')!;
	enable.click();
	await settle();
	assert.deepEqual(availabilityChanges, [true]);

	panel.setDeploymentAvailable(false);
	assert.equal(header.hidden, true, 'an unconfigured deployment exposes no dead control');
});

test('joining is explicit, starts unmuted, renders the roster and announces entry', async () => {
	mountPanel();
	openPastDisclaimer();
	const join = Array.from(document.querySelectorAll<HTMLButtonElement>('#voice-controls button'))
		.find(button => button.textContent?.includes('Join with microphone'))!;
	join.click();
	await settle();

	assert.equal(panel.isConnected(), true);
	assert.deepEqual(transport.connectedWith, { url: 'wss://voice.test', token: 'join-token' });
	assert.equal(document.querySelector('.voice-participant__name')?.textContent, 'Ana (you)');
	assert.equal(document.querySelector('.voice-participant__visual-state')?.textContent, 'Listening');
	assert.equal(document.querySelector('.voice-participant__volume')?.hasAttribute('hidden'), true,
		'there is no meaningless self-volume slider');
	assert.deepEqual(presenceUpdates.at(-1), [{ id: 'me', muted: false, speaking: false }],
		'the persistent player panel receives local voice presence');
	assert.ok(announcements.some(a => a.key === 'game.voice_joined_self'));
	assert.equal(document.querySelector('[disabled]'), null, 'controls stay focusable; disabled is forbidden');
});

test('remote presence is voiced, speaking stays visual until queried, and volume is local', async () => {
	mountPanel();
	openPastDisclaimer();
	(document.querySelector('#voice-controls button') as HTMLButtonElement).click();
	await settle();
	announcements.length = 0;

	const berto: VoiceParticipant = {
		id: 'berto', name: 'Berto', local: false, muted: false, speaking: true, volume: 1,
	};
	transport.addRemote(berto);
	assert.ok(announcements.some(a => a.key === 'game.voice_joined' && a.vars.player === 'Berto'));
	assert.equal(document.querySelector('[data-player-id="berto"]')?.classList.contains('voice-participant--speaking'), true);
	assert.equal(announcements.some(a => a.key === 'game.voice_speakers'), false,
		'active-speaker changes do not chatter at screen readers');
	assert.deepEqual(presenceUpdates.at(-1), [
		{ id: 'me', muted: false, speaking: false },
		{ id: 'berto', muted: false, speaking: true },
	]);

	transport.activeSpeakers = [berto];
	panel.announceActiveSpeakers();
	assert.ok(announcements.some(a => a.key === 'game.voice_speakers' && a.vars.names === 'Berto'));

	const slider = document.querySelector<HTMLInputElement>('[data-player-id="berto"] input[type="range"]')!;
	slider.value = '35';
	slider.dispatchEvent(new window.Event('input', { bubbles: true }));
	assert.deepEqual(transport.volumeChanges.at(-1), { id: 'berto', volume: 0.35 });
	assert.match(localStorage.getItem('corro.voiceVolumes.game-1')!, /0\.35/);

	transport.removeRemote('berto');
	assert.ok(announcements.some(a => a.key === 'game.voice_left' && a.vars.player === 'Berto'));
});

test('self mute is reversible and host moderation is a one-shot request', async () => {
	mountPanel();
	openPastDisclaimer();
	(document.querySelector('#voice-controls button') as HTMLButtonElement).click();
	await settle();
	transport.addRemote({ id: 'berto', name: 'Berto', local: false, muted: false, speaking: false, volume: 1 });

	await panel.toggleSelfMute();
	await panel.toggleSelfMute();
	assert.deepEqual(transport.muteChanges, [true, false]);
	assert.ok(announcements.some(a => a.key === 'game.voice_muted_self'));
	assert.ok(announcements.some(a => a.key === 'game.voice_unmuted_self'));

	const hostMute = document.querySelector<HTMLButtonElement>('[data-player-id="berto"] .voice-participant__host-mute')!;
	hostMute.click();
	assert.equal(hostMute.getAttribute('aria-disabled'), 'true', 'the request cannot be spammed while pending');
	await settle();
	assert.deepEqual(hostMutes, ['berto']);
	assert.equal(hostMute.getAttribute('aria-disabled'), null, 'the one-shot pending guard is released');

	panel.handleHostMute({ targetPlayerId: 'me', targetPlayerName: 'Ana', hostPlayerName: 'Host' });
	assert.ok(announcements.some(a => a.key === 'game.voice_muted_by_host_self'));
	transport.participants[0] = { ...transport.participants[0], muted: true };
	transport.callbacks.onParticipantsChanged(transport.participants);
	await panel.toggleSelfMute();
	assert.equal(transport.muteChanges.at(-1), false,
		'the host mute is not sticky: the player still owns their microphone toggle');
});

test('turning voice off disconnects joined players and reports the authoritative change', async () => {
	mountPanel();
	openPastDisclaimer();
	(document.querySelector('#voice-controls button') as HTMLButtonElement).click();
	await settle();

	panel.setGameEnabled(false, true);
	await settle();
	assert.equal(panel.isConnected(), false);
	assert.equal(transport.disconnects, 1);
	assert.deepEqual(presenceUpdates.at(-1), [], 'turning voice off clears persistent player-card state');
	assert.ok(announcements.some(a => a.key === 'game.voice_disabled'));
	assert.ok(announcements.some(a => a.key === 'game.voice_left_self'));
});

test('permission failure remains visible and actionable instead of reverting to ready', async () => {
	mountPanel();
	openPastDisclaimer();
	nextConnectError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
	(document.querySelector('#voice-controls button') as HTMLButtonElement).click();
	await settle();

	assert.equal(panel.isConnected(), false);
	assert.equal(document.getElementById('voice-status')?.textContent,
		'Microphone permission was denied. Allow microphone access, then join again.');
	assert.ok(announcements.some(a => a.key === 'game.voice_permission_denied' && a.instant));
});

test('dialog semantics stay native and speaker lists form spoken-language lists', () => {
	mountPanel();
	openPastDisclaimer();
	const dialog = document.getElementById('voice-panel')!;
	assert.equal(dialog.getAttribute('role'), null);
	assert.equal(dialog.getAttribute('aria-labelledby'), 'voice-panel-title');
	assert.equal(formatVoiceSpeakerNames(['Ana', 'Berto'], 'es'), 'Ana y Berto');
	assert.equal(voiceJoinErrorKey(Object.assign(new Error(), { name: 'NotFoundError' })),
		'game.voice_microphone_missing');
});
