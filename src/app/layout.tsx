import type { Metadata } from "next";
import "./globals.css";
import { MockBanner, Sidebar } from "@/components/Sidebar";
import { GuideAgent } from "@/components/guide/GuideAgent";

export const metadata: Metadata = {
  title: "AgentTrust — release readiness for AI agents",
  description: "Don't just build AI agents. Prove they're ready to ship.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full font-sans">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MockBanner />
          <main className="mx-auto w-full max-w-7xl flex-1 px-8 py-7">{children}</main>
          <footer className="border-t border-slate-200 bg-white px-8 py-3 text-xs text-slate-500">
            Synthetic merchant-pricing scenario · results describe a small prototype test set, not production certification.
          </footer>
        </div>
        <GuideAgent />
      </body>
    </html>
  );
}
