import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plotline | Bangkok site feasibility",
  description: "Explore a Bangkok plot, its development envelope and two source-linked concept designs.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
