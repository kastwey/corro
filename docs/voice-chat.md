# Voice chat

Corro can attach an optional, self-hosted LiveKit audio room to each game. LiveKit is an
SFU: every browser uploads one microphone stream to the relay and receives the other
players' streams. This avoids peer-to-peer mesh upload growth and supplies ICE/TURN for
hostile networks while preserving self-hosting.

Voice is a **platform capability**, not a package rule. Packages cannot enable it, name
it, branch on it or supply media behavior. A deployment with no LiveKit configuration
works exactly as before and renders no dead voice control.

## Product decisions

- The host can enable voice when creating a game or later from the in-game panel.
- Every player opts in separately. Joining is the consent boundary: it requests browser
  microphone permission and publishes **unmuted** immediately.
- Leaving voice does not leave the game. Turning voice off disconnects everyone from the
  LiveKit room but leaves text chat and gameplay untouched.
- Every listener controls each remote participant's volume locally. Values are persisted
  per game in that browser and never sent to the server.
- A host mute is a one-shot moderation action against the current microphone track. The
  target is told who muted them and may turn their microphone back on. Persistent removal
  belongs to a future player-kick feature, not a hidden sticky mute.
- There is no automatic ducking. Users can configure their screen reader or operating
  system according to preference.
- Spatial/stereo seating and push-to-talk are not part of this iteration.
- Corro does not record or transcribe voice. Media is encrypted in transit with WebRTC,
  but is not end-to-end encrypted against the SFU; the first-use notice says that it passes
  through the deployment's relay.

## Authority and data flow

```text
                         short-lived audio-only token
[Browser] ──SignalR────────────────────────────────────► [Corro server]
    │                                                        │
    │ WSS signaling + encrypted WebRTC audio                 │ Room Service
    ▼                                                        ▼
[Self-hosted LiveKit SFU + TURN] ◄──────────────────────── host mute / room delete
```

`GameDocument.VoiceChatEnabled` is the persisted authority. The active `GameState` carries
a public copy so every projected family receives it without exposing hidden game data. A
host change updates the document through `GameSessionRegistry`'s shared cache, updates the
live state and broadcasts `VoiceChatEnabledChanged`. This ordering prevents concurrent game
snapshots from restoring a stale switch.

`RequestVoiceToken` trusts neither client-supplied game nor player identifiers. It uses the
already authenticated SignalR connection, reloads the game, checks that voice and the game
are active, rejects bots, then mints a token whose:

- room is the game id;
- identity is the Corro player id;
- display name is the validated player name;
- grants permit room join, subscription and **microphone only** publishing;
- data publishing, camera and screen share are absent;
- lifetime defaults to five minutes (important because self-hosted LiveKit does not revoke
  an old token automatically).

The API key and secret remain server-side. `/api/config/voice` returns one availability
boolean. The relay URL is returned only alongside a short-lived authenticated join token.

`MuteVoiceParticipant` verifies the caller is the game host, the target is another human
player and voice is active. Room Service looks up the participant and mutes only tracks
whose type is audio and source is microphone. It then broadcasts
`VoiceParticipantMutedByHost` for visible and spoken feedback.

Deleting a game, ending a game or disabling voice attempts to delete the LiveKit room.
Relay failure is logged without breaking the authoritative game; short token lifetime and
client state bound any stale room access.

## Client and accessibility

`voiceTransport.ts` is the LiveKit boundary. The project still has no bundler: `build.js`
copies LiveKit's UMD distribution and `board.html` loads its `LivekitClient` global, while
TypeScript uses type-only imports. `voicePanel.ts` owns the native non-modal `<dialog>`,
detailed roster and controls. It projects read-only presence into the existing player panel,
so joining, muted microphones and active speakers remain visible while the dialog is closed.

The always-visible player cards show voice membership, muted state and an active-speaker
treatment. The dialog roster adds remote volume and host moderation. Speaking changes are
**visual only** continuously; screen readers get a snapshot only on request. This prevents a
flood of names from talking over the humans the player is trying to hear. Join/leave,
reconnection, permission errors, self mute and host mute are localized announcements;
join/leave also have earcons.

Shortcuts are part of the engine keymap and appear in Ctrl+F1 help:

| Shortcut | Action |
| --- | --- |
| Ctrl+Alt+V | Open or close voice controls |
| Ctrl+Alt+X | Mute or turn on the local microphone |
| Ctrl+Alt+A | Announce who is speaking now |

The active-speaker query is a read-only instant announcement and remains available in a
modal dialog. Voice controls never use the HTML `disabled` attribute; unavailable actions
remain focusable where feedback is useful and use `aria-disabled`.

## Configuration and operation

The server section is `LiveKit`:

- `Url`: secure browser WSS endpoint; loopback `ws://` is accepted only for local work.
- `ApiUrl`: HTTPS Room Service endpoint, optional when it can be derived from `Url`.
- `ApiKey` / `ApiSecret`: the relay key pair; server-side only.
- `TokenLifetimeMinutes`: 1–60, default 5.

An empty section disables voice. A partial or insecure non-loopback configuration fails
startup instead of exposing a broken control. See
[`../infra/livekit/README.md`](../infra/livekit/README.md) for the VPS Compose template,
ports, certificates and reverse proxy, and [deployment.md](deployment.md) for production
secret configuration.

## Tests

- xUnit decodes token claims, verifies endpoint privacy, filters microphone tracks, checks
  lobby persistence, authenticated identity, host authorization, one-shot mute and cleanup.
- Node tests cover permission errors, first-use notice, native dialog semantics, opt-in
  unmuted joining, presence, visual speakers, on-demand narration, volume persistence,
  reversible mute and global keyboard routing.
- `e2e/tests/voice.spec.ts` drives two browser contexts against the real server and SignalR.
  A deterministic E2E transport replaces only external media/SFU I/O; every reached state
  passes the automatic Axe monitor.