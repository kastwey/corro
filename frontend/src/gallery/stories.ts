// gallery/stories.ts — the component gallery's catalogue, and the pure logic around it.
//
// A STORY is one reusable widget built with fixed, invented data and no server behind it: the
// popup menu with a submenu and a refused option, the tab strip with three panels, the combobox
// over a dozen made-up games. Each lives in its own module under gallery/stories/ and does nothing
// but call the real component with plain data — the same code path the lobby and the board run,
// minus everything that needs a match. That is what makes the gallery worth having:
//
//   * a screen reader can be pointed at ONE widget in ONE state and asked what it says, which no
//     game flow allows (screen-reader/ drives NVDA against these pages);
//   * the Axe monitor audits every widget's states in isolation (e2e/tests/gallery.spec.ts);
//   * a person reviewing a widget change sees it alone, in both themes, without staging a game.
//
// The gallery is a development surface: it is built into dist/ and served by the same server as
// the lobby, but it is not part of the published application (CorroServer.csproj drops it).

export interface StoryContext {
	/**
	 * What the component would hand to the application's announcer. The gallery shows it in a
	 * live log region, so a screen reader hears it exactly as it would in a game and a sighted
	 * reviewer can read what was said.
	 */
	announce: (text: string) => void;
	/** The application's translator, initialised for the page's language. */
	t: (key: string, vars?: Record<string, unknown>) => string;
}

export interface Story {
	/** Stable, URL-safe identity: `?story=<id>` opens it. */
	id: string;
	/** Heading shown above the mounted component. */
	title: string;
	/** One or two sentences: what the widget is and what to try with the keyboard. */
	description: string;
	/** Build the component into `host`. Everything else on the page is the gallery's. */
	mount(host: HTMLElement, context: StoryContext): void;
}

/** What a story id must look like: lowercase words joined by single hyphens. */
const STORY_ID = /^[a-z]+(-[a-z]+)*$/;

/**
 * Check a catalogue before it is used: every id is URL-safe and no two stories share one. Pure, so
 * the gallery's own unit test runs it over the real catalogue.
 */
export function validateStories(stories: readonly Story[]): string[] {
	const problems: string[] = [];
	const seen = new Set<string>();
	for (const story of stories) {
		if (!STORY_ID.test(story.id)) problems.push(`story id "${story.id}" is not lowercase-hyphenated`);
		if (seen.has(story.id)) problems.push(`story id "${story.id}" is used twice`);
		seen.add(story.id);
		if (!story.title.trim()) problems.push(`story "${story.id}" has no title`);
		if (!story.description.trim()) problems.push(`story "${story.id}" has no description`);
	}
	return problems;
}

/**
 * The story a page URL asks for, or null for the index. An unknown id is the index too, rather
 * than an error page: the index lists what exists, which is the answer to a wrong id.
 */
export function selectStory(stories: readonly Story[], search: string): Story | null {
	const requested = new URLSearchParams(search).get('story');
	if (!requested) return null;
	return stories.find(story => story.id === requested) ?? null;
}

/** The link to one story, keeping any other query parameters (the language) as they are. */
export function storyHref(storyId: string, search: string): string {
	const params = new URLSearchParams(search);
	params.set('story', storyId);
	return `?${params.toString()}`;
}
