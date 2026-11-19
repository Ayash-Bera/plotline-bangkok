import type { CSSProperties } from "react";

export function Icon({ name, size = 18, style }: { name: string; size?: number; style?: CSSProperties }) {
  const paths: Record<string, React.ReactNode> = {
    layers: <><path d="m3 8 9-5 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    draw: <><path d="m4 17 2-10 12-3 3 13-10 4-7-4Z"/><path d="m9 13 7-6"/><path d="M8 16h3v-3"/></>,
    edit: <><path d="m14 5 5 5M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></>,
    reset: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></>,
    arrow: <><path d="M5 12h14m-5-5 5 5-5 5"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    book: <><path d="M12 5v16M3 4h5l4 2 4-2h5v15h-5l-4 2-4-2H3V4Z"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    target: <><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></>,
    building: <><path d="M5 21V3h14v18M3 21h18M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-3h4v3"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    external: <><path d="M14 3h7v7m0-7L10 14"/><path d="M10 3H3v18h18v-7"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name] || paths.info}</svg>;
}
