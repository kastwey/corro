/**
 * Race seat (squadron/colour) selection for the lobby. A seat is the player's identity on
 * a race board — their colour, start square and corridor — so the lobby offers the board's
 * seats as an exclusive pick, mirroring the token selector. Availability is conveyed
 * accessibly: a taken seat stays FOCUSABLE and its label says who holds it — never the
 * `disabled` attribute, which would hide the option (and the why) from a screen-reader
 * user — and a change guard bounces any attempt back to a free option.
 */
import { LobbySeatInfo, LobbyPlayer } from '../models.js';

/** Translation helper signature shared by the lobby UI (`lobby/ui.ts#t`). */
type Translate = (key: string, fallback?: string) => string;

/** seatId → name of the lobby player who holds it. */
export function getUsedSeats(players: readonly LobbyPlayer[] | undefined | null): Map<string, string> {
	const used = new Map<string, string>();
	for (const p of players ?? []) {
		if (p.seatId) used.set(p.seatId, p.name);
	}
	return used;
}

/**
 * Keeps a radio group honest about taken options: selecting one marked data-taken bounces
 * the selection back to the previous valid pick (or the first free option), so the form can
 * never submit a token/seat someone else holds. Assigned (not added) so re-renders of the
 * same container don't stack listeners.
 */
export function installTakenGuard(container: HTMLElement): void {
	container.onchange = ev => {
		const input = ev.target as HTMLInputElement | null;
		if (!input || input.type !== 'radio') return;
		if (input.dataset.taken !== '1') {
			container.dataset.lastValid = input.value;
			return;
		}
		input.checked = false;
		const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
		const fallback = radios.find(r => r.value === container.dataset.lastValid && r.dataset.taken !== '1')
			?? radios.find(r => r.dataset.taken !== '1');
		if (fallback) fallback.checked = true;
	};
}

/** Renders the seat radio group; taken seats are labelled with their holder's name. */
export function renderSeatSelector(
	container: HTMLElement,
	seats: readonly LobbySeatInfo[],
	t: Translate,
	usedSeats?: Map<string, string>,
): void {
	container.innerHTML = '';
	delete container.dataset.lastValid;
	let checkedOne = false;

	for (const seat of seats) {
		const holder = usedSeats?.get(seat.id);
		const seatName = seat.nameKey ? t(seat.nameKey, seat.id) : seat.id;
		const takenText = holder
			? ' ' + t('lobby.seatTakenBy', '(taken by {{name}})').replace('{{name}}', holder)
			: '';

		const li = document.createElement('li');
		li.className = 'token-item' + (holder ? ' disabled' : '');

		const label = document.createElement('label');
		label.className = 'token-label' + (holder ? ' disabled' : '');

		const input = document.createElement('input');
		input.type = 'radio';
		input.name = 'seat';
		input.value = seat.id;
		input.className = 'token-radio';
		if (holder) {
			input.setAttribute('aria-disabled', 'true');
			input.dataset.taken = '1';
		} else if (!checkedOne) {
			input.checked = true;
			checkedOne = true;
		}

		const swatch = document.createElement('span');
		swatch.className = 'seat-swatch';
		if (seat.color) swatch.style.backgroundColor = seat.color;
		swatch.setAttribute('aria-hidden', 'true');

		const nameSpan = document.createElement('span');
		nameSpan.className = 'token-name';
		nameSpan.textContent = seatName + takenText;

		label.append(input, swatch, nameSpan);
		li.appendChild(label);
		container.appendChild(li);
	}
	installTakenGuard(container);
}
