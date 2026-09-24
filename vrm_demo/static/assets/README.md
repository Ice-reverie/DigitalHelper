# Hospital scene assets

- `scenes/outpatient.png`, `scenes/waiting.png`, `scenes/guidance.png`: generated for this project from the three hospital directions selected during design exploration (2026-09-24). Original PNGs, 1448 × 1086. They depict fictional architecture, contain no patient records, and are used as visual scenery rather than factual hospital guidance.
- The live VRM character, dialogue and controls are rendered separately. Scene motion, crossfades and pointer parallax are implemented in `../js/hospital-scenes.js`.
- `icons/*.svg`: unmodified Bootstrap Icons 1.13.1, from <https://github.com/twbs/icons/tree/v1.13.1/icons>. The upstream MIT license is included at `icons/LICENSE`. CSS masks apply the current scene color to these locally served icons.
