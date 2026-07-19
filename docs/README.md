# Corro Online — architecture docs

How the whole thing is built, for people who want to work on it. These are **prose
explanations**, not a line-by-line reference: enough to understand how a piece fits and
where to look, without reading every file first.

Start with [architecture.md](architecture.md) for the 10,000-foot view, then follow your
interest.

## The map

| Doc | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | The big picture: the three parts (client / server / package), the authoritative-server rule, the tech stack, how a turn travels end to end. |
| [client.md](client.md) | The frontend: vanilla TypeScript, no bundler; how it's organized, how it renders, how it sends commands and receives state, the sound layer. |
| [accessibility.md](accessibility.md) | The heart of the project: the server-owned spoken voice, the live regions and the composed-line doctrine, dialogs, focus, the accessible hand, earcons. Read this even if you only touch the server — it constrains everything. |
| [server.md](server.md) | The backend: the SignalR hub, the command pipeline, the rulebooks, the game-family registry, hidden-information projection, persistence and bots. |
| [game-families.md](game-families.md) | What a "family" is, what the families share and what they deliberately don't, and the design decisions about what to unify (and what NOT to — with the reasoning). |
| [flows.md](flows.md) | Concrete end-to-end walkthroughs: playing a card, starting a game, a bot's turn, reconnecting after a restart. Follow one event from a keypress to the screen reader. |
| [deployment.md](deployment.md) | Production delivery to `imperio.kastwey.org`: the CI gate, passwordless GitHub OIDC setup, smoke checks and rollback. |
| [tutorial-city-board.md](tutorial-city-board.md) | **For content creators (no code):** a do-it-with-me guide to building a full 40-square property board of *your own city* as a package. |

## Who is this for? (two audiences, two doc sets)

There are two very different kinds of contributor, and they need different docs:

1. **Engine contributors** — people who add a game family, fix the server or client, or
   work on the platform itself. **These docs are for you.** They assume you'll read code;
   they explain the shapes and flows so you know *which* code.

2. **Package / content creators** — people who make new games as **data** (a theme, a
   deck, a board), without touching code. **These docs are NOT your entry point.** Start
   with the hands-on [tutorial-city-board.md](tutorial-city-board.md) (build a board of
   your own city, step by step), then keep [`../CORRO_FORMAT.md`](../CORRO_FORMAT.md)
   — the `.corro` format spec — as your reference for every field. Neither mentions
   SignalR or projection, because a package author never touches the wire.

Keeping the two sets separate is deliberate: the depth gap is huge. A package author
would drown in the SignalR flow; an engine contributor needs exactly that. One document
serving both would fail both.

## Ground rules that outrank everything (see [accessibility.md](accessibility.md))

- **The server owns the spoken voice.** Game events are announced from server rules, not
  invented by the client.
- **Accessibility is not a feature, it is the product.** Every rule below exists to make
  a screen-reader game excellent: native `<dialog>`, never the `disabled` attribute,
  one flowing spoken sentence per event, the visual layer stays `aria-hidden`.
- **Every change ships with tests**, in all layers it touches.

The contribution requirements are summarized in
[`../CONTRIBUTING.md`](../CONTRIBUTING.md). These docs explain the architectural *why*
and *how* behind them.
