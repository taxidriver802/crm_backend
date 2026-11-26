/**
 * The one link between a company's account changes and what follows them
 * (PLAN_operator.md §3, §7), like exportQueue.ts: the operator's code and
 * the lifecycle job call companyChanged() and companyDeleted(); app.ts points
 * them at the emails and the file clean-up. The operator's code never
 * imports the mail code or the export builder.
 */
export type CompanyChange = {
  companyId: string;
  from: string;
  to: string;
  /** Who moved it: the operator, or the lifecycle timer. */
  by: 'operator' | 'timer';
  /** denied only: whether to email the owner. */
  notify?: boolean;
  /** The new state's timer, for "read-only on {date}" and the like. */
  nextStatusAt?: Date | null;
};

/** What is left to do once a company's rows are gone. */
export type CompanyDeletion = {
  companyId: string;
  name: string;
  slug: string;
  /** Its export archives, removed from disk. */
  exportIds: string[];
  /** Who hears that it was deleted: billing_email, else the owner. */
  to: string | null;
  firstName: string | null;
  paletteId: string | null;
  markId: string | null;
};

type Listener<T> = ((value: T) => Promise<void> | void) | null;

let changed: Listener<CompanyChange> = null;
let deleted: Listener<CompanyDeletion> = null;

export function onCompanyChanged(fn: Listener<CompanyChange>) {
  changed = fn;
}

export function onCompanyDeleted(fn: Listener<CompanyDeletion>) {
  deleted = fn;
}

function fire<T>(listener: Listener<T>, value: T, event: string): Promise<void> {
  if (!listener) return Promise.resolve();
  return Promise.resolve()
    .then(() => listener(value))
    .catch((error) => {
      console.error(
        JSON.stringify({
          level: 'error',
          event,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    });
}

/**
 * After the commit. The returned promise never rejects; the operator's
 * routes don't wait for it, the lifecycle job does (so a run's emails are
 * out before it reports).
 */
export function companyChanged(change: CompanyChange): Promise<void> {
  return fire(changed, change, 'company_change_notice_failed');
}

export function companyDeleted(deletion: CompanyDeletion): Promise<void> {
  return fire(deleted, deletion, 'company_deleted_cleanup_failed');
}
