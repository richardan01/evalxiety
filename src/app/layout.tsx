import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { GuideAgent } from "@/components/guide/GuideAgent";

export const metadata: Metadata = {
  title: "AgentTrust — release readiness for AI agents",
  description: "Don't just build AI agents. Prove they're ready to ship.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <AppHeader />
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">{children}</main>
        <footer className="border-t border-slate-200 bg-white px-6 py-3 text-xs text-slate-500">
          AgentTrust evaluates a synthetic merchant-pricing scenario. Results describe a small prototype test set — they are
          not production certification and cannot establish production reliability.
        </footer>
        <GuideAgent />
      </body>
    </html>
  );
}
