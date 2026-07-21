# Sound attributions — engine platform pack

The engine ships **only platform sounds**: cues that exist regardless of which game is being
played (chat, invalid-action feedback). Every GAME earcon (dice, money, holding, card draw/shuffle,
win/lose, …) lives in the PACKAGES now, not here — a package's `assets/sounds/` folder overlays this
platform pack. Shared cross-family earcons have a canonical source in
[`sound-commons/`](../../../sound-commons/ATTRIBUTIONS.md); each package ships its own copy.

Sounds come from [Freesound](https://freesound.org/) unless noted. Only CC0 and CC-BY licences
are accepted (CC-BY-NC is not compatible with this repository).

## Platform pack (`server/Assets/Sounds`)

| Event | File | Sound | Author | Source | License |
|---|---|---|---|---|---|
| `error` (invalid action) | error.ogg | "neon stereo buzzer box buzz hum stereo close lowcut to taste.flac" | [kyles](https://freesound.org/people/kyles/) | [freesound.org/s/453498](https://freesound.org/people/kyles/sounds/453498/) | CC0 |
| `disconnect` (a player drops) | disconnect.ogg | "malexmedia_lazymanphone_hangupbeep.wav" | [malexmedia](https://freesound.org/people/malexmedia/) | [freesound.org/s/31801](https://freesound.org/people/malexmedia/sounds/31801/) | CC BY 4.0 |
| `connect` (a player returns) | connect.ogg | "malexmedia_lazymanphone_hangupbeep.wav" | [malexmedia](https://freesound.org/people/malexmedia/) | [freesound.org/s/31801](https://freesound.org/people/malexmedia/sounds/31801/) | CC BY 4.0 |
| `message.send` (chat) | message-sent.ogg | "UIMvmt_Game User Interface Sound Set.Freesound Selection_EM" (trimmed: one cue from the 70-second set) | [newlocknew](https://freesound.org/people/newlocknew/) | [freesound.org/s/842498](https://freesound.org/people/newlocknew/sounds/842498/) | CC BY 4.0 |
| `message.receive` (chat) | message-received.ogg | "Message Receive" | [Froey_](https://freesound.org/people/Froey_/) | [freesound.org/s/760369](https://freesound.org/people/Froey_/sounds/760369/) | CC0 |

## Token hop (`frontend/assets/sounds`)

The travelling-token hop is a CLIENT animation sound (`finger.ogg`), played by the renderer as a
fallback. A package MAY override it by shipping a themed `token.hop` event in its `assets/sounds/`
pack; the client uses the pack's cue when present and falls back to `finger.ogg` otherwise.

| Event | File | Sound | Author | Source | License |
|---|---|---|---|---|---|
| token hop (fallback) | finger.ogg | "FingerSnaps_03.wav" (trimmed to one snap) | [gblanke](https://freesound.org/people/gblanke/) | [freesound.org/s/265287](https://freesound.org/people/gblanke/sounds/265287/) | CC BY 3.0 |
