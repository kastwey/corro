/**
 * The "add a bot" name form, split out so it can be exercised without spinning up the
 * whole lobby. Adding a bot asks for its NAME first: type one, roll the hat for a silly
 * road-trip name, or leave it empty and let the server fall back to a plain "Bot N".
 *
 * Both Enter in the name box and the dialog's Add button run the SAME `submit` — Enter
 * saves a trip to the button. Closing the dialog is the caller's job (it owns the dialog),
 * so `onSubmit` fires with the trimmed name (or `undefined` when left blank).
 */
export interface BotNameFormOptions {
	/** Translation lookup (key → label). */
	t: (key: string) => string;
	/** Roll a fresh random name, given whatever is currently typed. */
	rollName: (current: string) => string;
	/** Called with the chosen name, or `undefined` when the box is left blank. */
	onSubmit: (name: string | undefined) => void;
}

export interface BotNameForm {
	content: HTMLElement;
	input: HTMLInputElement;
	/** Read + trim the box and hand the result to `onSubmit`. */
	submit: () => void;
}

export function buildBotNameForm(opts: BotNameFormOptions): BotNameForm {
	const { t, rollName, onSubmit } = opts;

	const content = document.createElement('div');
	content.className = 'bot-name-form';

	const label = document.createElement('label');
	label.setAttribute('for', 'bot-name-input');
	label.textContent = t('lobby.botNameLabel');
	content.appendChild(label);

	const input = document.createElement('input');
	input.type = 'text';
	input.id = 'bot-name-input';
	input.maxLength = 24;
	content.appendChild(input);

	const submit = (): void => {
		const name = input.value.trim();
		onSubmit(name || undefined);
	};

	// Enter in the name box adds the bot straight away — no trip to the button.
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	});

	const roll = document.createElement('button');
	roll.type = 'button';
	roll.id = 'bot-name-random';
	roll.className = 'secondary-button';
	roll.textContent = t('lobby.botNameRandom');
	roll.addEventListener('click', () => {
		input.value = rollName(input.value);
		input.focus();
	});
	content.appendChild(roll);

	return { content, input, submit };
}
