import { z } from 'zod';

export const DENSITIES = ['comfortable', 'compact'] as const;
export const DESKS = ['queue', 'money'] as const;
export const JOB_PANES = ['work', 'money', 'site', 'record'] as const;

export const updateWorkspaceSchema = z
  .object({
    density: z.enum(DENSITIES).optional(),
    desk: z.enum(DESKS).optional(),
    job_pane: z.enum(JOB_PANES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Choose a density, desk, or job pane',
  });

export type UiPreferences = {
  density: (typeof DENSITIES)[number];
  desk: (typeof DESKS)[number];
  job_pane: (typeof JOB_PANES)[number];
};

export function normalizeUiPreferences(value: unknown): UiPreferences {
  const raw =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const jobPane = JOB_PANES.includes(raw.job_pane as UiPreferences['job_pane'])
    ? (raw.job_pane as UiPreferences['job_pane'])
    : 'work';
  return {
    density: raw.density === 'compact' ? 'compact' : 'comfortable',
    desk: raw.desk === 'money' ? 'money' : 'queue',
    job_pane: jobPane,
  };
}
