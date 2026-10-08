import { parse, walk, lexer } from "css-tree";
export function validateCss(css: string): string[] {
  const errors: string[] = [];
  try {
    const ast = parse(css, {
      onParseError: (error) => errors.push(error.message),
    });
    walk(ast, function (node) {
      if (node.type === "Declaration" && !node.property.startsWith("--")) {
        const match =
          this.atrule?.name === "font-face"
            ? lexer.matchAtruleDescriptor(
                "font-face",
                node.property,
                node.value,
              )
            : lexer.matchProperty(node.property, node.value);
        if (match.error && !match.error.message.includes("var("))
          errors.push(match.error.message);
      }
    });
  } catch (error) {
    errors.push(String(error));
  }
  return errors;
}
