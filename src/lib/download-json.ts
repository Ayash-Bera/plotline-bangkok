export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  let activated = false;
  try {
    document.body.appendChild(link);
    link.click();
    activated = true;
  } finally {
    link.remove();
    // A browser can resolve the download after activation returns.
    if (activated) setTimeout(() => URL.revokeObjectURL(url), 60_000);
    else URL.revokeObjectURL(url);
  }
}
