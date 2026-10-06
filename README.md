# Rubik's Snake Visualizer

A local, offline 3D visualizer for Rubik's Snake puzzle figures, built from
the figure catalog and notation documented at
[thomas-wolter.de](http://thomas-wolter.de/rubik_easy_en.html).

- 260 figures across four galleries: Easy, Hard, From Manuals, Fans & Friends
- Each figure renders as a real 24-wedge chain solved via forward kinematics
  (not a canned animation) - any valid notation string can be rendered
- Step through a figure's notation instruction by instruction, or play the
  full build animation, with draggable orbit camera and three color themes
- A "Notation Guide" tab explains the `<piece><L|R><position>` notation and
  lets you try individual hinge positions interactively
- Paste any custom notation string into the "Load custom notation" field

Built by Claude Sonnet 5.

## Running it

Try out the version [hosted here on github](https://doranchak.github.io/rubiks-snake).

To run locally:

Browsers block ES module imports (`import`/`export`) from `file://` URLs, so
serve the folder over plain HTTP:

```bash
cd rubiks-snake
python3 -m http.server 8000
```

Then open <http://localhost:8000> in a browser.

Any other static file server (`npx serve`, VS Code's Live Server, etc.) works
equally well - no build step, no dependencies to install.

## Project layout

```
index.html              entry page
css/style.css            UI styling
js/
  notation.js             notation string parser (23 joints, L/R quirk, step list)
  snakeGeometry.js         24-wedge geometry + forward-kinematics solver
  animator.js              step/play controller, tweens one joint at a time
  catalog.js                figure catalog loading + grid/search UI
  main.js                   Three.js scene setup and app wiring
vendor/three/             vendored Three.js r160 + OrbitControls (offline, no CDN)
data/figures.json          260 figures with title/notation/category/thumbnail
img/figures/               thumbnail images per figure, plus notation-guide demo images
```

## Credits

All figures, notation and photography originate from Thomas Wolter's site and
its contributors (figures by Victor Stok and community submissions). This
project only adds a local renderer/animator on top of that public data; see
the in-app footer and Notation Guide for links back to the source.
