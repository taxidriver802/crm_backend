/**
 * The one link between the operator's approval and the export builder.
 * The operator's code calls exportApproved(); app.ts points it at the
 * builder. That keeps the builder, which reads every record a company has,
 * out of everything the operator's code imports.
 */
let listener: (() => void) | null = null;

export function onExportApproved(fn: () => void) {
  listener = fn;
}

export function exportApproved() {
  listener?.();
}
