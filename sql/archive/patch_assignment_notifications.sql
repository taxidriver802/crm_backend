-- Allow lead and job assignment notifications.

ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
ADD CONSTRAINT notifications_type_check
CHECK (
  type IN (
    'TASK_DUE_SOON',
    'TASK_OVERDUE',
    'TASK_ASSIGNED',
    'TASK_COMPLETED',
    'FILE_UPLOADED',
    'INVITE_ACCEPTED',
    'ESTIMATE_CREATED',
    'ESTIMATE_STATUS_CHANGED',
    'ESTIMATE_CLIENT_RESPONDED',
    'INVOICE_CREATED',
    'INVOICE_STATUS_CHANGED',
    'INVOICE_PAID',
    'LEAD_CREATED',
    'LEAD_ASSIGNED',
    'JOB_ASSIGNED'
  )
);
