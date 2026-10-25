"use client";

import { useEffect, useState } from "react";
import { getJSON } from "@/lib/client/api";
import type { DefinitionView } from "../types";

/**
 * The agent's editable definition (rules, AI reviewer question, test cases). Refetched when `refreshKey` changes, i.e.
 * after a person changes something, not on the 2-second poll while a test runs, so open forms aren't disturbed.
 */
export function useDefinition(agentId: string, refreshKey: number): { def: DefinitionView | null; error: string | null } {
  const [state, setState] = useState<{ def: DefinitionView | null; error: string | null }>({ def: null, error: null });
  useEffect(() => {
    let alive = true;
    getJSON<DefinitionView>(`/api/agents/${agentId}/definition`)
      .then((def) => alive && setState({ def, error: null }))
      .catch((e: unknown) => alive && setState((s) => ({ def: s.def, error: e instanceof Error ? e.message : String(e) })));
    return () => {
      alive = false;
    };
  }, [agentId, refreshKey]);
  return state;
}
