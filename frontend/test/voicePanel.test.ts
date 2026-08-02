import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { popupMenu } from '../src/popupMenu.js';
import {
	VoicePanel,
	formatVoiceSpeakerNames,
	voiceJoinErrorKey,
} from '../src/voicePanel.js';
import type {
	VoiceParticipant,
	VoiceDevicePreferences,
	VoiceDeviceSnapshot,
	VoiceTransport,
	VoiceTransportCallbacks,
} from '../src/voiceTransport.js';

before(() => setupDom());

let panel: VoicePanel;
let transport: FakeVoiceTransport;
let announcements: { key: string; vars: Record<string, unknown>; instant: boolean }[];
let availabilityChanges: boolean[];
let hostMutes: string[];
let presenceUpdates: { id: string; muted: boolean; speaking: boolean }[][];
let soundEvents: string[];
let host = true;
let nextConnectError: unknown = null;
let availableDeviceSnapshot: VoiceDeviceSnapshot;
let promptedOutputDevice: { deviceId: string; label: string } | null;

function fakeDeviceSnapshot(): VoiceDeviceSnapshot {
	return {
		microphones: [
			{ deviceId: 'mic-1', label: 'Desk microphone' },
			{ deviceId: 'mic-2', label: 'USB headset' },
		],
		outputs: [
			{ deviceId: 'out-1', label: 'Speakers' },
			{ deviceId: 'out-2', label: 'Headphones' },
		],
		outputSelectionSupported: true,
		outputPromptSupported: false,
	};
}

class FakeVoiceTransport implements VoiceTransport {
	participants: VoiceParticipant[] = [
		{ id: 'me', name: 'Ana', local: true, muted: false, speaking: false, volume: 1 },
	];
	activeSpeakers: VoiceParticipant[] = [];
	connectedWith: { url: string; token: string } | null = null;
	disconnects = 0;
	muteChanges: boolean[] = [];
	volumeChanges: { id: string; volume: number }[] = [];
	connectError: unknown = null;
	connectedPreferences: VoiceDevicePreferences | null = null;
	deviceSnapshot: VoiceDeviceSnapshot = fakeDeviceSnapshot();
	microphoneDeviceChanges: string[] = [];
	outputDeviceChanges: string[] = [];

	constructor(readonly callbacks: VoiceTransportCallbacks) { }

	async connect(url: string, token: string, preferences?: VoiceDevicePreferences): Promise<void> {
		// The fake rethrows whatever the test handed it, which includes non-Error rejections —
		// that is exactly the case the panel's error path has to survive.
		// eslint-disable-next-line @typescript-eslint/only-throw-error
		if (this.connectError) throw this.connectError;
		this.connectedWith = { url, token };
		this.connectedPreferences = preferences ? { ...preferences } : null;
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

	async getDeviceSnapshot(): Promise<VoiceDeviceSnapshot> { return this.deviceSnapshot; }
	async setMicrophoneDevice(deviceId: string): Promise<void> { this.microphoneDeviceChanges.push(deviceId); }
	async setOutputDevice(deviceId: string): Promise<void> { this.outputDeviceChanges.push(deviceId); }
	async requestOutputDevice() { return null; }

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
	const controlsMount = document.createElement('div');
	const panelMount = document.createElement('div');
	document.body.append(controlsMount, panelMount);
	panel.init(controlsMount, panelMount, {
		t: translate,
		gameId: 'game-1',
		getMyPlayerId: () => 'me',
		isHost: () => host,
		requestToken: async () => ({ url: 'wss://voice.test', token: 'join-token' }),
		setEnabled: async enabled => { availabilityChanges.push(enabled); },
		muteParticipant: async id => { hostMutes.push(id); },
		announce: (key, vars = {}, instant = false) => announcements.push({ key, vars, instant }),
		playSoundEvent: event => soundEvents.push(event),
		getAvailableDevices: async () => availableDeviceSnapshot,
		requestOutputDevice: async () => promptedOutputDevice,
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

function dispatchKey(target: Element, key: string, init: KeyboardEventInit = {}): Element {
	target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...init }));
	return document.activeElement as Element;
}

function openPastDisclaimer(): void {
	panel.openPanel();
	(document.getElementById('voice-disclaimer-dismiss') as HTMLButtonElement).click();
}

beforeEach(() => {
	if (popupMenu.isOpen()) popupMenu.close();
	document.body.innerHTML = '';
	localStorage.clear();
	installFakeI18next('en');
	panel = new VoicePanel();
	transport = undefined as unknown as FakeVoiceTransport;
	announcements = [];
	availabilityChanges = [];
	hostMutes = [];
	presenceUpdates = [];
	soundEvents = [];
	host = true;
	nextConnectError = null;
	availableDeviceSnapshot = fakeDeviceSnapshot();
	promptedOutputDevice = null;
});

test('host sees the deployment-gated control and can enable voice for the game', async () => {
	mountPanel({ enabled: false });
	const header = document.getElementById('voice-toggle') as HTMLButtonElement;
	assert.equal(header.hidden, false);
	assert.equal(header.getAttribute('aria-controls'), 'voice-panel');
	assert.equal(header.getAttribute('aria-keyshortcuts'), 'Control+Alt+V');
	panel.openPanel();
	assert.equal(header.getAttribute('aria-expanded'), 'true');
	assert.equal(document.activeElement, document.getElementById('voice-disclaimer-text'));
	(document.getElementById('voice-disclaimer-dismiss') as HTMLButtonElement).click();

	const enable = Array.from(document.querySelectorAll<HTMLButtonElement>('#voice-controls button'))
		.find(button => button.textContent === 'Enable voice chat')!;
	enable.click();
	await settle();
	assert.deepEqual(availabilityChanges, [true]);

	panel.setDeploymentAvailable(false);
	assert.equal(header.hidden, true, 'an unconfigured deployment exposes no dead control');
	assert.equal((document.getElementById('voice-microphone-toggle') as HTMLButtonElement).hidden, true);
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
	const selfRow = document.querySelector('.voice-participant') as HTMLElement;
	assert.equal(selfRow.tabIndex, 0, 'the roster exposes one roving tab stop');
	assert.equal(selfRow.getAttribute('aria-label'),
		'Ana (you) is in voice chat with the microphone on. Right Arrow for more actions.');
	assert.equal(selfRow.querySelector('[role="toolbar"]')?.getAttribute('aria-label'), 'Actions for Ana (you)');
	const selfMute = selfRow.querySelector('.voice-participant__self-mute') as HTMLButtonElement;
	assert.equal(selfMute.textContent, 'Mute my microphone');
	selfRow.focus();
	assert.equal(dispatchKey(selfRow, 'ArrowRight'), selfMute,
		'Right enters the local participant actions');
	assert.equal(dispatchKey(selfMute, 'Escape'), selfRow, 'Escape returns from actions to the row');
	assert.deepEqual(presenceUpdates.at(-1), [{ id: 'me', muted: false, speaking: false }],
		'the persistent player panel receives local voice presence');
	assert.ok(announcements.some(a => a.key === 'game.voice_joined_self'));
	assert.deepEqual(soundEvents, ['voice.join']);
	const persistentMicrophone = document.getElementById('voice-microphone-toggle') as HTMLButtonElement;
	assert.equal(persistentMicrophone.hidden, false);
	assert.equal(persistentMicrophone.getAttribute('aria-keyshortcuts'), 'Control+Alt+X');
	assert.equal(persistentMicrophone.getAttribute('aria-pressed'), 'true');
	assert.equal(persistentMicrophone.getAttribute('aria-label'), 'Microphone on; press to mute it.');
	assert.equal(document.querySelector('[disabled]'), null, 'controls stay focusable; disabled is forbidden');
});

// Reported live: tabbing into the roster did not reliably drop NVDA into focus mode, so it read
// the whole row — the person AND their slider and buttons. The roster is a widget you operate,
// not a passage you read, so it says so: inside role="application" a screen reader builds no
// virtual buffer and arriving at a row reads that row.
//
// A WRAPPER, deliberately. Putting the role on the <ul> would displace the list semantics, and
// the count is worth keeping — it is how you learn how many people are in the room.
test('the roster says it is a widget, without giving up being a list', async () => {
	mountPanel();
	openPastDisclaimer();
	Array.from(document.querySelectorAll<HTMLButtonElement>('#voice-controls button'))
		.find(button => button.textContent?.includes('Join with microphone'))!.click();
	await settle();

	const surface = document.getElementById('voice-participants-surface')!;
	const list = document.getElementById('voice-participants')!;

	assert.equal(surface.getAttribute('role'), 'application');
	assert.equal(list.getAttribute('role'), 'list', 'the count survives the mode change');
	assert.ok(list.closest('[role="application"]') === surface, 'the roster is inside it');

	// Named once, on the surface: a label on both would announce the roster twice on entry.
	assert.equal(surface.getAttribute('aria-label'), 'People in voice chat');
	assert.equal(list.hasAttribute('aria-label'), false);

	// Scoped to the roster alone — the panel around it stays ordinary browsable page.
	assert.equal(document.getElementById('voice-status')!.closest('[role="application"]'), null);
	assert.equal(document.getElementById('voice-controls')!.closest('[role="application"]'), null);
});

// The panel had a close button of its own, first in the tab order, for an act already available
// three other ways: Escape, Control+Alt+V, and the header button that opened it — which is where
// focus returns on close anyway. The chat panel never had one. Gone, and with it a stop every
// keyboard user passed on the way to everything else.
//
// Its one real job was being the LAST RESORT of the panel's focus chains, and there is a state
// with nothing else to focus: a guest at a table whose host has switched voice off sees a status
// line and no controls at all. The title takes that job — focusable programmatically, never a tab
// stop, so it costs nothing and keeps the reader inside the panel.
test('closing lives where it opened, and the panel is never a focus dead end', () => {
	mountPanel();
	openPastDisclaimer();
	assert.equal(document.querySelector('.voice-panel__close'), null);

	const title = document.getElementById('voice-panel-title') as HTMLElement;
	assert.equal(title.getAttribute('tabindex'), '-1', 'reachable by code, not by Tab');

	// A GUEST at a table whose host switched voice off: no controls (the switch is the host's),
	// no participants, nothing else in the panel to land on.
	host = false;
	panel.setGameEnabled(false);
	assert.equal(document.querySelectorAll('#voice-controls button').length, 0);
	assert.equal(panel.focus(), true, 'the panel still takes the keyboard');
	assert.equal(document.activeElement, title);
});

test('saved voice devices are passed to LiveKit on the next join', async () => {
	localStorage.setItem('corro.voiceDevices', JSON.stringify({
		microphoneId: 'mic-2',
		outputId: 'out-1',
	}));
	mountPanel();
	openPastDisclaimer();
	(document.querySelector('#voice-controls button') as HTMLButtonElement).click();
	await settle();

	assert.deepEqual(transport.connectedPreferences, {
		microphoneId: 'mic-2',
		outputId: 'out-1',
	});
});

test('a microphone can be chosen before joining and is applied to the first publication', async () => {
	mountPanel();
	openPastDisclaimer();
	const settings = document.getElementById('voice-device-settings') as HTMLButtonElement;
	assert.equal(settings.hidden, false);
	settings.click();
	await settle();
	const microphoneMenu = Array.from(
		document.querySelectorAll<HTMLButtonElement>('.popup-menu [role="menuitem"]'),
	)[0];
	microphoneMenu.click();
	const radios = Array.from(document.querySelectorAll<HTMLButtonElement>('.popup-menu [role="menuitemradio"]'));
	radios[2].click();
	await settle();

	const join = Array.from(document.querySelectorAll<HTMLButtonElement>('#voice-controls button'))
		.find(button => button.textContent?.includes('Join with microphone'))!;
	join.click();
	await settle();
	assert.deepEqual(transport.connectedPreferences, {
		microphoneId: 'mic-2',
		outputId: 'default',
	});
});

test('a browser-granted output chosen before joining is named and persisted', async () => {
	availableDeviceSnapshot = {
		...fakeDeviceSnapshot(),
		outputs: [],
		outputPromptSupported: true,
	};
	promptedOutputDevice = { deviceId: 'out-dock', label: 'Dock speakers' };
	mountPanel();
	openPastDisclaimer();
	const settings = document.getElementById('voice-device-settings') as HTMLButtonElement;
	settings.click();
	await settle();
	const rootItems = Array.from(document.querySelectorAll<HTMLButtonElement>('.popup-menu [role="menuitem"]'));
	rootItems[1].click();
	const choose = Array.from(document.querySelectorAll<HTMLButtonElement>('.popup-menu button'))
		.find(button => button.textContent === 'Choose another audio output…')!;
	choose.click();
	await settle();

	assert.match(localStorage.getItem('corro.voiceDevices')!, /"outputId":"out-dock"/);
	settings.click();
	await settle();
	const reopened = Array.from(document.querySelectorAll<HTMLButtonElement>('.popup-menu [role="menuitem"]'));
	assert.equal(reopened[1].textContent, 'Voice output: Dock speakers');
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
	const selfRow = document.querySelector('[data-player-id="me"]') as HTMLElement;
	const bertoRow = document.querySelector('[data-player-id="berto"]') as HTMLElement;
	assert.equal(bertoRow.classList.contains('voice-participant--speaking'), true);
	assert.equal(bertoRow.getAttribute('aria-label'),
		'Berto is in voice chat with the microphone on. Right Arrow for more actions.',
		'speaking stays visual and does not chatter in the stable row name');
	assert.equal(announcements.some(a => a.key === 'game.voice_speakers'), false,
		'active-speaker changes do not chatter at screen readers');
	assert.deepEqual(presenceUpdates.at(-1), [
		{ id: 'me', muted: false, speaking: false },
		{ id: 'berto', muted: false, speaking: true },
	]);

	transport.activeSpeakers = [berto];
	panel.announceActiveSpeakers();
	assert.ok(announcements.some(a => a.key === 'game.voice_speakers' && a.vars.names === 'Berto'));

	selfRow.focus();
	assert.equal(dispatchKey(selfRow, 'ArrowDown'), bertoRow, 'Down moves to the next person');
	assert.equal(selfRow.tabIndex, -1);
	assert.equal(bertoRow.tabIndex, 0);
	const volumeAction = bertoRow.querySelector('.voice-participant__volume-action') as HTMLButtonElement;
	const hostMute = bertoRow.querySelector('.voice-participant__host-mute') as HTMLButtonElement;
	assert.equal(dispatchKey(bertoRow, 'ArrowRight'), volumeAction, 'Right enters the first row action');
	assert.equal(dispatchKey(volumeAction, 'ArrowRight'), hostMute, 'Right moves through the toolbar actions');
	assert.equal(dispatchKey(hostMute, 'Escape'), bertoRow, 'Escape returns from the toolbar to its person');

	dispatchKey(bertoRow, 'F10', { shiftKey: true });
	const menu = document.querySelector('.voice-participant-context-menu') as HTMLElement;
	assert.ok(menu, 'Shift+F10 opens the mirrored actions menu');
	assert.equal(menu.getAttribute('aria-label'), 'Voice participant actions');
	assert.ok(document.getElementById('voice-panel')?.contains(menu),
		'the menu stays inside the active voice panel when no main landmark exists');
	assert.deepEqual(
		Array.from(menu.querySelectorAll('[role="menuitem"]')).map(item => item.textContent),
		['Volume for Berto: 100 percent.', 'Mute Berto once'],
	);
	(menu.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
	const slider = bertoRow.querySelector<HTMLInputElement>('input[type="range"]')!;
	assert.equal(document.activeElement, slider, 'the volume menu action enters the native slider');
	assert.equal(dispatchKey(slider, 'Escape'), bertoRow, 'Escape leaves slider adjustment on its row');
	slider.value = '35';
	slider.dispatchEvent(new window.Event('input', { bubbles: true }));
	assert.deepEqual(transport.volumeChanges.at(-1), { id: 'berto', volume: 0.35 });
	assert.match(localStorage.getItem('corro.voiceVolumes.game-1')!, /0\.35/);

	bertoRow.focus();
	transport.removeRemote('berto');
	assert.equal(document.activeElement, selfRow,
		'when a focused participant leaves, focus moves to the surviving row');
	assert.ok(announcements.some(a => a.key === 'game.voice_left' && a.vars.player === 'Berto'));
	assert.deepEqual(soundEvents.slice(-2), ['voice.join', 'voice.leave'],
		'remote presence uses dedicated engine voice events');
});

test('self mute is reversible and host moderation is a one-shot request', async () => {
	mountPanel();
	openPastDisclaimer();
	(document.querySelector('#voice-controls button') as HTMLButtonElement).click();
	await settle();
	transport.addRemote({ id: 'berto', name: 'Berto', local: false, muted: false, speaking: false, volume: 1 });

	await panel.toggleSelfMute();
	assert.equal(document.getElementById('voice-status')?.textContent,
		'You are in voice chat and listening, with your microphone muted.');
	const persistentMicrophone = document.getElementById('voice-microphone-toggle') as HTMLButtonElement;
	assert.equal(persistentMicrophone.getAttribute('aria-pressed'), 'false');
	assert.equal(persistentMicrophone.getAttribute('aria-label'), 'Microphone muted; press to turn it on.');
	assert.ok(persistentMicrophone.classList.contains('voice-microphone-toggle--muted'));
	const panelMicrophone = Array.from(document.querySelectorAll<HTMLButtonElement>('#voice-controls button'))
		.find(button => button.textContent === 'Turn my microphone on')!;
	assert.equal(panelMicrophone.getAttribute('aria-keyshortcuts'), 'Control+Alt+X');
	await panel.toggleSelfMute();
	assert.equal(document.getElementById('voice-status')?.textContent,
		'You are in voice chat, listening with your microphone on.');
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
	assert.equal(document.getElementById('voice-status')?.textContent,
		'You are in voice chat and listening, with your microphone muted.',
		'external LiveKit mute state updates the panel status');
	await panel.toggleSelfMute();
	assert.equal(transport.muteChanges.at(-1), false,
		'the host mute is not sticky: the player still owns their microphone toggle');
});

test('device settings use radio submenus, switch devices and persist the choices', async () => {
	mountPanel();
	openPastDisclaimer();
	(document.querySelector('#voice-controls button') as HTMLButtonElement).click();
	await settle();

	assert.deepEqual(transport.connectedPreferences, { microphoneId: 'default', outputId: 'default' });
	const settings = document.getElementById('voice-device-settings') as HTMLButtonElement;
	assert.equal(settings.hidden, false);
	assert.equal(settings.getAttribute('aria-haspopup'), 'menu');
	settings.click();
	await settle();

	let rootItems = Array.from(document.querySelectorAll<HTMLElement>('.popup-menu [role="menuitem"]'));
	assert.deepEqual(rootItems.map(item => item.textContent), [
		'Microphone: System default',
		'Voice output: System default',
	]);
	rootItems[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	let radios = Array.from(document.querySelectorAll<HTMLElement>('.popup-menu [role="menuitemradio"]'));
	assert.deepEqual(radios.map(item => item.getAttribute('aria-checked')), ['true', 'false', 'false']);
	assert.deepEqual(radios.map(item => item.textContent), ['System default', 'Desk microphone', 'USB headset']);
	(radios[2] as HTMLButtonElement).click();
	await settle();
	assert.deepEqual(transport.microphoneDeviceChanges, ['mic-2']);
	assert.match(localStorage.getItem('corro.voiceDevices')!, /"microphoneId":"mic-2"/);
	assert.ok(announcements.some(a => a.key === 'game.voice_microphone_selected' && a.vars.device === 'USB headset'));

	settings.click();
	await settle();
	rootItems = Array.from(document.querySelectorAll<HTMLElement>('.popup-menu [role="menuitem"]'));
	assert.equal(rootItems[0].textContent, 'Microphone: USB headset');
	(rootItems[1] as HTMLButtonElement).click();
	radios = Array.from(document.querySelectorAll<HTMLElement>('.popup-menu [role="menuitemradio"]'));
	assert.deepEqual(radios.map(item => item.textContent), ['System default', 'Speakers', 'Headphones']);
	(radios[1] as HTMLButtonElement).click();
	await settle();
	assert.deepEqual(transport.outputDeviceChanges, ['out-1']);
	assert.match(localStorage.getItem('corro.voiceDevices')!, /"outputId":"out-1"/);
});

test('unsupported output selection stays focusable and explains the system fallback', async () => {
	mountPanel();
	openPastDisclaimer();
	(document.querySelector('#voice-controls button') as HTMLButtonElement).click();
	await settle();
	transport.deviceSnapshot = {
		...transport.deviceSnapshot,
		outputs: [],
		outputSelectionSupported: false,
	};

	(document.getElementById('voice-device-settings') as HTMLButtonElement).click();
	await settle();
	const output = Array.from(document.querySelectorAll<HTMLElement>('.popup-menu [role="menuitem"]'))[1];
	assert.equal(output.getAttribute('aria-disabled'), 'true');
	assert.equal(output.hasAttribute('disabled'), false);
	const hint = document.getElementById(output.getAttribute('aria-describedby')!);
	assert.equal(hint?.textContent, 'This browser uses the audio output selected by the operating system.');
	(output as HTMLButtonElement).click();
	assert.ok(announcements.some(a => a.key === '_raw'
		&& a.vars.text === 'This browser uses the audio output selected by the operating system.'));
});

test('removing the selected microphone closes the menu and falls back to system default', async () => {
	localStorage.setItem('corro.voiceDevices', JSON.stringify({
		microphoneId: 'mic-2',
		outputId: 'default',
	}));
	mountPanel();
	openPastDisclaimer();
	(document.querySelector('#voice-controls button') as HTMLButtonElement).click();
	await settle();
	const settings = document.getElementById('voice-device-settings') as HTMLButtonElement;
	settings.click();
	await settle();
	assert.equal(popupMenu.isOpen(), true);

	transport.deviceSnapshot = {
		...transport.deviceSnapshot,
		microphones: [{ deviceId: 'mic-1', label: 'Desk microphone' }],
	};
	transport.callbacks.onDevicesChanged();
	await settle();

	assert.equal(popupMenu.isOpen(), false);
	assert.match(localStorage.getItem('corro.voiceDevices')!, /"microphoneId":"default"/);
	assert.deepEqual(transport.microphoneDeviceChanges, ['default']);
	assert.ok(announcements.some(a => a.key === 'game.voice_microphone_fallback'));
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
	assert.equal((document.getElementById('voice-microphone-toggle') as HTMLButtonElement).hidden, true);
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

test('voice controls are an integrated disclosure and speaker lists form spoken-language lists', () => {
	mountPanel();
	openPastDisclaimer();
	const disclosure = document.getElementById('voice-panel')!;
	assert.equal(disclosure.tagName, 'DIV');
	assert.equal(disclosure.getAttribute('role'), null);
	assert.equal(disclosure.getAttribute('aria-labelledby'), 'voice-panel-title');
	panel.closePanel();
	assert.equal(disclosure.hasAttribute('hidden'), true);
	assert.equal(document.getElementById('voice-toggle')?.getAttribute('aria-expanded'), 'false');
	assert.equal(formatVoiceSpeakerNames(['Ana', 'Berto'], 'es'), 'Ana y Berto');
	assert.equal(voiceJoinErrorKey(Object.assign(new Error(), { name: 'NotFoundError' })),
		'game.voice_microphone_missing');
});
