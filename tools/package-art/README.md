# Package art generator

The token icons (`assets/tokens/<id>.svg`) and card illustrations (`assets/cards/<id>.svg`) of
the shipped packages are **generated** from drawing scenes in this folder, so a picture can be
tuned and regenerated instead of hand-edited. The SVG files in the packages remain the canonical
assets the engine reads; this tool only writes them.

```bash
cd tools/package-art
npm ci
node build.mjs scenes/four-colours.mjs                         # preview only → preview/four-colours.png
node build.mjs scenes/four-colours.mjs --write                 # write server/Packages/four-colours/assets/…
node build.mjs scenes/four-colours.mjs --write --out ../../server/Packages/uno   # a package that shares the art
node build.mjs ../../../corro-hidden-packages/art/classic-virus.mjs --write      # a hidden package's scene
node build.mjs scenes/the-mine.mjs --no-preview --write        # without the Playwright screenshot
npm test
```

The preview sheet renders every token on player-colour chips at 13 px and 26 px (as on the board)
and on light and dark surfaces, and every card on its paper with the card's `artColor` as
`currentColor`; look at it in both before writing. The screenshot needs the Playwright browser
the E2E suite installs (`e2e/node_modules`); `--no-preview` writes only the HTML page.

## Scenes

A scene is an ES module that exports the package `id` and a default function receiving the
drawing API and returning `{ cards, tokens }`, each an object of `id → drawing` (an array of
elements). Public packages keep their scenes in `scenes/`; a hidden package keeps its scene in
the private repository (`art/<id>.mjs`) and is built the same way. Two packages that share art
(`classic-spain`/`modern-spain`, `four-colours`/`uno`) share one scene and differ only in `--out`.

```js
export const id = 'my-board';
export default function (art) {
	const { C, R, Ln, G, T, dark } = art;
	return {
		tokens: { ufo: [R(2, 12, 20, 6, 3), C(12, 9, 5, { fill: '#9be7ff' })] },
		cards: { c1: [C(32, 32, 26, { fill: '#f4d35e', stroke: dark('#f4d35e'), sw: 2.2 })] },
	};
}
```

The API (`api.mjs`) merges three modules:

- `draw.mjs` — the SVG elements the engine's art subset allows (`C` circle, `E` ellipse, `R`
  rect, `P` path, `Ln` line, `L` polyline/polygon, `G` group, `Curve` smooth path, `Arc`), transform
  builders `T`, and colour helpers (`dark`, `light`, `shade`, `flat`). Attribute shorthands:
  `fill`, `stroke`, `sw` (stroke-width), `cap`, `join`, `opacity`, `fo`/`so` (fill/stroke opacity),
  `dash`, `rule`, `transform`.
- `lib.mjs` — polygon geometry with real boolean operations (`union`, `diff`, `inter`) for shapes
  that need holes or merged outlines; `S(shape, attrs)` emits the result as one path.
- `pictos.mjs` and `motifs.mjs` — shared pictograms (coins, buildings, arrows, digits, vehicles,
  organs…) in the house style: flat fill, darker outline, small highlight.

Canvases are fixed by the format: tokens draw on 24×24, cards on 64×64. Keep a token's main
silhouette **unfilled** (it takes `currentColor`, white on the board's player-colour chip) and use
fixed colours only for small accents; cards sit on a light paper and may use full colour, with
`currentColor` taking the card's accent. Every emitted attribute belongs to the engine's SVG art
subset (`CORRO_FORMAT.md`), and `npm test` checks that for every scene.

After writing, validate the package (`corro-package validate server/Packages/<id>`), look at the
preview in both themes, and run the usual gates.
