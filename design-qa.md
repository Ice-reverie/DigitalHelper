# Hospital scenes — design QA

Date: 2026-09-24

final result: passed

## Visual targets and evidence

Source directory: `C:/Users/18246/.codex/generated_images/01a0cd2b-c6e5-7110-bd93-0274925e5e06/`

| Scene | Source visual truth | Final implementation screenshot |
| --- | --- | --- |
| 门诊大厅 | `exec-a44591e1-8115-46b4-9b7c-101fdef00730.png` | `output/design-qa/outpatient-desktop-final.png` |
| 温馨候诊区 | `exec-2fbb50de-02f3-403e-a966-eb17ae8f776d.png` | `output/design-qa/waiting-desktop-final.png` |
| 智慧导诊 | `exec-39442c07-7dca-444f-9b1e-07e2d95c78b0.png` | `output/design-qa/guidance-desktop-final.png` |

Implementation URL: `http://127.0.0.1:8890/static/VRMCharacter.html?preview=hospital-3`

Desktop CSS viewport and source/implementation pixels: 1374 × 1145. Final desktop captures use equal pixel dimensions without rescaling. The combined source/implementation inputs are `output/design-qa/{outpatient,waiting,guidance}-comparison-final.png` (2748 × 1177, including a 32 px label strip). Each combined image was opened and visually reviewed. Focused controls comparisons are `output/design-qa/{outpatient,waiting,guidance}-controls-final.png`; the guidance controls were reviewed at full readable size.

State: selected hospital scene, actual default VRM character, initial production greeting, service controls. The design images include an illustrative user message and a shorter greeting; final screenshots retain the real application's initial state. Character framing was reset with “恢复全身” before the final outpatient capture after interactive zoom testing. A transient zoomed capture was replaced before acceptance.

Additional evidence: `scene-picker.png`, `tablet.png`, `mobile.png`, `mobile-large-final.png`, `mobile-small-large.png`, all under `output/design-qa/`. Responsive CSS viewports: 1024 × 768, 390 × 844 and 320 × 740. In-app mobile captures contained a 2/3 scale content region with unused canvas; raw screenshots are retained with `-raw.png`, and that region was cropped and normalized to the tested CSS viewport for visual review. DOM rectangles independently confirmed viewport width, header bounds, stage bounds and absence of horizontal overflow. Desktop comparisons did not use these normalized mobile captures.

## Findings and comparison history

1. **Resolved P2 — hard, clipped character shadow.** Initial waiting screenshot and `waiting-comparison.png` showed an elongated shadow cut off at the canvas edge. Raised the real Three.js key light, shortened its horizontal offset, reduced shadow map resolution for softness, and lowered shadow opacity. Final waiting/guidance comparisons show a contained soft projection behind the feet.
2. **Resolved P2 — mobile large-text header and connection label.** At 320 px, header buttons wrapped beyond the 64 px bar; a desktop maximum width also wrapped the connection label into the bubble area. Added a two-row 108 px header at narrow widths when large text is on, and removed the mobile intro width restriction. `mobile-small-large.png` and `mobile-large-final.png` show the corrected layout. DOM header top/bottom at 320 px are 51.38/95.38 within the 108 px bar; document scroll width equals viewport width.
3. **Resolved P2 — scene-specific panel treatment and microphone hierarchy.** Initial focused guidance comparison showed weak scene identity in the panel and a small microphone. Added the cyan glass rim, a warmer rounded waiting panel and pill-shaped waiting voice button, increased heading and microphone size. Final guidance controls comparison verifies these changes.

There are no remaining actionable P0/P1/P2 findings.

## Required fidelity surfaces

- **Fonts/typography:** Microsoft YaHei/PingFang system Chinese stack, 18 px base, clear bold headings, 22 px large-text mode. Production body copy is intentionally longer than the illustrative mock. Greeting and long database replies scroll inside their bubbles; no text is deleted to fit the design. Source artwork's apparent font weights are approximated with real system fonts rather than rasterized text.
- **Spacing/layout:** Preserved header, left dialogue, central real 3D character and right service panel. Rounded surfaces, spacing, soft elevation and button press feedback follow the selected directions. Phone layout keeps conversation above the avatar and controls below it. Long appointment option lists have independent scrolling. Tablet control panel remains fully within the viewport.
- **Colors/tokens:** Blue/white, sage/warm white and aqua/white scenes have independent text, surface, border and action colors. Dark text and nearly opaque reading surfaces remain legible against busy hospital architecture. Active scene buttons have both a border/check and an accessible pressed state.
- **Image quality/assets:** Three original 1448 × 1086 generated hospital images are locally served. Live avatar/UI are separate layers; background cropping and slow parallax are intentional dynamic adaptations. The actual VRM character and realtime lighting differ from the rendered illustrative character. Icons are unmodified local Bootstrap Icons with the upstream MIT license. No hospital data is encoded into the scenery as application facts.
- **Copy/content:** Existing business wording and medical/demo boundaries remain. Settings describe the three scenes, loading/failure states and reduced motion. Source-specific marketing text was not added over the actual hospital scene. README identifies the hospital environment as 2.5D imagery and the avatar as realtime 3D; the environment is not a walkable model.

## Interaction and regression verification

- In-app browser: selected all three scenes; verified matching theme and pressed state, scene persistence after refresh, working settings dialog and return control.
- Started a SQLite appointment, changed hospital scene, continued selecting 内科 and saw the correct date/slot choices. Cancelled the test flow successfully; no new booking was confirmed.
- Background DOM transform changed over time in normal mode. “减少动态” returned transform/brightness to neutral and remained stationary during further scene interactions. Returning to normal mode restores ambience; system reduced-motion preference is respected at startup.
- Checked 390 px mobile, 320 px large text, 1024 px tablet and 1374 px desktop. All required controls remain reachable, and mobile long content scrolls. Temporary viewport override was reset at handoff.
- Browser console errors: none. Existing three-vrm deprecation warning for `removeUnnecessaryJoints` remains unrelated to these changes.
- Node: 70/70 passed (60 existing frontend cases + 10 scene selection/motion cases). Covers failed/retried loads, stale concurrent results, stale restoration versus explicit selection, blocked preference storage, and motion limits.
- Python: 70/70 passed.
- `git diff --check`: passed. Changes stay on current branch; `docs/` and the original untracked Blender file were preserved.

## Remaining test limits / follow-up polish

- Screenshots verify visual states, while DOM pose observations and unit tests verify environmental movement. No video recording or low-end-device frame-time benchmark was produced.
- Real microphone input, all nine avatar appearances, and external TTS providers were not exhaustively retested for this visual change. Existing automated voice/avatar regression cases passed.
- Hospital environment remains image-based 2.5D. Full room geometry, spatial navigation and geometrically correct room reflections would be a separate feature.

## Implementation checklist

- [x] Three scene choices in existing demo settings and browser persistence.
- [x] Load-before-commit, retry, stale request protection and failure messages.
- [x] Live parallax, gentle ambient lighting, VRM shadow and scene-specific theme.
- [x] Reduced motion, hidden-tab pause and responsive/large-text checks.
- [x] Source/implementation visual comparison, fixes, recapture and final review.
- [x] Tests, README and asset provenance.
