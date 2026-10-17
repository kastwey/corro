// gallery/index.ts — the component gallery page (gallery.html).
//
// One page, one widget at a time: `?story=<id>` mounts that story into the page; without it the
// page is the index. The shell around the widget is deliberately small and static — a heading, the
// list of stories, the mounted component, and a live log of what the component announced — so a
// screen reader session spends its time on the widget and not on the page.
//
// The announcement log stands in for the application's announcer: a story's `announce` appends to
// a `role="log"` region, which a screen reader reads as it would the game's own live region, and
// which a sighted reviewer (or a Playwright assertion) can read back.

import { i18nBinder } from '../i18nBinder.js';
import { initThemeToggle } from '../themeToggle.js';
import { stories } from './catalogue.js';
import { selectStory, storyHref, type StoryContext } from './stories.js';

/** The page's language comes from the URL (`?lang=es`), so one gallery serves both locales. */
function applyRequestedLanguage(search: string): void {
	const requested = new URLSearchParams(search).get('lang');
	if (requested && i18nBinder.getSupportedLanguages().includes(requested)) {
		document.documentElement.lang = requested;
	}
}

function renderIndex(list: HTMLElement, search: string, current: string | null): void {
	list.replaceChildren(...stories.map(story => {
		const item = document.createElement('li');
		const link = document.createElement('a');
		link.href = storyHref(story.id, search);
		link.textContent = story.title;
		if (story.id === current) link.setAttribute('aria-current', 'page');
		item.appendChild(link);
		return item;
	}));
}

function makeContext(log: HTMLElement): StoryContext {
	return {
		announce: text => {
			const entry = document.createElement('li');
			entry.textContent = text;
			log.appendChild(entry);
		},
		t: (key, vars) => i18nBinder.tSync(key, vars),
	};
}

async function initGallery(): Promise<void> {
	const search = window.location.search;
	applyRequestedLanguage(search);
	await i18nBinder.init();

	const themeMount = document.getElementById('gallery-theme-toggle');
	if (themeMount) {
		initThemeToggle(themeMount, {
			toLight: i18nBinder.tSync('game.theme_to_light'),
			toDark: i18nBinder.tSync('game.theme_to_dark'),
		});
	}

	const list = document.getElementById('gallery-stories');
	const title = document.getElementById('story-title');
	const description = document.getElementById('story-description');
	const host = document.getElementById('story-host');
	const log = document.getElementById('gallery-log-entries');
	const section = document.getElementById('gallery-story');
	if (!list || !title || !description || !host || !log || !section) return;

	const story = selectStory(stories, search);
	renderIndex(list, search, story?.id ?? null);

	if (!story) {
		section.hidden = true;
		return;
	}
	section.hidden = false;
	// No punctuation in the title: the screen-reader suite finds the browser window by asking NVDA
	// for its title and comparing it with this, and a dash NVDA chooses to voice ("em dash") would
	// never match the text it was asked to find.
	document.title = `${story.title} in the component gallery`;
	title.textContent = story.title;
	description.textContent = story.description;
	story.mount(host, makeContext(log));
}

void initGallery();
