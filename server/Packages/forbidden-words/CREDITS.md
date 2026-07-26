# Credits — Forbidden Words

## Game content and art

The word cards, rules text and geometric token drawings are original work by Corro contributors and are distributed under the repository's AGPL-3.0-only licence.

## Sounds

The package reuses the repository's shared generic earcons for turn bells, card draws, discards, scoring penalties and game over. Their authors, source URLs and CC0/CC-BY licences are recorded in [`sound-commons/ATTRIBUTIONS.md`](../../../sound-commons/ATTRIBUTIONS.md).

Files copied into `assets/sounds/`: `turn-you.ogg`, `draw.ogg`, `discard.ogg`, `bankruptcy.ogg` and `game-over.ogg`.

The timed turn also reuses Corro's audible auction clock under the family-specific `forbidden.tick` event. The package keeps its own copy so it does not depend on a property-game package at runtime.

| Event | File | Original | Author | Source | Licence |
|---|---|---|---|---|---|
| `forbidden.tick` | `timer-tick.ogg` | "timer with ding.wav" (looped while the timed turn runs) | [keweldog](https://freesound.org/people/keweldog/) | [s/181148](https://freesound.org/people/keweldog/sounds/181148/) | CC0 |
