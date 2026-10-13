/** Type-only views of /api/overview and /api/mode (erased at build time). */
import type { overviewView } from "@/lib/services";

export type OverviewData = Awaited<ReturnType<typeof overviewView>>;

export interface ModeData {
  mode: "live" | "mock";
  reason: string;
  model_id: string;
  spend_cap_usd: number;
  ledger: { total_estimated_usd: number; live_calls: number };
}
