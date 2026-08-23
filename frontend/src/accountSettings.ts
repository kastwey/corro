// accountSettings.ts — the "your account" dialog: rename, add or remove a way to sign in, erase.
//
// Two accessibility decisions run through the whole file:
//
// - Adding a provider is a LINK, because it navigates away to that provider. Removing one is a
//   button, because it posts. Announcing the wrong one misdescribes what is about to happen.
// - The last remaining sign-in method is never `disabled`. It stays focusable and carries
//   aria-disabled plus a description saying WHY, so a screen-reader user can reach it and find out
//   instead of meeting a control that silently does nothing.
//
// Erasing is confirmed INLINE rather than in a second dialog: the manager keeps one modal slot, so
// a confirm would replace this dialog instead of sitting over it.

import { tSync } from './i18nBinder.js';
import {
	AccountSession, MAX_DISPLAY_NAME_LENGTH,
	deleteAccount, fetchProviders, fetchSession, linkPath, providerName,
	renameAccount, readSession, saveHandle, saveVisibility, saveMessagePolicy, unlinkProvider,
	type PresenceVisibility, type MessagePolicy,
} from './account.js';

/** What a provider redirect reported about the link the player just attempted. */
export interface LinkReturn {
	/** Server outcome code: linked, already_linked, provider_in_use, claimed, failed. */
	code: string;
	provider: string;
}

export interface AccountSettingsOptions {
	fetchImpl?: typeof fetch;
	/** Where a provider should send the player back to when adding a sign-in method. */
	returnUrl?: string;
	/** Outcome of a link that has just come back through the provider, if any. */
	linkReturn?: LinkReturn | null;
	/** The account changed, so the host page can refresh what it shows. */
	onChanged?: () => void;
	/** The account is gone or the session ended. */
	onSignedOut?: () => void;
	/** Control focus returns to when the dialog closes. */
	returnFocusTo?: HTMLElement | string;
}

/**
 * The sentence describing one sign-in method. A screen reader speaks a row as a single line, so the
 * provider and the account it points at are joined with words, never bare juxtaposition.
 */
export function methodLineText(issuer: string, email: string | null): string {
	const provider = providerName(issuer);
	if (!email) {
		return tSync('account.settings.methodLinked', { provider });
	}
	return tSync('account.settings.methodLinkedTo', { provider, email });
}

/** The translated outcome of a link attempt that came back through a provider redirect. */
export function linkResultMessage(result: LinkReturn): string {
	const provider = providerName(result.provider);
	const key = {
		linked: 'account.settings.linkOk',
		already_linked: 'account.settings.linkAlready',
		provider_in_use: 'account.settings.linkProviderInUse',
		claimed: 'account.settings.linkClaimed',
	}[result.code] ?? 'account.settings.linkFailed';
	return tSync(key, { provider });
}

/** The translated outcome of an action taken inside the dialog. */
function operationMessage(result: string, provider?: string): string {
	const key = {
		last_sign_in_method: 'account.settings.unlinkLastRefused',
		not_linked: 'account.settings.unlinkNotLinked',
		name_too_long: 'account.settings.nameTooLong',
		signed_out: 'account.settings.sessionEnded',
	}[result] ?? 'account.settings.actionFailed';
	return tSync(key, {
		provider: provider ? providerName(provider) : '',
		max: MAX_DISPLAY_NAME_LENGTH,
	});
}

/**
 * Opens the account settings. Resolves once the dialog is on screen; everything after that is
 * driven by its own controls.
 */
/**
 * Builds the account settings into a container.
 *
 * It used to be a dialog. A dialog is right for a question with an answer; this is a place you go
 * to change several things and read what happened, and putting it behind a modal meant every one of
 * those changes cost an open and a close. It is a tab of the settings screen now, and the only
 * structural difference is that nothing traps focus and nothing has to be dismissed.
 */
export async function renderAccountSettings(
	mount: HTMLElement, options: AccountSettingsOptions = {},
): Promise<void> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const returnUrl = options.returnUrl ?? '/';

	const [providers, read] = await Promise.all([
		fetchProviders(fetchImpl),
		readSession(fetchImpl),
	]);

	// A request that could not be ANSWERED is not a sign-out. Treating it as one used to throw
	// somebody out of the screen they had just opened, on one bad request.
	if (read === null) {
		mount.replaceChildren();
		return;
	}
	if (!read.signedIn) {
		options.onSignedOut?.();
		return;
	}
	const initialSession = read;

	let session: AccountSession = initialSession;

	const content = document.createElement('div');
	content.className = 'account-settings';

	// One STABLE live region for every outcome in this dialog. Rebuilding it per render would
	// recreate the node, and a screen reader announces changes to a region, not a fresh one.
	const status = document.createElement('p');
	status.className = 'account-settings-status';
	status.id = 'account-settings-status';
	status.setAttribute('role', 'status');
	content.appendChild(status);
	const setStatus = (text: string) => { status.textContent = text; };

	// ── the name other players see ───────────────────────────────────────────

	const nameGroup = document.createElement('div');
	nameGroup.className = 'form-group account-settings-name';

	const nameLabel = document.createElement('label');
	nameLabel.htmlFor = 'account-name-input';
	nameLabel.textContent = tSync('account.settings.nameLabel');

	const nameInput = document.createElement('input');
	nameInput.type = 'text';
	nameInput.id = 'account-name-input';
	nameInput.maxLength = MAX_DISPLAY_NAME_LENGTH;
	nameInput.value = session.user?.displayName ?? '';

	const nameHint = document.createElement('p');
	nameHint.className = 'account-settings-hint';
	nameHint.id = 'account-name-hint';
	nameHint.textContent = tSync('account.settings.nameHint');
	nameInput.setAttribute('aria-describedby', nameHint.id);

	const nameSave = document.createElement('button');
	nameSave.type = 'button';
	nameSave.id = 'account-name-save';
	nameSave.className = 'secondary-button';
	nameSave.textContent = tSync('account.settings.nameSave');
	nameSave.addEventListener('click', async () => {
		const result = await renameAccount(fetchImpl, nameInput.value);
		if (result === 'ok') {
			session = await fetchSession(fetchImpl);
			setStatus(tSync('account.settings.nameSaved'));
			options.onChanged?.();
			return;
		}
		setStatus(operationMessage(result));
		if (result === 'signed_out') options.onSignedOut?.();
	});

	nameGroup.append(nameLabel, nameInput, nameHint, nameSave);
	content.appendChild(nameGroup);

	// ── the public name, and whether it is published ─────────────────────────
	//
	// Two separate decisions on purpose. The handle is what strangers can see; the display name
	// above is usually a real name imported from the provider and is NEVER published by the list.

	const handleGroup = document.createElement('div');
	handleGroup.className = 'form-group account-settings-handle';

	const handleLabel = document.createElement('label');
	handleLabel.htmlFor = 'account-handle-input';
	handleLabel.textContent = tSync('account.settings.handleLabel');

	const handleInput = document.createElement('input');
	handleInput.type = 'text';
	handleInput.id = 'account-handle-input';
	handleInput.autocomplete = 'off';
	handleInput.maxLength = 20;
	handleInput.value = session.user?.handle ?? '';

	const handleHint = document.createElement('p');
	handleHint.className = 'account-settings-hint';
	handleHint.id = 'account-handle-hint';
	handleHint.textContent = tSync('account.settings.handleHint');
	handleInput.setAttribute('aria-describedby', handleHint.id);

	const handleSave = document.createElement('button');
	handleSave.type = 'button';
	handleSave.id = 'account-handle-save';
	handleSave.className = 'secondary-button';
	handleSave.textContent = tSync('account.settings.handleSave');
	handleSave.addEventListener('click', async () => {
		const result = await saveHandle(fetchImpl, handleInput.value);
		if (result.ok) {
			session = await fetchSession(fetchImpl);
			setStatus(tSync('account.settings.handleSaved'));
			options.onChanged?.();
			return;
		}
		// Each refusal is a different thing to tell somebody — taken, too soon, bad characters —
		// so each has its own words rather than one "invalid".
		setStatus(tSync(`account.settings.${result.code}`, result.vars));
	});

	handleGroup.append(handleLabel, handleInput, handleHint, handleSave);
	content.appendChild(handleGroup);

	// ── who can see you connected ────────────────────────────────────────────
	//
	// A radio group rather than a checkbox, because the question has three answers and a checkbox
	// can only offer two. It is a real <fieldset>/<legend>: that is what makes a screen reader read
	// the question before each option, instead of three bare words with no idea what they answer.

	const listedGroup = document.createElement('fieldset');
	listedGroup.className = 'form-group account-settings-listed';

	const listedLegend = document.createElement('legend');
	listedLegend.textContent = tSync('account.settings.visibilityLegend');

	const listedHint = document.createElement('p');
	listedHint.className = 'account-settings-hint';
	listedHint.id = 'account-listed-hint';
	listedHint.textContent = tSync('account.settings.visibilityHint');

	listedGroup.append(listedLegend, listedHint);

	const current = session.user?.visibility ?? 'Nobody';
	const choices: PresenceVisibility[] = ['Nobody', 'Friends', 'Everyone'];
	const inputs = new Map<PresenceVisibility, HTMLInputElement>();

	for (const choice of choices) {
		const row = document.createElement('div');
		row.className = 'account-settings-choice';

		const input = document.createElement('input');
		input.type = 'radio';
		input.name = 'account-visibility';
		input.id = `account-visibility-${choice.toLowerCase()}`;
		input.value = choice;
		input.checked = choice === current;
		input.setAttribute('aria-describedby', listedHint.id);

		const label = document.createElement('label');
		label.htmlFor = input.id;
		label.textContent = tSync(`account.settings.visibility${choice}`);

		input.addEventListener('change', async () => {
			if (!input.checked) return;
			const saved = await saveVisibility(fetchImpl, choice);
			if (!saved) {
				// Put the group back to what the server still holds rather than leaving it showing
				// an answer that was never stored.
				const held = session.user?.visibility ?? 'Nobody';
				inputs.get(held)?.click();
				setStatus(tSync('account.settings.listedFailed'));
				return;
			}
			session = await fetchSession(fetchImpl);
			setStatus(tSync(`account.settings.visibilitySaved${choice}`));
			options.onChanged?.();
		});

		inputs.set(choice, input);
		row.append(input, label);
		listedGroup.appendChild(row);
	}

	content.appendChild(listedGroup);

	// ── who can write to you ─────────────────────────────────────────────────
	//
	// The same three-way shape as the question above, and a separate question on purpose: being
	// findable and being interruptible are not the same thing.

	const messagesGroup = document.createElement('fieldset');
	messagesGroup.className = 'form-group account-settings-listed';

	const messagesLegend = document.createElement('legend');
	messagesLegend.textContent = tSync('account.settings.messagesLegend');

	const messagesHint = document.createElement('p');
	messagesHint.className = 'account-settings-hint';
	messagesHint.id = 'account-messages-hint';
	messagesHint.textContent = tSync('account.settings.messagesHint');

	messagesGroup.append(messagesLegend, messagesHint);

	const currentPolicy = session.user?.messagePolicy ?? 'Friends';
	const policies: MessagePolicy[] = ['Nobody', 'Friends', 'Anyone'];
	const policyInputs = new Map<MessagePolicy, HTMLInputElement>();

	for (const choice of policies) {
		const row = document.createElement('div');
		row.className = 'account-settings-choice';

		const input = document.createElement('input');
		input.type = 'radio';
		input.name = 'account-message-policy';
		input.id = `account-messages-${choice.toLowerCase()}`;
		input.value = choice;
		input.checked = choice === currentPolicy;
		input.setAttribute('aria-describedby', messagesHint.id);

		const label = document.createElement('label');
		label.htmlFor = input.id;
		label.textContent = tSync(`account.settings.messages${choice}`);

		input.addEventListener('change', async () => {
			if (!input.checked) return;
			const saved = await saveMessagePolicy(fetchImpl, choice);
			if (!saved) {
				const held = session.user?.messagePolicy ?? 'Friends';
				policyInputs.get(held)?.click();
				setStatus(tSync('account.settings.listedFailed'));
				return;
			}
			session = await fetchSession(fetchImpl);
			setStatus(tSync(`account.settings.messagesSaved${choice}`));
			options.onChanged?.();
		});

		policyInputs.set(choice, input);
		row.append(input, label);
		messagesGroup.appendChild(row);
	}

	content.appendChild(messagesGroup);

	// ── ways to sign in ──────────────────────────────────────────────────────

	const methodsHeading = document.createElement('h3');
	methodsHeading.id = 'account-methods-heading';
	methodsHeading.textContent = tSync('account.settings.methodsHeading');
	content.appendChild(methodsHeading);

	// The reason the last method cannot be removed. It is a real element rather than a title so it
	// can be referenced by aria-describedby and read on the control itself.
	const lastMethodHint = document.createElement('p');
	lastMethodHint.className = 'account-settings-hint';
	lastMethodHint.id = 'account-last-method-hint';
	lastMethodHint.textContent = tSync('account.settings.lastMethodHint');

	const methodList = document.createElement('ul');
	methodList.className = 'account-method-list';
	methodList.setAttribute('aria-labelledby', methodsHeading.id);
	content.append(methodList, lastMethodHint);

	const renderMethods = () => {
		methodList.replaceChildren();
		const linked = session.user?.identities ?? [];
		const isLastMethod = linked.length <= 1;
		lastMethodHint.hidden = !isLastMethod;

		// Every provider this deployment offers, plus any already linked but no longer offered —
		// otherwise a provider switched off in configuration would vanish from the account that
		// still depends on it, with no way to remove it.
		const all = [...new Set([...providers, ...linked.map(i => i.issuer)])];

		for (const issuer of all) {
			const identity = linked.find(i => i.issuer === issuer);
			const item = document.createElement('li');
			item.className = 'account-method';

			const line = document.createElement('span');
			line.className = 'account-method-line';
			line.textContent = identity
				? methodLineText(issuer, identity.email)
				: tSync('account.settings.methodNotLinked', { provider: providerName(issuer) });
			item.appendChild(line);

			if (identity) {
				const unlink = document.createElement('button');
				unlink.type = 'button';
				unlink.className = 'account-unlink-btn secondary-button';
				unlink.dataset.provider = issuer;
				unlink.textContent = tSync('account.settings.unlink', { provider: providerName(issuer) });

				if (isLastMethod) {
					// aria-disabled, never the disabled attribute: the control stays reachable and
					// says why it will not act. The server refuses this too, so an activation is
					// safe regardless.
					unlink.setAttribute('aria-disabled', 'true');
					unlink.setAttribute('aria-describedby', lastMethodHint.id);
				}

				unlink.addEventListener('click', async () => {
					if (unlink.getAttribute('aria-disabled') === 'true') {
						setStatus(tSync('account.settings.lastMethodHint'));
						return;
					}
					const result = await unlinkProvider(fetchImpl, issuer);
					session = await fetchSession(fetchImpl);
					if (!session.signedIn) {
						// Signed out from under us. The caller decides where to send them; there is
						// no dialog to close any more.
						options.onSignedOut?.();
						return;
					}
					setStatus(result === 'ok'
						? tSync('account.settings.unlinked', { provider: providerName(issuer) })
						: operationMessage(result, issuer));
					renderMethods();
					options.onChanged?.();
				});

				item.appendChild(unlink);
			} else {
				// A LINK: it leaves the page for the provider.
				const add = document.createElement('a');
				add.className = 'account-link-provider';
				add.dataset.provider = issuer;
				add.href = linkPath(issuer, returnUrl);
				add.textContent = tSync('account.settings.link', { provider: providerName(issuer) });
				item.appendChild(add);
			}

			methodList.appendChild(item);
		}
	};

	renderMethods();

	// ── erasing the account ──────────────────────────────────────────────────

	const eraseHeading = document.createElement('h3');
	eraseHeading.textContent = tSync('account.settings.eraseHeading');

	const eraseExplanation = document.createElement('p');
	eraseExplanation.className = 'account-settings-hint';
	eraseExplanation.id = 'account-erase-explanation';
	eraseExplanation.textContent = tSync('account.settings.eraseExplanation');

	const eraseRegion = document.createElement('div');
	eraseRegion.className = 'account-erase-region';

	const eraseBtn = document.createElement('button');
	eraseBtn.type = 'button';
	eraseBtn.id = 'account-delete-btn';
	eraseBtn.className = 'account-danger-btn';
	eraseBtn.textContent = tSync('account.settings.erase');
	eraseBtn.setAttribute('aria-describedby', eraseExplanation.id);

	const renderErasePrompt = () => {
		eraseRegion.replaceChildren();

		const prompt = document.createElement('div');
		prompt.className = 'account-erase-confirm';
		prompt.setAttribute('role', 'group');
		// A short name of its own rather than aria-labelledby pointing at the question below.
		// Naming a group with a visible sentence makes that sentence its accessible name, and
		// VoiceOver then reads it twice: once on entering the group, once as the paragraph it
		// still is. The question is what somebody has to READ; this is only what the group is.
		prompt.setAttribute('aria-label', tSync('account.settings.eraseGroupLabel'));

		const question = document.createElement('p');
		question.textContent = tSync('account.settings.eraseConfirm');

		const cancel = document.createElement('button');
		cancel.type = 'button';
		cancel.id = 'account-delete-cancel';
		cancel.className = 'secondary-button';
		cancel.textContent = tSync('account.settings.eraseCancel');
		cancel.addEventListener('click', () => {
			renderEraseButton();
			eraseBtn.focus();
		});

		const confirm = document.createElement('button');
		confirm.type = 'button';
		confirm.id = 'account-delete-confirm';
		confirm.className = 'account-danger-btn';
		confirm.textContent = tSync('account.settings.eraseConfirmButton');
		confirm.addEventListener('click', async () => {
			const result = await deleteAccount(fetchImpl);
			if (result === 'ok' || result === 'signed_out') {
				options.onSignedOut?.();
				return;
			}
			renderEraseButton();
			setStatus(operationMessage(result));
		});

		prompt.append(question, cancel, confirm);
		eraseRegion.appendChild(prompt);
		// Land on Cancel: the safe answer is the default for something irreversible.
		cancel.focus();
	};

	const renderEraseButton = () => {
		eraseRegion.replaceChildren(eraseBtn);
	};

	eraseBtn.addEventListener('click', renderErasePrompt);
	renderEraseButton();
	content.append(eraseHeading, eraseExplanation, eraseRegion);

	// A link that has just come back through a provider reports itself the moment this is shown.
	if (options.linkReturn) {
		setStatus(linkResultMessage(options.linkReturn));
	}

	mount.replaceChildren(content);
}
