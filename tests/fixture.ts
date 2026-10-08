import type { DocumentModel, NodeModel } from "../src/ir/types";
let sequence = 0;
function node(
  name: string,
  tag: string,
  style: Record<string, string>,
  children: NodeModel[] = [],
  text?: string,
): NodeModel {
  return {
    id: String(++sequence),
    name,
    className: `fixture-${sequence}`,
    tag,
    style,
    children,
    text,
    width: 280,
    height: 80,
    layout:
      style["flex-direction"] === "row"
        ? "row"
        : style.display === "flex"
          ? "column"
          : "free",
    responsive: style.display === "flex",
  };
}
export function complexFixture(): DocumentModel {
  sequence = 0;
  const text = (name: string, tag: string, value: string, size = 16) =>
    node(
      name,
      tag,
      {
        "font-family": "Arial, sans-serif",
        "font-size": `${size}px`,
        "line-height": "1.5",
        color: "#17243b",
      },
      [],
      value,
    );
  const image = node("Landscape image", "img", {
    width: "100%",
    height: "120px",
    "object-fit": "cover",
    "border-radius": "12px",
  });
  image.asset = "assets/svg/landscape.svg";
  const cards = [1, 2, 3].map((i) => {
    const card = node(
      `Card ${i}`,
      "article",
      {
        display: "flex",
        "flex-direction": "column",
        gap: "12px",
        padding: "24px",
        width: "280px",
        background: "#ffffff",
        "border-radius": "16px",
        "box-shadow": "0 8px 24px rgba(0,0,0,0.08)",
      },
      [
        text("Card title", "h2", `Thoughtful detail ${i}`, 22),
        text(
          "Description",
          "p",
          "A flexible card with shared typography and a clear hierarchy.",
        ),
      ],
    );
    card.component = "INSTANCE";
    return card;
  });
  const cta = node(
    "Button",
    "button",
    {
      padding: "12px 20px",
      background: "#365eea",
      color: "white",
      border: "0",
      "border-radius": "8px",
    },
    [],
    "Explore details",
  );
  cta.interaction = { type: "navigate", target: "about" };
  const hero = node(
    "Hero",
    "section",
    {
      display: "flex",
      "flex-direction": "column",
      gap: "24px",
      padding: "32px",
      background: "linear-gradient(135deg, #e1e9ff, #f4e4ff)",
      "border-radius": "20px",
    },
    [
      text("Headline", "h1", "Make room for better ideas.", 48),
      text(
        "Introduction",
        "p",
        "An independent website built from a structured design.",
      ),
      image,
      cta,
    ],
  );
  const navigation = node(
    "Navigation",
    "nav",
    { display: "flex", "flex-direction": "row", gap: "24px", padding: "20px" },
    [text("Brand", "p", "STUDIO / 01", 22)],
  );
  const root = node(
    "Landing page",
    "main",
    {
      display: "flex",
      "flex-direction": "column",
      gap: "32px",
      padding: "24px",
      width: "100%",
      "max-width": "1100px",
      "margin-inline": "auto",
      background: "#f5f7fb",
    },
    [
      navigation,
      hero,
      node(
        "Cards",
        "section",
        { display: "flex", "flex-direction": "row", gap: "24px" },
        cards,
      ),
      text("Footer", "footer", "Built with care. Exported as plain web files."),
    ],
  );
  root.width = 1100;
  const about = node("About", "main", { padding: "32px" }, [
    text("About heading", "h1", "About the studio", 36),
  ]);
  about.id = "about";
  const back = node("Back", "button", {}, [], "Go back");
  back.interaction = { type: "back" };
  about.children.push(back);
  return {
    source: "Complex integration fixture",
    pages: [
      { id: root.id, name: "Studio", path: "index.html", root },
      { id: "about", name: "About", path: "pages/about.html", root: about },
    ],
    assets: [
      {
        sourceId: image.id,
        path: image.asset,
        bytes: new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="120"><rect width="900" height="120" fill="#aac0fa"/><circle cx="700" cy="60" r="90" fill="#657ada"/></svg>',
        ),
      },
    ],
    fonts: ["Arial"],
    warnings: [
      "Synthetic fixture: live Figma execution requires manual verification.",
    ],
  };
}
