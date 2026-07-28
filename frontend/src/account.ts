// account.ts — the optional player account control in the lobby header.
//
// Accounts are additive and always optional: with no provider configured this renders NOTHING, and
// every player keeps creating and joining games exactly as before. The control therefore never
// gates anything — it only reports who you are and offers to change that.
//
// The session itself lives in an HttpOnly cookie the server issues, so this module can never read
// it. That is deliberate: it means no script on the page can steal a session. The only way to learn
// whether somebody is signed in is to ask the server, which is what `fetchSession` does.

// Full, namespaced keys at every call site rather than a local prefixing helper: the translation
// parity test scans for them literally, so a key that stops existing fails the suite instead of
// silently rendering as its own name.
import { tSync } from './i18nBinder.js';

/** One provider login bound to the account. The subject stays server-side: it IS the identity, and
 *  the client has no use for it. */
export interface LinkedIdentityView {
	issuer: string;
	/** The address that provider reported, so the settings screen can say WHICH account is linked. */
	email: string | null;
}

export interface AccountUser {
	userId: string;
	/** Null when the provider supplied no name; the caller renders a localized placeholder. */
	displayName: string | null;
	email: string | null;
	identities: LinkedIdentityView[];
}

export interface AccountSession {
	signedIn: boolean;
	user: AccountUser | null;
}

export const SIGNED_OUT: AccountSession = { signedIn: false, user: null };

/**
 * Reads the server's session payload defensively: an unexpected shape must degrade to "signed out"
 * rather than throw, because this runs during lobby start-up and a broken account response may not
 * take the whole lobby down with it.
 */
export function parseSession(raw: unknown): AccountSession {
	const body = raw as any;
	if (!body || typeof body !== 'object' || body.signedIn !== true || !body.user) {
		return SIGNED_OUT;
	}

	const user = body.user;
	if (typeof user.userId !== 'string' || !user.userId) {
		return SIGNED_OUT;
	}

	return {
		signedIn: true,
		user: {
			userId: user.userId,
			displayName: typeof user.displayName === 'string' && user.displayName ? user.displayName : null,
			email: typeof user.email === 'string' && user.email ? user.email : null,
			identities: Array.isArray(user.identities)
				? user.identities
					.filter((i: any) => i && typeof i.issuer === 'string' && i.issuer)
					.map((i: any) => ({
						issuer: i.issuer,
						email: typeof i.email === 'string' && i.email ? i.email : null,
					}))
				: [],
		},
	};
}

/** The provider list the server offers. Anything unexpected means "no accounts here". */
export function parseProviders(raw: unknown): string[] {
	const list = (raw as any)?.providers;
	return Array.isArray(list) ? list.filter((p: unknown) => typeof p === 'string' && !!p) : [];
}

/**
 * Where a sign-in starts. `returnUrl` comes back to us through the provider, so the server
 * re-checks that it is site-local; encoding it here keeps a path with a query string intact.
 */
export function signInPath(provider: string, returnUrl: string): string {
	return `/api/auth/signin/${encodeURIComponent(provider)}?returnUrl=${encodeURIComponent(returnUrl)}`;
}

/** Where adding a provider to the CURRENT account starts. Same navigation shape as signing in. */
export function linkPath(provider: string, returnUrl: string): string {
	return `/api/auth/link/${encodeURIComponent(provider)}?returnUrl=${encodeURIComponent(returnUrl)}`;
}

/** The provider's name as shown to players. Unknown slugs fall back to the slug itself so a newly
 *  configured provider is still usable before its label is translated. */
export function providerName(provider: string): string {
	// The key is built from the slug, so the parity scanner cannot see it. `accountProviderLabels`
	// in the account tests pins the shipped slugs instead.
	const key = `account.provider.${provider}`;
	const label = tSync(key);
	return label === key ? provider : label;
}

/**
 * The signed-in line. One flowing sentence, because a screen reader speaks it as a single line —
 * and it stays a sentence when the provider gave us no name to put in it.
 */
export function signedInText(session: AccountSession): string {
	const name = session.user?.displayName;
	return name ? tSync('account.signedInAs', { name }) : tSync('account.signedIn');
}

/** Fetches the provider list; a failure means the control simply does not appear. */
export async function fetchProviders(fetchImpl: typeof fetch): Promise<string[]> {
	try {
		const response = await fetchImpl('/api/auth/providers');
		if (!response.ok) return [];
		return parseProviders(await response.json());
	} catch {
		return [];
	}
}

/** Asks the server who we are. A failure reads as signed out, never as an error state. */
export async function fetchSession(fetchImpl: typeof fetch): Promise<AccountSession> {
	try {
		const response = await fetchImpl('/api/auth/me');
		if (!response.ok) return SIGNED_OUT;
		return parseSession(await response.json());
	} catch {
		return SIGNED_OUT;
	}
}

/** Ends the session. A POST, so the Lax session cookie cannot be dropped by a cross-site link. */
export async function signOut(fetchImpl: typeof fetch): Promise<boolean> {
	try {
		const response = await fetchImpl('/api/auth/signout', { method: 'POST' });
		return response.ok;
	} catch {
		return false;
	}
}

/** The longest name the server accepts. Mirrors `UserAccountService.MaxDisplayNameLength`. */
export const MAX_DISPLAY_NAME_LENGTH = 40;

/**
 * Outcome codes shared with the server. `ok` means the operation applied; everything else names a
 * specific reason the client turns into a translated sentence.
 */
export type AccountOperationResult =
	| 'ok'
	| 'last_sign_in_method'
	| 'not_linked'
	| 'name_too_long'
	| 'signed_out'
	| 'failed';

/** Removes a provider from the account. A POST because it changes account state. */
export async function unlinkProvider(
	fetchImpl: typeof fetch,
	provider: string,
): Promise<AccountOperationResult> {
	try {
		const response = await fetchImpl(`/api/auth/unlink/${encodeURIComponent(provider)}`, { method: 'POST' });
		if (response.ok) return 'ok';
		// 409 is the guard against leaving an account with no way back into it — a refusal with a
		// reason, not a transient failure to retry.
		if (response.status === 409) return 'last_sign_in_method';
		if (response.status === 404) return 'not_linked';
		if (response.status === 401) return 'signed_out';
		return 'failed';
	} catch {
		return 'failed';
	}
}

/** Sets the name other players see. A blank name clears it back to the localized placeholder. */
export async function renameAccount(
	fetchImpl: typeof fetch,
	displayName: string,
): Promise<AccountOperationResult> {
	try {
		const response = await fetchImpl('/api/auth/me', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ displayName }),
		});
		if (response.ok) return 'ok';
		if (response.status === 400) return 'name_too_long';
		if (response.status === 401) return 'signed_out';
		return 'failed';
	} catch {
		return 'failed';
	}
}

/** Erases the account and every provider mapping pointing at it. */
export async function deleteAccount(fetchImpl: typeof fetch): Promise<AccountOperationResult> {
	try {
		const response = await fetchImpl('/api/auth/me', { method: 'DELETE' });
		if (response.ok) return 'ok';
		if (response.status === 401) return 'signed_out';
		return 'failed';
	} catch {
		return 'failed';
	}
}

export interface AccountBarOptions {
	/** Injected so tests can drive the control without a network. */
	fetchImpl?: typeof fetch;
	/** Where the provider should send the player back to. */
	returnUrl?: string;
	/** Whether the previous attempt came back as a failure (the server's `?signInError=1`). */
	signInFailed?: boolean;
	/** Called after a successful sign-out so the host page can refresh what it shows. */
	onSignedOut?: () => void;
	/** Opens the account settings. Injected rather than imported so this module stays free of the
	 *  dialog layer; when absent, no management affordance is offered at all. */
	onManageAccount?: () => void;
}

/**
 * Renders the account control into `mount`, and returns the session it found.
 *
 * The sign-in affordances are LINKS, not buttons: they navigate away to the provider, and telling a
 * screen-reader user "button" for something that leaves the page is a lie. Sign-out is a real
 * button, because it posts.
 */
export async function initAccountBar(
	mount: HTMLElement,
	options: AccountBarOptions = {},
): Promise<AccountSession> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const returnUrl = options.returnUrl ?? '/';

	const providers = await fetchProviders(fetchImpl);
	if (providers.length === 0) {
		// This deployment configured no provider: no account UI at all.
		mount.replaceChildren();
		mount.hidden = true;
		return SIGNED_OUT;
	}

	let session = await fetchSession(fetchImpl);
	mount.hidden = false;

	const render = () => {
		mount.replaceChildren();

		if (options.signInFailed && !session.signedIn) {
			// role="alert" because it explains why an action the player just took produced nothing.
			// It also says they can carry on without an account, so it never reads as a dead end.
			const failure = document.createElement('p');
			failure.className = 'account-error';
			failure.setAttribute('role', 'alert');
			failure.textContent = tSync('account.signInFailed');
			mount.appendChild(failure);
		}

		if (session.signedIn) {
			const status = document.createElement('p');
			status.className = 'account-status';
			status.textContent = signedInText(session);
			mount.appendChild(status);

			if (options.onManageAccount) {
				const manage = document.createElement('button');
				manage.type = 'button';
				manage.id = 'account-manage-btn';
				manage.className = 'secondary-button account-manage-btn';
				manage.textContent = tSync('account.manage');
				manage.addEventListener('click', () => options.onManageAccount!());
				mount.appendChild(manage);
			}

			const out = document.createElement('button');
			out.type = 'button';
			out.id = 'account-signout-btn';
			out.className = 'secondary-button account-signout-btn';
			out.textContent = tSync('account.signOut');
			out.addEventListener('click', async () => {
				if (await signOut(fetchImpl)) {
					session = SIGNED_OUT;
					render();
					options.onSignedOut?.();
				}
			});
			mount.appendChild(out);
			return;
		}

		const prompt = document.createElement('p');
		prompt.className = 'account-prompt';
		prompt.id = 'account-prompt';
		prompt.textContent = tSync('account.signInPrompt');
		mount.appendChild(prompt);

		// role="group" rather than a landmark or a <section>: the lobby's landmark tree stays flat,
		// and the links still read as one named set.
		const group = document.createElement('div');
		group.className = 'account-providers';
		group.setAttribute('role', 'group');
		group.setAttribute('aria-labelledby', prompt.id);

		for (const provider of providers) {
			const link = document.createElement('a');
			link.className = 'account-signin-link';
			link.dataset.provider = provider;
			link.href = signInPath(provider, returnUrl);
			link.textContent = tSync('account.signInWith', { provider: providerName(provider) });
			group.appendChild(link);
		}

		mount.appendChild(group);
	};

	render();
	// Labels are set imperatively, so applyI18n never reaches them on a runtime language switch.
	document.addEventListener('languageChanged', render);
	return session;
}
