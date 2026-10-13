/**
 * Paragraph-level diff of two prompts (paragraphs separated by blank lines).
 * Unchanged paragraphs are aligned side by side; adjacent removals/insertions
 * are paired into one "changed" row so a replaced paragraph reads left→right.
 */
export interface DiffRow {
  left: string | null;
  right: string | null;
  changed: boolean;
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function paragraphDiff(a: string, b: string): DiffRow[] {
  const A = splitParagraphs(a);
  const B = splitParagraphs(b);
  const n = A.length;
  const m = B.length;
  // LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    const len = Math.max(removed.length, added.length);
    for (let k = 0; k < len; k++) rows.push({ left: removed[k] ?? null, right: added[k] ?? null, changed: true });
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      flush();
      rows.push({ left: A[i], right: B[j], changed: false });
      i++;
      j++;
    } else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) {
      removed.push(A[i]);
      i++;
    } else {
      added.push(B[j]);
      j++;
    }
  }
  flush();
  return rows;
}
