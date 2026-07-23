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

test('voice chat: host enables it, players join unmuted, query speakers, adjust volume and moderate once', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	// The deployment capability makes the create-time host choice visible and operable.
	await gotoLobbyHome(ana);
	await ana.click('#go-create-btn');
	await expect(ana.locator('#voice-chat-group')).toBeVisible();
	await expect(ana.locator('#voice-chat-enabled')).not.toBeChecked();
	await ana.locator('#voice-chat-enabled').check();
	await flushAxeAudit(ana);

	// This game starts with voice off so the in-game host activation path is covered too.
	const code = await createGame(ana, 'Ana', 'galactic-empire');
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	await expect(ana.locator('#voice-toggle')).toBeVisible();
	await expect(ana.locator('#voice-toggle')).toHaveAttribute('aria-pressed', 'false');

	// The global shortcut opens the native non-modal dialog. First contact lands on the
	// relay/privacy notice; audit that transient state before dismissing it.
	await ana.keyboard.press('Control+Alt+V');
	await expect(ana.locator('#voice-panel')).toBeVisible();
	await expect(ana.locator('#voice-disclaimer-text')).toBeFocused();
	await flushAxeAudit(ana);
	await ana.locator('#voice-disclaimer-dismiss').click();
	await expect(ana.locator('#voice-status')).toHaveText(es.voice_off);
	await flushAxeAudit(ana);

	// Only the host sees availability control. SignalR broadcasts the authoritative switch
	// to both clients and each hears it through the normal announcer.
	await ana.getByRole('button', { name: es.voice_enable }).click();
	await expect(ana.locator('#voice-status')).toHaveText(es.voice_ready);
	await expect(berto.locator('#voice-toggle')).toHaveClass(/voice-toggle--enabled/);
	await expectAnnouncement(berto, exact(es.voice_enabled));
	await flushAxeAudit(ana);

	// Both players explicitly opt in. The deterministic transport records the real token URL
	// and creates an unmuted local participant row.
	await ana.getByRole('button', { name: es.voice_join }).click();
	await expect(ana.locator('#voice-toggle')).toHaveAttribute('aria-pressed', 'true');
	await expect(ana.locator('.voice-participant').first()).toContainText('Ana');
	await expect(ana.locator('.voice-participant').first()).toContainText(es.voice_listening_visual);
	await expect(ana.locator('.voice-participant').first().locator('.voice-participant__volume')).toBeHidden();
	await expect(ana.locator('.player-card.is-me .player-tag--voice')).toHaveText(es.voice_in_chat_visual);
	await expectAnnouncement(ana, exact(es.voice_joined_self));
	await flushAxeAudit(ana);

	await berto.keyboard.press('Control+Alt+V');
	await berto.locator('#voice-disclaimer-dismiss').click();
	await berto.getByRole('button', { name: es.voice_join }).click();
	await expect(berto.locator('#voice-toggle')).toHaveAttribute('aria-pressed', 'true');
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

	// Speaking is visual continuously. The focused volume slider can invoke the global
	// on-demand query; only that keypress sends the speaker name to a screen reader.
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
	await expect(bertoPlayerCard).toHaveClass(/is-voice-speaking/);
	await expect(bertoPlayerCard.locator('.player-tag--voice')).toHaveText(es.voice_speaking_visual);
	await flushAxeAudit(ana);
	await ana.keyboard.press('Control+Alt+V');
	const volume = bertoRow.locator('input[type="range"]');
	await volume.focus();
	await ana.keyboard.press('Control+Alt+A');
	await expectAnnouncement(ana, exact(interpolate(es.voice_speakers, { names: 'Berto' })));
	await volume.fill('35');
	await expect(volume).toHaveValue('35');

	// Moderation is a server-authorized one-shot mute, not a sticky permission. The target
	// hears who acted, then LiveKit's simulated TrackMuted state still permits self-unmute.
	await berto.evaluate(() => (window as any).__voiceTest.setLocalMuted(false));
	await bertoRow.getByRole('button', { name: interpolate(es.voice_host_mute, { player: 'Berto' }) }).click();
	await expectAnnouncement(berto, exact(interpolate(es.voice_muted_by_host_self, { host: 'Ana', player: 'Berto' })));
	await Promise.all([
		ana.evaluate(({ id }) => (window as any).__voiceTest.setMuted(id, true), { id: bertoId }),
		berto.evaluate(() => (window as any).__voiceTest.setLocalMuted(true)),
	]);
	await expect(berto.locator('.voice-participant').first()).toHaveClass(/voice-participant--muted/);
	await expect(bertoRow).not.toHaveClass(/voice-participant--speaking/);
	await expect(bertoRow).toContainText(es.voice_muted_visual);
	await expect(bertoPlayerCard).not.toHaveClass(/is-voice-speaking/);
	await expect(bertoPlayerCard.locator('.player-tag--voice')).toHaveText(es.voice_muted_visual);
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);
	await berto.getByRole('button', { name: es.voice_unmute }).click();
	await expect(berto.locator('.voice-participant').first()).not.toHaveClass(/voice-participant--muted/);

	// Turning voice off is authoritative: both transports disconnect, panels remain operable,
	// and both the host change and each player's departure are spoken.
	await ana.getByRole('button', { name: es.voice_disable }).click();
	await expect(ana.locator('#voice-status')).toHaveText(es.voice_off);
	await expect(berto.locator('#voice-status')).toHaveText(es.voice_off);
	await expect(ana.locator('#voice-toggle')).toHaveAttribute('aria-pressed', 'false');
	await expect(berto.locator('#voice-toggle')).toHaveAttribute('aria-pressed', 'false');
	await expect(ana.locator('.player-tag--voice')).toHaveCount(0);
	await expect(berto.locator('.player-tag--voice')).toHaveCount(0);
	await expectAnnouncement(berto, exact(es.voice_disabled));
	await expectAnnouncement(berto, exact(es.voice_left_self));
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);
});
