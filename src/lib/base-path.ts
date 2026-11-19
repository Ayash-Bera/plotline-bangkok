export function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const path = value.endsWith("/") ? value.slice(0, -1) : value;
  if (!/^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(path) || path.split("/").some(part => part === "." || part === "..")) {
    throw new Error("NEXT_PUBLIC_BASE_PATH must be an absolute path of simple URL segments.");
  }
  return path;
}

export const BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

export function assetPath(path: string, prefix = BASE_PATH): string {
  if (!/^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(path) || path.split("/").some(part => part === "." || part === "..")) {
    throw new Error("Asset paths must stay within the application.");
  }
  return `${normalizeBasePath(prefix)}${path}`;
}
