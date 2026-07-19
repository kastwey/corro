# Sound commons — shared earcons

Canonical source for the cross-family earcons that many packages reuse (dice, card draw/shuffle,
your-turn, game-over, bankruptcy, piece-captured). These files are **not** served by the engine:
each package that needs one ships its OWN copy under its `sounds/` folder. This folder is the
single place to update a shared sound and the origin the `new-game-family` skill copies from.

The engine itself ships only PLATFORM sounds (chat, error) — see
`server/Assets/Sounds/ATTRIBUTIONS.md`. Game earcons live in packages.

All sounds are from [Freesound](https://freesound.org/), converted to OGG and otherwise
unmodified. Only CC0 and CC-BY licences are used.

| File | Used for | Sound | Author | Source | License |
|---|---|---|---|---|---|
| dice-roll.ogg | `dice.roll` (board/race/track/trivia) | "dice_05.wav" | [dermotte](https://freesound.org/people/dermotte/) | [freesound.org/s/220745](https://freesound.org/people/dermotte/sounds/220745/) | CC BY 4.0 |
| draw.ogg | `card.draw` (card families) | "PickupCard03" | [SilverDubloons](https://freesound.org/people/SilverDubloons/) | [freesound.org/s/817549](https://freesound.org/people/SilverDubloons/sounds/817549/) | CC0 |
| shuffle.ogg | `cards.shuffle` (card families) | "Shuffling cards (riffle) 03.WAV" | [VKProduktion](https://freesound.org/people/VKProduktion/) | [freesound.org/s/217503](https://freesound.org/people/VKProduktion/sounds/217503/) | CC0 |
| discard.ogg | `card.discard` (journey, assembly) | "Playing Card Deal Variation 2" | [el_boss](https://freesound.org/people/el_boss/) | [freesound.org/s/571576](https://freesound.org/people/el_boss/sounds/571576/) | CC0 |
| turn-you.ogg | `turn.you` (turn-based games) | "Elevator Ding.wav" | [XfiXy8](https://freesound.org/people/XfiXy8/) | [freesound.org/s/467299](https://freesound.org/people/XfiXy8/sounds/467299/) | CC0 |
| game-over.ogg | `game.over` (every game) | "050811 - Rijeka - Peek and Poke - Laetita Sonami.wav" | [dkustic](https://freesound.org/people/dkustic/) | [freesound.org/s/377021](https://freesound.org/people/dkustic/sounds/377021/) | CC BY 3.0 |
| bankruptcy.ogg | `bankruptcy` (property family) | "Glass Broken" | [gamer500](https://freesound.org/people/gamer500/) | [freesound.org/s/686609](https://freesound.org/people/gamer500/sounds/686609/) | CC0 |
| piece-captured.ogg | `piece.captured` (race family) | "Chess_foley_1.mp3" | [Amatsuuu](https://freesound.org/people/Amatsuuu/) | [freesound.org/s/629182](https://freesound.org/people/Amatsuuu/sounds/629182/) | CC0 |
