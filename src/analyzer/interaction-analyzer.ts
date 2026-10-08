import type { Interaction } from "../ir/types";
import { safeUrl } from "../utils/naming";
export function interaction(
  node: SceneNode,
  warnings: string[],
): Interaction | undefined {
  if (!("reactions" in node)) return;
  let result: Interaction | undefined;
  for (const reaction of node.reactions) {
    for (const action of reaction.actions ??
      (reaction.action ? [reaction.action] : [])) {
      if (reaction.trigger?.type !== "ON_CLICK" || result) {
        warnings.push(
          `${node.name}: unsupported trigger or additional action; static appearance retained.`,
        );
        continue;
      }
      if (action.type === "URL" && safeUrl(action.url))
        result = { type: "url", target: action.url };
      else if (
        action.type === "NODE" &&
        String(action.navigation) === "NAVIGATE" &&
        action.destinationId
      ) {
        result = { type: "navigate", target: action.destinationId };
        if (action.transition)
          warnings.push(
            `${node.name}: prototype transition is not reproduced.`,
          );
      } else if (action.type === "BACK") result = { type: "back" };
      else
        warnings.push(
          `${node.name}: ${action.type} interaction is unsupported; static appearance retained.`,
        );
    }
  }
  return result;
}
