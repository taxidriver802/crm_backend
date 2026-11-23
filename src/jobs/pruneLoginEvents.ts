import { loginEventsKeepDays, pruneLoginEvents } from '../lib/loginEvents';

/**
 * Login history keeps LOGIN_EVENTS_KEEP_DAYS (default 180). Runs in the one
 * backend process, like the reminder sweeps, so a host needs no timer for it.
 */
export async function runLoginEventsPruneJob() {
  const keepDays = loginEventsKeepDays();
  const removed = await pruneLoginEvents({ keepDays });
  if (removed) {
    console.log(
      JSON.stringify({ level: 'info', event: 'login_events_pruned', removed, keep_days: keepDays })
    );
  }
}
