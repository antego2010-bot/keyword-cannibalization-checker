import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Keyword Cannibalization Checker",
  description: "Find keyword cannibalization with Moz API data and decide what to create, refresh or merge with Claude.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
