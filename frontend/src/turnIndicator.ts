// turnIndicator.ts - Visual turn indicator for the board

import { tSync } from './i18nBinder.js';
import { tokenIconHtml } from './tokenIcons.js';
import { escapeHtml } from './escapeHtml.js';
import { contrastingTextColor } from './colorContrast.js';
import type { Player } from './models.js';

const t = (key: string, vars?: Record<string, any>) => tSync(`game.${key}`, vars);

interface TurnIndicatorState {
	currentPlayer: Player | null;
	isMyTurn: boolean;
	debtorPlayer: Player | null;  // Player currently resolving debts
	debtAmount: number;
}

class TurnIndicator {
	private container: HTMLElement | null = null;
	private state: TurnIndicatorState = {
		currentPlayer: null,
		isMyTurn: false,
		debtorPlayer: null,
		debtAmount: 0
	};

	/**
	 * Initialize the turn indicator in the DOM
	 */
	init(): void {
		if (this.container) return;

		this.container = document.createElement('div');
		this.container.id = 'turn-indicator';
		this.container.className = 'turn-indicator';
		// Visual-only: the announcer owns turn announcements so the screen reader
		// is not spammed with "Current turn: X" on every state update.
		this.container.setAttribute('aria-hidden', 'true');

		// Insert directly above the board grid (inside its frame).
		const board = document.getElementById('board');
		if (board && board.parentElement) {
			board.parentElement.insertBefore(this.container, board);
		} else {
			document.body.prepend(this.container);
		}

		this.render();
	}

	/**
	 * Update the current turn
	 */
	setCurrentTurn(player: Player | null, isMyTurn: boolean): void {
		this.state.currentPlayer = player;
		this.state.isMyTurn = isMyTurn;
		this.render();
	}

	/**
	 * Set when a player is resolving debts
	 */
	setDebtorPlayer(player: Player | null, totalDebt: number = 0): void {
		this.state.debtorPlayer = player;
		this.state.debtAmount = totalDebt;
		this.render();
	}

	/**
	 * Clear debtor state
	 */
	clearDebtor(): void {
		this.state.debtorPlayer = null;
		this.state.debtAmount = 0;
		this.render();
	}

	/**
	 * Get the current state for announcements
	 */
	getAnnouncementText(): string {
		const { currentPlayer, debtorPlayer } = this.state;

		if (!currentPlayer) {
			return tSync('game.announce_no_turn_set');
		}

		if (debtorPlayer) {
			return t('turn_with_debt', {
				currentPlayer: currentPlayer.name,
				debtPlayer: debtorPlayer.name
			});
		}

		return t('turn_of', { player: currentPlayer.name });
	}

	private render(): void {
		if (!this.container) return;

		const { currentPlayer, isMyTurn, debtorPlayer } = this.state;

		if (!currentPlayer) {
			this.container.innerHTML = '';
			this.container.classList.remove('turn-indicator--visible');
			return;
		}

		const tokenIcon = tokenIconHtml(currentPlayer.token);
		// Player data comes from the server and may originate in an uploaded package. Keep the
		// custom property to a single CSS colour token so it cannot break out of the style attribute.
		const playerColor = currentPlayer.color
			&& (/^#[0-9a-f]{3}$/i.test(currentPlayer.color) || /^#[0-9a-f]{6}$/i.test(currentPlayer.color))
			? currentPlayer.color
			: '#888';
		const playerForeground = contrastingTextColor(playerColor);

		let statusClass = 'turn-indicator--other';
		let extraInfo = '';

		if (isMyTurn) {
			statusClass = 'turn-indicator--my-turn';
		}

		if (debtorPlayer) {
			statusClass = 'turn-indicator--waiting';
			extraInfo = `
				<div class="turn-indicator__debt-status">
					<span class="turn-indicator__debt-text">
						${escapeHtml(t('debt_waiting_message', { player: debtorPlayer.name }))}
					</span>
				</div>
			`;
		}

		// Flag a current player with no live connection: the table is effectively paused
		// waiting for them, so the indicator says WHY nothing is happening.
		const offlineTag = currentPlayer.isConnected === false
			? `<span class="turn-indicator__offline">${escapeHtml(t('disconnected_tag'))}</span>`
			: '';

		this.container.className = `turn-indicator turn-indicator--visible ${statusClass}`;
		this.container.innerHTML = `
			<div class="turn-indicator__main">
				<span class="turn-indicator__label">${escapeHtml(t('current_turn_label'))}:</span>
				<span class="turn-indicator__player" style="--player-color: ${playerColor}; --player-foreground: ${playerForeground}">
					<span class="turn-indicator__token">${tokenIcon}</span>
					<span class="turn-indicator__name">${escapeHtml(currentPlayer.name)}</span>
				</span>
				${isMyTurn ? `<span class="turn-indicator__you">${escapeHtml(t('your_turn'))}</span>` : ''}
				${offlineTag}
			</div>
			${extraInfo}
		`;
	}
}

export const turnIndicator = new TurnIndicator();
