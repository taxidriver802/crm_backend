/**
 * The one link between the operator's approve and deny and the emails that
 * follow (PLAN_operator.md §7), like exportQueue.ts: the operator's code
 * calls companyDecided(); app.ts points it at the sign-up emails. The
 * operator's code never imports the mail code.
 */
export type CompanyDecision = {
  companyId: string;
  decision: 'approved' | 'denied';
  /** denied only: whether to email the owner. */
  notify?: boolean;
};

let listener: ((decision: CompanyDecision) => Promise<void> | void) | null = null;

export function onCompanyDecided(fn: (decision: CompanyDecision) => Promise<void> | void) {
  listener = fn;
}

/** Fire and forget: the decision is already committed. */
export function companyDecided(decision: CompanyDecision) {
  if (!listener) return;
  Promise.resolve()
    .then(() => listener?.(decision))
    .catch((error) => {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'company_decision_notice_failed',
          error: error instanceof Error ? error.message : String(error),
        })
      );
    });
}
