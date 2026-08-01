// teamPanel.ts — arranging the teams of a table, before a match starts.
//
// A team family (Forbidden Words) or a team-mode board (a journey with teams) needs the host to
// place everyone before there is a game to play. That is a property of the TABLE, not of the
// lobby it was once created from, so this lives with the table and is mounted on its page.
//
// The keyboard contract is the reason this is a module of its own rather than markup: every
// member is one roving tab stop with a complete label, Right enters that person's action
// toolbar, Escape returns, and Shift+F10 opens the same actions as a menu. Authoritative state
// REPLACES this DOM on every change, so where focus was has to be captured and put back — which
// is what teamRoster.ts's focus plan decides.

import { RovingToolbarList } from './accessibleList.js';
import { popupMenu } from './popupMenu.js';
import { joinList } from './listFormat.js';
import {
	teamPanelFocusPlan, teamRosterStatus,
	type PendingTeamFocus, type PreservedTeamFocus,
} from './lobby/teamRoster.js';
import type { GameInfo, LobbyPlayer } from './models.js';

export interface TeamPanelDeps {
	t: (key: string) => string;
	/** Only the host arranges; everyone else watches the same picture, read-only. */
	isHost: () => boolean;
	/** The engine's name for a team index ("the blue team"). */
	teamName: (index: number) => string;
	/** Put a player in a team, or back in the pool with null. */
	assign: (playerId: string, teamIndex: number | null) => Promise<void>;
	/** Deal everyone at once; the server decides the arrangement. */
	fillAtRandom: () => Promise<void>;
	/** Speak a line (team moves are silent in the repaint that follows them). */
	announce: (text: string) => void;
	/** Report a refused move. */
	error: (message: string) => void;
}

export class TeamPanel {
	private panel: HTMLElement | null = null;
	private deps: TeamPanelDeps | null = null;
	private navigators: RovingToolbarList[] = [];
	/** The move this client just asked for, so focus can follow its result. */
	private pendingFocus: PendingTeamFocus | null = null;

	init(panel: HTMLElement | null, deps: TeamPanelDeps): void {
		this.panel = panel;
		this.deps = deps;
	}

	/** Rebuild from authoritative state. Hides itself entirely when this table plays no teams. */
	render(game: GameInfo | null): void {
		const panel = this.panel;
		if (!panel || !this.deps) return;
		const teamCount = game?.teamCount ?? 0;
		const preserved = this.captureFocus();
		this.destroyNavigators();
		panel.hidden = teamCount < 2;
		panel.classList.toggle('hidden', teamCount < 2);
		if (!game || teamCount < 2) {
			panel.replaceChildren();
			return;
		}
		this.build(panel, game, this.deps.isHost());
		this.restoreFocus(game, preserved);
	}

	/** The whole table hears every team move (the repaint that carries it is silent). */
	announceAssigned(data: { playerName: string; teamIndex: number | null }): void {
		if (!this.deps) return;
		const t = this.deps.t;
		this.deps.announce(data.teamIndex == null
			? t('lobby.teamUnassigned').replace('{{player}}', data.playerName)
			: t('lobby.teamAssigned')
				.replace('{{player}}', data.playerName)
				.replace('{{team}}', this.deps.teamName(data.teamIndex)));
	}

	/** …and hears the whole arrangement, team by team, after a random deal. */
	announceFilled(game: GameInfo | null): void {
		if (!this.deps || !game?.teamCount) return;
		const t = this.deps.t;
		const rosters: string[] = [];
		for (let index = 0; index < game.teamCount; index++) {
			const names = game.players.filter(player => player.teamIndex === index).map(player => player.name);
			if (names.length === 0) continue;
			rosters.push(t('lobby.teamRoster')
				.replace('{{team}}', this.deps.teamName(index))
				.replace('{{players}}', joinList(names)));
		}
		this.deps.announce(`${t('lobby.teamsFilled')} ${rosters.join(' ')}`.trim());
	}

	private build(panel: HTMLElement, game: GameInfo, interactive: boolean): void {
		const t = this.deps!.t;
		const teamCount = game.teamCount!;
		const teamSize = Math.floor(game.maxPlayers / teamCount);
		const pool = game.players.filter(p => p.teamIndex == null);
		panel.replaceChildren();

		const heading = document.createElement('h4');
		heading.textContent = t('lobby.teamsHeading');
		panel.appendChild(heading);

		// One move for the whole table: the arrangement everybody normally wants, without walking
		// the pool player by player. Only offered while there is somebody to deal.
		if (interactive && game.players.length > 0) {
			const shuffle = document.createElement('button');
			shuffle.type = 'button';
			shuffle.className = 'secondary-button team-panel__shuffle';
			shuffle.textContent = t('lobby.fillTeamsRandomly');
			shuffle.addEventListener('click', () => { void this.fillAtRandom(); });
			panel.appendChild(shuffle);
		}

		for (let index = 0; index < teamCount; index++) {
			const members = game.players.filter(p => p.teamIndex === index);
			const teamName = this.deps!.teamName(index);
			const box = document.createElement('fieldset');
			box.className = 'team-box';
			box.dataset.teamIndex = String(index);
			const legend = document.createElement('legend');
			legend.textContent = `${teamName} (${members.length}/${teamSize})`;
			box.appendChild(legend);

			const list = document.createElement('ul');
			list.className = 'team-member-list';
			list.setAttribute('aria-label', teamName);
			for (const member of members) {
				list.appendChild(this.memberRow(member, teamName, index, interactive));
			}
			box.appendChild(list);
			const navigator = new RovingToolbarList({
				list,
				itemSelector: '.team-member',
				toolbarButtonSelector: '.team-member__actions button',
				menuLabel: () => t('lobby.teamMemberActionsMenu'),
				menuClass: 'team-context-menu',
				menuItemClass: 'team-context-menu__item',
				// Keep visible popup content in the active main landmark.
				menuHost: () => panel.closest<HTMLElement>('main') ?? panel,
			});
			navigator.refreshRovingTabindex();
			this.navigators.push(navigator);

			if (interactive && members.length < teamSize && pool.length > 0) {
				const add = document.createElement('button');
				add.type = 'button';
				add.className = 'secondary-button team-box__add';
				add.dataset.teamIndex = String(index);
				add.textContent = t('lobby.teamAdd');
				add.setAttribute('aria-label', t('lobby.teamAddTo').replace('{{team}}', teamName));
				add.addEventListener('click', () => this.openPickMenu(add, index, pool));
				box.appendChild(add);
			}
			panel.appendChild(box);
		}

		// Distinguish the current unassigned pool from seats whose players have not joined yet.
		// An empty pool is not a complete roster until every configured team place is filled.
		const poolLine = document.createElement('p');
		poolLine.className = 'team-pool';
		const roster = teamRosterStatus(game.players, game.maxPlayers);
		if (roster.kind === 'unassigned') {
			poolLine.textContent = t('lobby.teamPool').replace('{{names}}', roster.names.join(', '));
		} else if (roster.kind === 'waiting') {
			const key = roster.missing === 1 ? 'lobby.teamRosterWaitingOne' : 'lobby.teamRosterWaitingMany';
			poolLine.textContent = t(key)
				.replace('{{assigned}}', String(roster.assigned))
				.replace('{{capacity}}', String(roster.capacity))
				.replace('{{missing}}', String(roster.missing));
		} else {
			poolLine.textContent = t('lobby.teamPoolEmpty');
		}
		panel.appendChild(poolLine);
	}

	private memberRow(
		member: LobbyPlayer, teamName: string, teamIndex: number, interactive: boolean,
	): HTMLLIElement {
		const t = this.deps!.t;
		const item = document.createElement('li');
		item.className = 'team-member';
		item.dataset.playerId = member.id;
		item.tabIndex = -1;
		item.setAttribute('aria-label', t('lobby.teamMemberLabel')
			.replace('{{name}}', member.name)
			.replace('{{team}}', teamName));
		const name = document.createElement('span');
		name.className = 'team-member__name';
		name.textContent = member.name;
		item.appendChild(name);
		if (interactive) {
			const toolbar = document.createElement('div');
			toolbar.className = 'team-member__actions';
			toolbar.setAttribute('role', 'toolbar');
			toolbar.setAttribute('aria-label', t('game.actions_for').replace('{{name}}', member.name));
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'secondary-button team-box__remove';
			remove.tabIndex = -1;
			remove.textContent = t('lobby.teamRemove');
			remove.setAttribute('aria-label', t('lobby.teamRemoveOf').replace('{{name}}', member.name));
			remove.addEventListener('click', () => void this.assign(member.id, null, teamIndex));
			toolbar.appendChild(remove);
			item.appendChild(toolbar);
		}
		return item;
	}

	/** The host's "add player" menu: only the UNASSIGNED players are offered. */
	private openPickMenu(anchor: HTMLElement, teamIndex: number, pool: LobbyPlayer[]): void {
		const deps = this.deps!;
		popupMenu.open({
			ariaLabel: deps.t('lobby.teamAddTo').replace('{{team}}', deps.teamName(teamIndex)),
			anchor,
			items: pool.map(player => ({
				label: player.name,
				onSelect: () => void this.assign(player.id, teamIndex, teamIndex),
			})),
			announce: text => deps.announce(text),
			onClose: () => anchor.focus(),
		});
	}

	private async assign(
		playerId: string, teamIndex: number | null, preferredTeamIndex: number,
	): Promise<void> {
		if (!this.deps) return;
		this.pendingFocus = { preferredTeamIndex, playerId, expectedTeamIndex: teamIndex };
		try {
			await this.deps.assign(playerId, teamIndex);
		} catch (error) {
			this.pendingFocus = null;
			console.error('Error assigning team:', error);
			this.deps.error(this.deps.t('lobby.errors.assignTeam'));
		}
	}

	private async fillAtRandom(): Promise<void> {
		if (!this.deps) return;
		try {
			await this.deps.fillAtRandom();
		} catch (error) {
			console.error('Error filling teams:', error);
			this.deps.error(this.deps.t('lobby.errors.fillTeams'));
		}
	}

	private destroyNavigators(): void {
		for (const navigator of this.navigators) navigator.destroy();
		this.navigators = [];
	}

	/** Capture a stable identity before authoritative state replaces the team DOM. */
	private captureFocus(): PreservedTeamFocus | null {
		const panel = this.panel;
		const active = document.activeElement as HTMLElement | null;
		if (!panel || !active || !panel.contains(active)) return null;
		if (active.matches('.team-panel__shuffle')) return { kind: 'shuffle', teamIndex: -1 };
		const box = active.closest<HTMLElement>('.team-box');
		const teamIndex = Number(box?.dataset.teamIndex);
		if (!Number.isInteger(teamIndex)) return null;
		if (active.matches('.team-box__add')) return { kind: 'add', teamIndex };
		const member = active.closest<HTMLElement>('.team-member');
		const playerId = member?.dataset.playerId;
		if (!playerId) return null;
		return {
			kind: active.matches('.team-member__actions button') ? 'action' : 'member',
			teamIndex,
			playerId,
		};
	}

	private restoreFocus(game: GameInfo, preserved: PreservedTeamFocus | null): void {
		const panel = this.panel;
		if (!panel || !this.deps?.isHost()) return;

		const addButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>('.team-box__add'));
		const plan = teamPanelFocusPlan(
			this.pendingFocus,
			preserved,
			game.players.map(player => ({ id: player.id, teamIndex: player.teamIndex ?? null })),
			addButtons.map(button => Number(button.dataset.teamIndex)),
			game.teamCount ?? 0,
		);
		this.pendingFocus = plan.pending;
		if (!plan.target) return;

		if (plan.target.kind === 'shuffle') {
			panel.querySelector<HTMLElement>('.team-panel__shuffle')?.focus();
			return;
		}
		if (plan.target.kind === 'add') {
			const teamIndex = plan.target.teamIndex;
			addButtons.find(button => Number(button.dataset.teamIndex) === teamIndex)?.focus();
			return;
		}
		const row = panel.querySelector<HTMLElement>(
			`.team-member[data-player-id="${CSS.escape(plan.target.playerId)}"]`);
		if (plan.target.kind === 'action') row?.querySelector<HTMLElement>('.team-member__actions button')?.focus();
		else row?.focus();
	}
}

export const teamPanel = new TeamPanel();
