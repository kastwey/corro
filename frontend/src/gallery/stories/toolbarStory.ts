// gallery/stories/toolbarStory.ts — the action toolbar (rovingToolbar.ts) with a refused action.
//
// The in-game action bar: one tab stop, arrows between the buttons, and an action that cannot be
// taken right now kept focusable with its reason spoken on activation — never the `disabled`
// attribute, which would make it vanish from the screen reader along with the reason.

import { RovingToolbar } from '../../rovingToolbar.js';
import type { Story } from '../stories.js';

export const toolbarStory: Story = {
	id: 'toolbar',
	title: 'Toolbar',
	description: 'The action bar of a turn. Tab lands on one button; Left, Right, Home and End move '
		+ 'between them. The greyed action stays reachable and says why it is refused when activated.',
	mount(host, context) {
		const mount = document.createElement('div');
		host.appendChild(mount);

		const toolbar = new RovingToolbar();
		toolbar.mount(mount, {
			id: 'story-toolbar',
			label: 'Turn actions',
			className: 'action-bar',
			buttonClassName: 'action-bar-button',
			classPrefix: 'action-bar',
			announce: context.announce,
		});
		toolbar.render([
			{ id: 'roll', label: 'Roll the dice', shortcut: 'R', onActivate: () => context.announce('You rolled 3 and 4.') },
			{ id: 'buy', label: 'Buy', disabledReason: 'You are not standing on a square for sale.', onActivate: () => undefined },
			{ id: 'trade', label: 'Trade', shortcut: 'T', onActivate: () => context.announce('Trade opened.') },
			{ id: 'end', label: 'End turn', shortcut: 'E', onActivate: () => context.announce('Turn ended.') },
		]);
	},
};
