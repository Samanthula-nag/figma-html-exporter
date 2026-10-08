# Verified API surface

Checked against the official `@figma/plugin-typings` package, version 1.139.0, and official documentation on 2026-09-25. The shipped plugin uses official APIs, not the Figma connector's convenience methods such as `query` or `screenshot`.

| Data                  | API used                                                                                        | Limit                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Document/current page | `figma.currentPage`, `PageNode.loadAsync`, `selection`, `children`                              | Only current page; top-level roots interpreted as website pages  |
| Geometry and layout   | `width`, `height`, `x`, `y`, `layoutMode`, sizing/alignment/padding/gap properties, Grid tracks | Coordinates retained for freeform layouts                        |
| Visual styling        | `fills`, `strokes`, `effects`, `cornerRadius`, `opacity`, `rotation`, `clipsContent`            | Complex paints/effects not fully mapped                          |
| Text                  | `characters`, `getStyledTextSegments`, `textAlignHorizontal`                                    | Mixed styling downgraded with diagnostics                        |
| Assets                | `exportAsync({format:'SVG'})`, `exportAsync({format:'PNG',constraint:{type:'SCALE',value:2}})`  | Raster leaf exports preserve crop but cannot recover editability |
| Components            | `type`, static children                                                                         | Instance appearance resolved from the instance itself            |
| Variables             | `boundVariables`, resolved paint/layout values                                                  | Alternate modes and variable names not emitted                   |
| Prototypes            | `reactions`, `actions`, click trigger, URL/NODE/BACK                                            | Unsupported actions warn and retain static design                |
| UI                    | `showUI`, `ui.onmessage`, `ui.postMessage`                                                      | Website preview and ZIP download live in UI iframe               |
| Fonts                 | Segment font family/style/weight                                                                | No API for redistributing font binaries                          |

Official references: [node properties](https://developers.figma.com/docs/plugins/api/node-properties/), [FrameNode](https://developers.figma.com/docs/plugins/api/FrameNode/), [async export](https://developers.figma.com/docs/plugins/async-tasks/), [official typings](https://github.com/figma/plugin-typings).

The browser DOM also defines a global `Navigation` type. The reader compares prototype navigation via `String(action.navigation)` to avoid that naming collision in the shared TypeScript compilation. Runtime action values remain the documented Figma navigation enum.
