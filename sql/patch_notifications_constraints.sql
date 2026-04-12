
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_entity_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'TASK_DUE_SOON',
    'TASK_OVERDUE',
    'TASK_ASSIGNED',
    'TASK_COMPLETED',
    'FILE_UPLOADED',
    'INVITE_ACCEPTED',
    'ESTIMATE_CREATED',
    'ESTIMATE_STATUS_CHANGED'
  )
);

ALTER TABLE notifications ADD CONSTRAINT notifications_entity_type_check CHECK (
  entity_type IS NULL
  OR entity_type IN ('task', 'lead', 'job', 'invite', 'estimate')
);
