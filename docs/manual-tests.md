# Manual acceptance matrix

Import the development plugin and create small frames for each row, then analyze, preview, extract ZIP and compare in a browser. These are test instructions, not claims that every row has been manually passed.

| Fixture            | Construction and expected result                                      |
| ------------------ | --------------------------------------------------------------------- |
| Landing page       | Header, hero, cards, footer; readable hierarchy and external CSS      |
| Hero               | Heading, paragraph, image, CTA; compare spacing and crop              |
| Navigation         | Click URL and another exported root; keyboard-focusable links         |
| Cards              | Repeated styled frames; grouped CSS declarations                      |
| Buttons            | Name a layer Button; click BACK action; verify keyboard activation    |
| Forms              | Form-shaped artwork; static result, no invented submission            |
| Auto Layout        | Horizontal and vertical padding/gap/alignment; flex CSS               |
| Nested Auto Layout | Fill-width text and hug-height stacks; no collapsed widths            |
| Grid               | Fixed/flex/hug tracks with unequal gaps; native CSS Grid              |
| Images             | Leaf images with fill, fit, crop; rendered PNGs load                  |
| SVG                | Complex vector icon and grouped logo; external SVG quality            |
| Typography         | Multiple families, line heights, mixed spans; warnings on mixed spans |
| Components         | Three instances; correct visible content and shared styles            |
| Variants           | Component set; static variants and explicit diagnostic                |
| Responsive         | Wrapping cards at mobile/tablet/desktop; no desktop scaling           |
| Multiple pages     | Select Home and About roots; index/pages relative links               |
| Shadows            | Inner/drop shadows; compare radius, spread and offset                 |
| Gradients          | Linear gradient; approximation warning; unsupported fills reported    |
| Borders            | Uniform border and corner radius; compare geometry                    |
| Complex nesting    | Groups in freeform frames in Auto Layout; stable placement            |

Also test empty selection, missing fonts, unsupported node export failure, hidden nodes, ancestor+descendant selection, malicious layer names and URL schemes, repeat exports, and large designs. Verify error diagnostics prevent ZIP download where output validation fails.
