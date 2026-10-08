/** Counts source nodes, including descendants consolidated into one asset. */
import { isHierarchySquare } from "./hierarchy-reference";
export class AnalysisProgress {
  private children = new Map<string, string[]>();
  private completed = new Set<string>();

  constructor(roots: readonly SceneNode[]) {
    const visit = (node: SceneNode): void => {
      if (this.children.has(node.id)) return;
      const children =
        "children" in node
          ? node.children.filter(
              (child) => child.visible && !isHierarchySquare(child),
            )
          : [];
      this.children.set(
        node.id,
        children.map((child) => child.id),
      );
      children.forEach(visit);
    };
    roots.forEach(visit);
  }

  get total(): number {
    return this.children.size;
  }
  get count(): number {
    return this.completed.size;
  }

  complete(id: string): void {
    if (this.completed.has(id) || !this.children.has(id)) return;
    this.completed.add(id);
    // Covers vector groups and subtrees handled by an error fallback.
    this.children.get(id)!.forEach((child) => this.complete(child));
  }
}
