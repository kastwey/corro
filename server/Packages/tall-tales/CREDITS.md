# Credits — Tall Tales

## Game content

The questions, their true answers and the rules text are original work by Corro contributors and are distributed under the repository's AGPL-3.0-only licence. The facts behind the questions are matters of public record; the wording is ours.

This package ships no player pieces: a seat in a bluffing game is a name, not a token.

## Sounds

The package reuses the repository's shared generic earcons for the round start, the opening of a vote, the reveal and game over. Their authors, source URLs and CC0/CC-BY licences are recorded in [`sound-commons/ATTRIBUTIONS.md`](../../../sound-commons/ATTRIBUTIONS.md).

Files copied into `assets/sounds/`: `turn-you.ogg`, `draw.ogg`, `discard.ogg` and `game-over.ogg`.

The writing and voting clocks reuse Corro's audible auction clock under the family-specific `bluff.tick` event. The package keeps its own copy so it does not depend on another package at runtime.

| Event | File | Original | Author | Source | Licence |
|---|---|---|---|---|---|
| `bluff.tick` | `timer-tick.ogg` | "timer with ding.wav" (looped while a clock runs) | [keweldog](https://freesound.org/people/keweldog/) | [s/181148](https://freesound.org/people/keweldog/sounds/181148/) | CC0 |
