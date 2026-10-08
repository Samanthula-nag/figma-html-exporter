import type { ExportWarning } from "../diagnostics/warnings";
export type Style = Record<string, string>;
export interface CoordinateReference {
  markerId: string;
  origin: { x: number; y: number };
  frameOffset: { x: number; y: number };
  width: number;
}
export interface Interaction {
  type: "url" | "navigate" | "back";
  target?: string;
}
export interface NodeModel {
  /** Original Figma layer; absent for plugin-created copies. */
  sourceId?: string;
  id: string;
  name: string;
  className: string;
  tag: string;
  text?: string;
  children: NodeModel[];
  style: Style;
  width: number;
  height: number;
  layout: "row" | "column" | "grid" | "free";
  asset?: string;
  interaction?: Interaction;
  component?: string;
  responsive: boolean;
  placement?: { x: number; y: number };
}
export interface Asset {
  path: string;
  bytes: Uint8Array;
  sourceId: string;
}
export interface PageModel {
  id: string;
  name: string;
  path: string;
  root: NodeModel;
  reference?: CoordinateReference;
}
export interface WebFont {
  family: string;
  weight: string;
  style: "normal" | "italic";
  dataUrl: string;
}
export interface DocumentModel {
  webFonts?: WebFont[];
  preserveGeometry?: boolean;
  diagnostics?: ExportWarning[];
  exportNotes?: string[];
  autoResponsive?: boolean;
  pages: PageModel[];
  assets: Asset[];
  fonts: string[];
  warnings: string[];
  source: string;
}
export type Files = Record<string, string | Uint8Array>;
