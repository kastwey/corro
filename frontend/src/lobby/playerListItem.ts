import { tokenIconHtml } from '../tokenIcons.js';

export interface PlayerListIdentity {
	tokenKey: string;
	playerName: string;
	tokenName: string;
	statusText: string;
	hostText: string;
	botText: string;
}

/** Build the visible player identity without parsing server/package text as HTML. */
export function createPlayerIdentity(data: PlayerListIdentity): HTMLElement {
	const info = document.createElement('span');
	info.className = 'player-info';

	// tokenIconHtml is engine-owned markup whose only package input is server-sanitized SVG path data.
	const icon = document.createElement('span');
	icon.innerHTML = tokenIconHtml(data.tokenKey);

	const name = document.createElement('span');
	name.className = 'player-name';
	name.textContent = `${data.playerName},\u00a0`;

	const tokenName = document.createElement('span');
	tokenName.className = 'player-token-name';
	tokenName.textContent = `${data.tokenName},\u00a0`;

	const status = document.createElement('span');
	status.className = 'player-status';
	status.textContent = `${data.hostText}${data.botText} ${data.statusText}`;

	info.append(icon, name, tokenName, status);
	return info;
}