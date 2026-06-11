import type { Comment } from "../core/model";
import type { AiLensResult } from "../app/aiLens";

/**
 * "Scan this thread" — judge a bounded slice of a thread with AI Lens in one
 * deliberate tap. Roots first (highest leverage), by score, then top replies
 * if budget remains; already-judged and empty comments don't spend budget.
 * Sequential on purpose: one 355M forward pass at a time keeps peak memory
 * and thermals sane. Pure orchestration over an injected `check`, so the
 * whole flow tests without a model.
 */

export const THREAD_SCAN_CAP = 30;

export interface ThreadScanProgress {
  done: number;
  total: number;
}

export interface ThreadScanSummary {
  judged: number;
  /** Refused by the detector (too short to judge fairly). */
  tooShort: number;
  failed: number;
  cancelled: boolean;
}

export interface ThreadScanDeps {
  check: (text: string) => Promise<AiLensResult>;
  onVerdict: (commentId: string, result: AiLensResult) => void;
  /** True for comments that already carry a verdict (skipped, no budget). */
  alreadyJudged: (commentId: string) => boolean;
  cap?: number;
  shouldStop?: () => boolean;
  onProgress?: (p: ThreadScanProgress) => void;
}

/** The scan order: roots by score desc, then replies by score desc. */
export function scanCandidates(comments: Comment[], cap = THREAD_SCAN_CAP) {
  const usable = comments.filter((c) => (c.body.text ?? "").trim().length > 0);
  const byScore = (a: Comment, b: Comment) => (b.score ?? 0) - (a.score ?? 0);
  const roots = usable.filter((c) => !c.parentId).sort(byScore);
  const replies = usable.filter((c) => !!c.parentId).sort(byScore);
  return [...roots, ...replies].slice(0, cap);
}

export async function scanThreadComments(
  comments: Comment[],
  deps: ThreadScanDeps,
): Promise<ThreadScanSummary> {
  const cap = deps.cap ?? THREAD_SCAN_CAP;
  // Judged comments are filtered BEFORE the cap, so each scan judges the
  // next cap-sized batch — tapping the pill again digs deeper, it doesn't
  // re-tread the same top slice.
  const queue = scanCandidates(comments, Number.MAX_SAFE_INTEGER)
    .filter((c) => !deps.alreadyJudged(c.id))
    .slice(0, cap);
  const summary: ThreadScanSummary = {
    judged: 0,
    tooShort: 0,
    failed: 0,
    cancelled: false,
  };
  let done = 0;
  for (const comment of queue) {
    if (deps.shouldStop?.()) {
      summary.cancelled = true;
      break;
    }
    deps.onProgress?.({ done, total: queue.length });
    try {
      const result = await deps.check(comment.body.text ?? "");
      deps.onVerdict(comment.id, result);
      if (result.kind === "verdict") summary.judged++;
      else summary.tooShort++;
    } catch {
      summary.failed++;
    }
    done++;
  }
  deps.onProgress?.({ done, total: queue.length });
  return summary;
}
