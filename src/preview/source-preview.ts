import { withTimeout } from "../utils/timeout";

export interface SourcePreview {
  id: string;
  name: string;
  width: number;
  height: number;
  scale: number;
  bytes: Uint8Array;
}

/** Figma renders the whole frame, including its images, fonts and effects. */
export async function captureSource(node: SceneNode): Promise<SourcePreview> {
  const name = node.name;
  if (!("exportAsync" in node))
    throw new Error(
      `${name}: Figma cannot render this selection. Select its design frame.`,
    );
  const scale = Math.min(
    1,
    1920 / Math.max(node.width, 1),
    8192 / Math.max(node.height, 1),
  );
  const bytes = await withTimeout(
    node.exportAsync({
      format: "PNG",
      constraint: { type: "SCALE", value: scale },
    }),
    45000,
    `Capturing Figma design ${node.name}`,
  );
  if (!bytes.length)
    throw new Error(`${node.name}: Figma returned an empty design image.`);
  return {
    id: node.id,
    name: node.name,
    width: node.width,
    height: node.height,
    scale,
    bytes,
  };
}
