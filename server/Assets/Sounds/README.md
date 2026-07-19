# Default sound pack

This is the bundled fallback sound pack served by `SoundsController`.

- `pack.json` maps logical game events (e.g. `dice.roll`) to audio file names.
- A value may be a single file name (`"dice.roll": "dice-roll.ogg"`) or an array of file
  names (`"money.pay": ["money-pay-1.ogg", "money-pay-2.ogg"]`); when several are given the
  client picks one at random each time the event fires.
- Drop the matching audio files (`.mp3`, `.ogg` or `.wav`) in this folder, named exactly
  as referenced in `pack.json`.
- Only files declared in `pack.json` are ever served; any event whose file is missing
  simply plays no sound (the game degrades gracefully).

Later, a `.corro` pack can ship its own `pack.json` + audio and override any subset of
these events; unspecified events keep falling back to the files here.
