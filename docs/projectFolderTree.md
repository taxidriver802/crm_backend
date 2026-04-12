.
├── sql
│   └── schema.sql
├── src
│   ├── config
│   │   └── env.ts
│   ├── integrations
│   │   └── abc
│   │       ├── abc.client.ts
│   │       ├── abc.config.ts
│   │       ├── abc.mappers.ts
│   │       ├── abc.schemas.ts
│   │       ├── abc.service.ts
│   │       ├── abc.types.ts
│   │       └── abc.webhooks.ts
│   ├── jobs
│   │   └── taskNotifications.ts
│   ├── lib
│   │   ├── invite-email.ts
│   │   ├── mailer.ts
│   │   ├── notifications.ts
│   │   └── upload.ts
│   ├── middleware
│   │   ├── auth.ts
│   │   ├── error.ts
│   │   └── utils.ts
│   ├── routes
│   │   ├── abc.routes.ts
│   │   ├── auth.routes.ts
│   │   ├── dashboard.routes.ts
│   │   ├── estimates.routes.ts
│   │   ├── files.routes.ts
│   │   ├── integrations.routes.ts
│   │   ├── jobs.routes.ts
│   │   ├── leads.routes.ts
│   │   ├── notification.routes.ts
│   │   ├── tasks.routes.ts
│   │   └── users.routes.ts
│   ├── services
│   │   ├── estimates (empty placeholders potentially for future)
│   │   │   ├── estimatePdf.service.ts
│   │   │   └── estimateTemplate.service.ts
│   │   ├── dashboard.service.ts
│   │   ├── estimates.service.ts
│   │   ├── files.service.ts
│   │   ├── jobActivity.service.ts
│   │   ├── jobs.service.ts
│   │   ├── leads.service.ts
│   │   ├── notification.service.ts
│   │   └── tasks.service.ts
│   ├── utils
│   │   ├── appBase.ts
│   │   └── asyncHandler.ts
│   ├── validators
│   │   ├── auth.schemas.ts
│   │   ├── jobs.schemas.ts
│   │   ├── leads.schemas.ts
│   │   ├── notification.schemas.ts
│   │   ├── tasks.schemas.ts
│   │   └── users.schemas.ts
│   ├── app.ts
│   ├── db.ts
│   └── server.ts
├── test
│   ├── helpers
│   │   ├── auth.ts
│   │   ├── db.ts
│   │   └── setup.ts
│   ├── auth-dashboard.test.ts
│   ├── estimates.integration.test.ts
│   ├── files.integration.test.ts
│   ├── jobs.integration.test.ts
│   ├── notifications.integration.test.ts
│   ├── setupAfterEnv.ts
│   ├── setupEnv.ts
│   └── tasks.integrations.test.ts
├── uploads
├── README.md
├── cookies.txt
├── crm_dev_backup.sql
├── docker-compose.yml
├── jest.config.js
├── package-lock.json
├── package.json
├── projectFolderTree.md
├── tsconfig.jest.json
├── tsconfig.json
└── users_backup.sql

17 directories, 71 files
