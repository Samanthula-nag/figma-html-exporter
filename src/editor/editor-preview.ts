import { editorRuntime, type EditorConfig } from "./runtime";
export function editablePreview(html: string, config: EditorConfig): string {
  const safeConfig = JSON.stringify(config).replace(/</g, "\\u003c");
  // Only our nonce-bearing editor script can execute. Exported site scripts stay stripped.
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'nonce-${config.token}';">`;
  return html
    .replace("<head>", `<head>${csp}`)
    .replace(
      "</body>",
      `<script nonce="${config.token}">(${editorRuntime.toString()})(${safeConfig});</script></body>`,
    );
}
