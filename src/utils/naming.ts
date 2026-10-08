export function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "layer"
  );
}
export class Names {
  private used = new Set<string>();
  get(value: string): string {
    const base = /^[a-z]/.test(slug(value))
      ? slug(value)
      : `layer-${slug(value)}`;
    let name = base,
      i = 2;
    while (this.used.has(name)) name = `${base}-${i++}`;
    this.used.add(name);
    return name;
  }
}
export const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const safeUrl = (value: string): boolean =>
  /^(https?:|mailto:|tel:)/i.test(value) && !/[\u0000-\u0020]/.test(value);
