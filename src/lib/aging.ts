export function daysInStatus(
  statusChangedAt: Date | string | null | undefined
): number {
  if (!statusChangedAt) return 0;
  const time = new Date(statusChangedAt).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}
