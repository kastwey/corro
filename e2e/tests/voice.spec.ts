// voice.spec.ts — opt-in LiveKit voice controls over the real game/SignalR flow.
//
// Media is replaced by the deterministic E2E transport installed by newPlayerPage; all
// authorization, state persistence, host moderation, keyboard routing, accessible UI and
// Axe audits remain the production paths.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	appI18n,
	createGame,
	expectAnnouncement,
	gotoLobbyHome,
	joinGame,
	newPlayerPage,
	resetDice,
	startGame,
} from '../helpers/game';

const es = appI18n('es').game as Record<string, string>;

function interpolate(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => vars[key] ?? `{{${key}}}`);
}

function exact(text: string): RegExp {
	return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test.beforeEach(async () => {
	await resetDice();
});

test('voice chat: every game offers it, the host closes and reopens it, players join unmuted, query speakers, adjust volume and moderate once', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	// Voice belongs to the DEPLOYMENT, not to a decision made before anyone knows they will want
	// to talk: creating a game asks nothing about it, and every game the relay can serve offers
	// the room from the start.
	await gotoLobbyHome(ana);
	await ana.click('#go-create-btn');
	await expect(ana.locator('#voice-chat-group')).toHaveCount(0);
	await flushAxeAudit(ana);

	const code = await createGame(ana, 'Ana', 'galactic-empire');
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Plain F6 belongs to browser chrome, where it can reach a microphone permission prompt.
	// Corro cycles its regions only with Ctrl+F6; verify the real global route from the board.
	const board = ana.locator('#board');
	await board.focus();
	const plainF6Consumed = await board.evaluate(element => {
		const event = new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true });
		element.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(plainF6Consumed).toBe(false);
	await ana.keyboard.press('Control+F6');
	await expect(ana.locator('#action-bar .action-bar-button').first()).toBeFocused();

	await expect(ana.locator('#voice-toggle')).toBeVisible();
	expect(await ana.locator('#voice-toggle').getAttribute('aria-pressed')).toBeNull();
	await expect(ana.locator('#voice-toggle')).toHaveAttribute('aria-expanded', 'false');
	await expect(ana.locator('#voice-toggle')).toHaveAttribute('aria-controls', 'voice-panel');
	await expect(ana.locator('#voice-toggle')).toHaveAttribute('aria-keyshortcuts', 'Control+Alt+V');
	await expect(ana.locator('#voice-panel')).toHaveCount(1);
	await expect(ana.locator('main #voice-panel')).toHaveCount(1);
	await expect(ana.locator('dialog#voice-panel')).toHaveCount(0);

	// The global shortcut expands the in-page controls. First contact lands on the
	// relay/privacy notice; audit that transient state before dismissing it.
	await ana.keyboard.press('Control+Alt+V');
	await expect(ana.locator('#voice-panel')).toBeVisible();
	await expect(ana.locator('#voice-toggle')).toHaveAttribute('aria-expanded', 'true');
	await expect(ana.locator('#voice-disclaimer-text')).toBeFocused();
	await flushAxeAudit(ana);
	await ana.locator('#voice-disclaimer-dismiss').click();
	await expect(ana.locator('#voice-status')).toHaveText(es.voice_ready);
	await flushAxeAudit(ana);

	// Only the host holds the switch, and it is authoritative for the table in both directions:
	// a room nobody is using can be closed, and — the case that matters — a table that decides
	// mid-game that it wants to talk can have it opened again. Each client hears the change
	// through the normal announcer.
	await ana.getByRole('button', { name: es.voice_disable, exact: true }).click();
	await expect(ana.locator('#voice-status')).toHaveText(es.voice_off);
	await expectAnnouncement(berto, exact(es.voice_disabled));
	await flushAxeAudit(ana);
	await ana.getByRole('button', { name: es.voice_enable, exact: true }).click();
	await expect(ana.locator('#voice-status')).toHaveText(es.voice_ready);
	await expect(berto.locator('#voice-toggle')).toHaveClass(/voice-toggle--enabled/);
	await expectAnnouncement(berto, exact(es.voice_enabled));
	await flushAxeAudit(ana);

	// Choose the first microphone before joining: the preference must reach LiveKit before
	// the unmuted microphone is published, avoiding a brief leak from the wrong input.
	const deviceSettings = ana.getByRole('button', { name: es.voice_devices_button });
	await deviceSettings.click();
	let deviceMenu = ana.locator('.popup-menu');
	await expect(deviceMenu).toHaveAttribute('aria-label', es.voice_devices_menu);
	await expect(deviceMenu.getByRole('menuitem')).toHaveCount(2);
	await flushAxeAudit(ana);
	await ana.keyboard.press('ArrowRight');
	let deviceRadios = deviceMenu.getByRole('menuitemradio');
	await expect(deviceMenu).toHaveAttribute('aria-label', es.voice_microphone_group);
	await expect(deviceRadios).toHaveCount(3);
	await flushAxeAudit(ana);
	await deviceRadios.nth(1).click();
	await expect.poll(() => ana.evaluate(() => JSON.parse(localStorage.getItem('corro.voiceDevices') ?? '{}')))
		.toEqual({ microphoneId: 'mic-built-in', outputId: 'default' });

	// Both players explicitly opt in. The deterministic transport records the real token URL
	// and creates an unmuted local participant row.
	await ana.getByRole('button', { name: es.voice_join }).click();
	await expect(ana.locator('#voice-toggle')).toHaveClass(/voice-toggle--connected/);
	const anaVoiceRow = ana.locator('.voice-participant').first();
	await expect(anaVoiceRow).toContainText('Ana');
	await expect(anaVoiceRow).toContainText(es.voice_listening_visual);
	await expect(anaVoiceRow.locator('.voice-participant__volume')).toBeHidden();
	await expect(anaVoiceRow).toHaveAttribute('tabindex', '0');
	await expect(anaVoiceRow).toHaveAttribute('aria-label', interpolate(
		es.voice_participant_label_listening,
		{ player: interpolate(es.voice_participant_self, { player: 'Ana' }) },
	));
	await expect(anaVoiceRow.getByRole('toolbar')).toHaveAttribute('aria-label', interpolate(
		es.actions_for,
		{ name: interpolate(es.voice_participant_self, { player: 'Ana' }) },
	));
	await expect(ana.locator('.player-card.is-me .player-tag--voice')).toHaveText(es.voice_in_chat_visual);
	const anaMicrophone = ana.locator('#voice-microphone-toggle');
	await expect(anaMicrophone).toBeVisible();
	await expect(anaMicrophone).toHaveAttribute('aria-keyshortcuts', 'Control+Alt+X');
	await expect(anaMicrophone).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => ana.evaluate(() => (window as any).__voiceTest.connectedPreferences))
		.toEqual({ microphoneId: 'mic-built-in', outputId: 'default' });
	await expectAnnouncement(ana, exact(es.voice_joined_self));
	await flushAxeAudit(ana);

	// Device settings reuse Corro's ARIA menu convention: two sibling submenus whose
	// mutually exclusive choices are menuitemradio options.
	await deviceSettings.click();
	deviceMenu = ana.locator('.popup-menu');
	await expect(deviceMenu).toHaveAttribute('role', 'menu');
	await expect(deviceMenu.getByRole('menuitem')).toHaveCount(2);
	await expect(deviceMenu.getByRole('menuitem').first()).toHaveText(
		interpolate(es.voice_microphone_menu, { device: 'Built-in microphone' }),
	);
	await flushAxeAudit(ana);
	await ana.keyboard.press('ArrowRight');
	await expect(deviceMenu).toHaveAttribute('aria-label', es.voice_microphone_group);
	deviceRadios = deviceMenu.getByRole('menuitemradio');
	await expect(deviceRadios).toHaveCount(3);
	await expect(deviceRadios.nth(1)).toHaveAttribute('aria-checked', 'true');
	await expect(deviceRadios.nth(2)).toHaveText('USB headset');
	await flushAxeAudit(ana);
	await deviceRadios.nth(2).click();
	await expect.poll(() => ana.evaluate(() => (window as any).__voiceTest.microphoneChanges)).toEqual(['mic-usb']);
	await expectAnnouncement(ana, exact(interpolate(es.voice_microphone_selected, { device: 'USB headset' })));

	await deviceSettings.click();
	deviceMenu = ana.locator('.popup-menu');
	await expect(deviceMenu.getByRole('menuitem').first()).toHaveText(
		interpolate(es.voice_microphone_menu, { device: 'USB headset' }),
	);
	await ana.keyboard.press('ArrowDown');
	await ana.keyboard.press('ArrowRight');
	await expect(deviceMenu).toHaveAttribute('aria-label', es.voice_output_group);
	deviceRadios = deviceMenu.getByRole('menuitemradio');
	await expect(deviceRadios).toHaveCount(3);
	await expect(deviceRadios.first()).toHaveAttribute('aria-checked', 'true');
	await flushAxeAudit(ana);
	await deviceRadios.nth(1).click();
	await expect.poll(() => ana.evaluate(() => (window as any).__voiceTest.outputChanges)).toEqual(['out-speakers']);
	await expectAnnouncement(ana, exact(interpolate(es.voice_output_selected, { device: 'Speakers' })));
	await expect.poll(() => ana.evaluate(() => JSON.parse(localStorage.getItem('corro.voiceDevices') ?? '{}')))
		.toEqual({ microphoneId: 'mic-usb', outputId: 'out-speakers' });

	// Browsers without selectable sinks expose an operable explanation instead of a dead
	// submenu. Audit this separate settled menu state explicitly.
	await ana.evaluate(() => (window as any).__voiceTest.setOutputSelectionSupported(false));
	await deviceSettings.click();
	deviceMenu = ana.locator('.popup-menu');
	const systemOutput = deviceMenu.getByRole('menuitem', { name: es.voice_output_system });
	await expect(systemOutput).toHaveAttribute('aria-disabled', 'true');
	const outputHintId = await systemOutput.getAttribute('aria-describedby');
	expect(outputHintId).toBeTruthy();
	await expect(ana.locator(`#${outputHintId}`)).toHaveText(es.voice_output_unsupported);
	await flushAxeAudit(ana);
	await ana.keyboard.press('ArrowDown');
	await expect(systemOutput).toBeFocused();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, exact(es.voice_output_unsupported));
	await ana.keyboard.press('Escape');
	await expect(deviceMenu).toBeHidden();
	await ana.evaluate(() => (window as any).__voiceTest.setOutputSelectionSupported(true));

	// Chromium variants with selectAudioOutput expose one additional command after the
	// radio choices. Reach, audit and invoke that settled submenu state as well.
	await ana.evaluate(() => (window as any).__voiceTest.setOutputPromptSupported(true));
	await deviceSettings.click();
	deviceMenu = ana.locator('.popup-menu');
	await ana.keyboard.press('ArrowDown');
	await ana.keyboard.press('ArrowRight');
	await expect(deviceMenu).toHaveAttribute('aria-label', es.voice_output_group);
	const chooseOutput = deviceMenu.getByRole('menuitem', { name: es.voice_choose_output });
	await expect(chooseOutput).toBeVisible();
	await flushAxeAudit(ana);
	await chooseOutput.click();
	await expectAnnouncement(ana, exact(interpolate(es.voice_output_selected, { device: 'Dock speakers' })));
	await expect.poll(() => ana.evaluate(() => (window as any).__voiceTest.outputChanges))
		.toEqual(['out-speakers', 'out-dock']);
	await expect.poll(() => ana.evaluate(() => JSON.parse(localStorage.getItem('corro.voiceDevices') ?? '{}')))
		.toEqual({ microphoneId: 'mic-usb', outputId: 'out-dock' });

	// The global microphone shortcut works with the controls collapsed. Reopening derives
	// its status from LiveKit's actual local participant, never stale "microphone on" copy.
	await ana.keyboard.press('Control+Alt+V');
	await expect(ana.locator('#voice-panel')).toBeHidden();
	await ana.keyboard.press('Control+Alt+X');
	await expect(anaMicrophone).toHaveAttribute('aria-pressed', 'false');
	await expect(anaMicrophone).toHaveAttribute('aria-label', es.voice_microphone_button_muted);
	await ana.keyboard.press('Control+Alt+V');
	await expect(ana.locator('#voice-status')).toHaveText(es.voice_connected_muted);
	await ana.setViewportSize({ width: 390, height: 844 });
	await expect(ana.locator('#voice-toggle')).toBeInViewport();
	await expect(anaMicrophone).toBeInViewport();
	await expect(ana.locator('#voice-panel')).toBeInViewport();
	await flushAxeAudit(ana);
	await ana.setViewportSize({ width: 1280, height: 720 });
	await anaMicrophone.click();
	await expect(anaMicrophone).toHaveAttribute('aria-pressed', 'true');
	await expect(ana.locator('#voice-status')).toHaveText(es.voice_connected);
	await flushAxeAudit(ana);

	await berto.keyboard.press('Control+Alt+V');
	await berto.locator('#voice-disclaimer-dismiss').click();
	await berto.getByRole('button', { name: es.voice_join }).click();
	await expect(berto.locator('#voice-toggle')).toHaveClass(/voice-toggle--connected/);
	await expect(berto.locator('.voice-participant').first()).toContainText('Berto');
	await expect(berto.locator('.player-card.is-me .player-tag--voice')).toHaveText(es.voice_in_chat_visual);
	await flushAxeAudit(berto);

	const bertoId = await berto.evaluate(() => {
		const games = JSON.parse(localStorage.getItem('corro_games') ?? '[]');
		return games[0].playerId as string;
	});
	await ana.evaluate(({ id }) => (window as any).__voiceTest.addRemote(id, 'Berto'), { id: bertoId });
	const bertoRow = ana.locator(`.voice-participant[data-player-id="${bertoId}"]`);
	const bertoPlayerCard = ana.locator(`.player-card[data-player-id="${bertoId}"]`);
	await expect(bertoRow).toContainText('Berto');
	await expect(bertoPlayerCard.locator('.player-tag--voice')).toHaveText(es.voice_in_chat_visual);
	await expectAnnouncement(ana, exact(interpolate(es.voice_joined, { player: 'Berto' })));

	// Speaking is visual continuously. The roster itself is a roving accessible list:
	// arrows move between people, Right enters their visible actions, and Shift+F10
	// exposes those same actions without adding tab stops.
	await ana.evaluate(({ id }) => (window as any).__voiceTest.setSpeaking(id, true), { id: bertoId });
	await expect(bertoRow).toHaveClass(/voice-participant--speaking/);
	await expect(bertoRow).toContainText(es.voice_speaking_visual);
	await expect(bertoPlayerCard).toHaveClass(/is-voice-speaking/);
	await expect(bertoPlayerCard.locator('.player-tag--voice')).toHaveText(es.voice_speaking_visual);
	await flushAxeAudit(ana);
	// Presence belongs to the game surface, not to the settings dialog: closing the latter
	// leaves the active speaker visible beside that player's normal game state.
	await ana.getByRole('button', { name: es.voice_close }).click();
	await expect(ana.locator('#voice-panel')).toBeHidden();
	await expect(ana.locator('#voice-toggle')).toHaveAttribute('aria-expanded', 'false');
	await expect(bertoPlayerCard).toHaveClass(/is-voice-speaking/);
	await expect(bertoPlayerCard.locator('.player-tag--voice')).toHaveText(es.voice_speaking_visual);
	await flushAxeAudit(ana);
	await ana.keyboard.press('Control+Alt+V');
	await anaVoiceRow.focus();
	await ana.keyboard.press('ArrowDown');
	await expect(bertoRow).toBeFocused();
	await expect(anaVoiceRow).toHaveAttribute('tabindex', '-1');
	await expect(bertoRow).toHaveAttribute('tabindex', '0');
	await ana.keyboard.press('ArrowRight');
	const volumeAction = bertoRow.locator('.voice-participant__volume-action');
	await expect(volumeAction).toBeFocused();
	await ana.keyboard.press('ArrowRight');
	const hostMuteAction = bertoRow.getByRole('button', {
		name: interpolate(es.voice_host_mute, { player: 'Berto' }),
	});
	await expect(hostMuteAction).toBeFocused();
	await ana.keyboard.press('Escape');
	await expect(bertoRow).toBeFocused();
	await ana.keyboard.press('Shift+F10');
	const participantMenu = ana.locator('.voice-participant-context-menu');
	await expect(participantMenu).toHaveAttribute('role', 'menu');
	await expect(ana.locator('main > .voice-participant-context-menu')).toHaveCount(1);
	await expect(participantMenu.getByRole('menuitem')).toHaveText([
		interpolate(es.voice_volume, { player: 'Berto', volume: '100' }),
		interpolate(es.voice_host_mute, { player: 'Berto' }),
	]);
	await flushAxeAudit(ana);
	await ana.locator('#theme-toggle').click();
	await expect(ana.locator('html')).toHaveAttribute('data-theme', 'dark');
	await flushAxeAudit(ana);
	await ana.locator('#theme-toggle').click();
	await expect(ana.locator('html')).toHaveAttribute('data-theme', 'light');
	await flushAxeAudit(ana);

	// Choosing the volume action enters the existing native range. Its own arrows remain
	// native; Escape returns to the owning person, and global read-only shortcuts still work.
	await participantMenu.getByRole('menuitem').first().click();
	const volume = bertoRow.locator('input[type="range"]');
	await expect(volume).toBeFocused();
	await ana.keyboard.press('Control+Alt+A');
	await expectAnnouncement(ana, exact(interpolate(es.voice_speakers, { names: 'Berto' })));
	await volume.fill('35');
	await expect(volume).toHaveValue('35');
	await ana.keyboard.press('Escape');
	await expect(bertoRow).toBeFocused();
	// The modified panel cycle is global from a focused voice control and wraps back to board.
	await volume.focus();
	await ana.keyboard.press('Control+F6');
	await expect(board).toBeFocused();

	// Moderation is a server-authorized one-shot mute, not a sticky permission. The target
	// hears who acted, then LiveKit's simulated TrackMuted state still permits self-unmute.
	await berto.evaluate(() => (window as any).__voiceTest.setLocalMuted(false));
	await bertoRow.focus();
	await ana.keyboard.press('Shift+F10');
	await ana.locator('.voice-participant-context-menu').getByRole('menuitem', {
		name: interpolate(es.voice_host_mute, { player: 'Berto' }),
	}).click();
	await expectAnnouncement(berto, exact(interpolate(es.voice_muted_by_host_self, { host: 'Ana', player: 'Berto' })));
	await Promise.all([
		ana.evaluate(({ id }) => (window as any).__voiceTest.setMuted(id, true), { id: bertoId }),
		berto.evaluate(() => (window as any).__voiceTest.setLocalMuted(true)),
	]);
	await expect(berto.locator('.voice-participant').first()).toHaveClass(/voice-participant--muted/);
	await expect(bertoRow).not.toHaveClass(/voice-participant--speaking/);
	await expect(bertoRow).toContainText(es.voice_muted_visual);
	await expect(bertoRow).toHaveAttribute('aria-label', interpolate(
		es.voice_participant_label_muted,
		{ player: 'Berto' },
	));
	await expect(bertoPlayerCard).not.toHaveClass(/is-voice-speaking/);
	await expect(bertoPlayerCard.locator('.player-tag--voice')).toHaveText(es.voice_muted_visual);
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);
	const bertoSelfRow = berto.locator('.voice-participant').first();
	const selfUnmute = bertoSelfRow.getByRole('button', { name: es.voice_unmute });
	await expect(selfUnmute).toBeVisible();
	await bertoSelfRow.focus();
	await expect(bertoSelfRow).toBeFocused();
	await berto.keyboard.press('ArrowRight');
	await expect(selfUnmute).toBeFocused();
	await selfUnmute.click();
	await expect(bertoSelfRow).not.toHaveClass(/voice-participant--muted/);

	// Turning voice off is authoritative: both transports disconnect, panels remain operable,
	// and both the host change and each player's departure are spoken.
	await ana.getByRole('button', { name: es.voice_disable }).click();
	await expect(ana.locator('#voice-status')).toHaveText(es.voice_off);
	await expect(berto.locator('#voice-status')).toHaveText(es.voice_off);
	await expect(ana.locator('#voice-toggle')).not.toHaveClass(/voice-toggle--connected/);
	await expect(berto.locator('#voice-toggle')).not.toHaveClass(/voice-toggle--connected/);
	await expect(ana.locator('#voice-microphone-toggle')).toBeHidden();
	await expect(berto.locator('#voice-microphone-toggle')).toBeHidden();
	await expect(ana.locator('.player-tag--voice')).toHaveCount(0);
	await expect(berto.locator('.player-tag--voice')).toHaveCount(0);
	await expectAnnouncement(berto, exact(es.voice_disabled));
	await expectAnnouncement(berto, exact(es.voice_left_self));
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);
});
