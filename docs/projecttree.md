.
├── assets
│   └── company-logos
│       └── rooftop-realty.png
├── crm_dev_backup.sql
├── docker-compose.yml
├── docs
│   ├── archive
│   │   ├── Crm_roadmap.md
│   │   └── v2_roadmap.md
│   ├── brand
│   │   ├── exploration-directions.png
│   │   ├── exploration-refinement.png
│   │   └── generated-icons.png
│   ├── build_plan_updated.md
│   ├── context.md
│   ├── crm_strategic_analysis_recommendations.md
│   ├── guide
│   │   ├── dev-testing-guide.md
│   │   ├── hosted-demo-seed.md
│   │   ├── realtor_testing_guide.md
│   │   └── using-the-crm.md
│   ├── projectHealthChecklist.md
│   ├── projecttree.md
│   ├── README.md
│   ├── session_context_deep.md
│   └── session_context_phase5.md
├── jest.config.js
├── package-lock.json
├── package.json
├── README.md
├── scripts
│   ├── help-articles.ts
│   ├── lib
│   │   ├── migrations.js
│   │   └── parse-pg-copy.js
│   ├── migrate.js
│   ├── seed-demo-data.js
│   └── seed-walkthrough-data.js
├── sql
│   ├── archive
│   │   ├── patch_assignment_notifications.sql
│   │   ├── patch_notifications_constraints.sql
│   │   ├── patch_phase10_notes.sql
│   │   ├── patch_phase12_invoicing.sql
│   │   ├── patch_phase12_saved_views.sql
│   │   ├── patch_phase12_team_visibility.sql
│   │   ├── patch_phase13_automation.sql
│   │   ├── patch_phase13_portal.sql
│   │   ├── patch_phase14_events.sql
│   │   ├── patch_phase15_status_aging.sql
│   │   ├── patch_phase16_communication.sql
│   │   ├── patch_phase17_quotes_photos.sql
│   │   ├── patch_phase18_acquisition_portal.sql
│   │   ├── patch_phase19_appointments_workload.sql
│   │   ├── patch_phase20_companies.sql
│   │   ├── patch_phase21_company_branding.sql
│   │   ├── patch_phase22_performance_history.sql
│   │   ├── patch_phase23_job_lifecycle_money.sql
│   │   ├── patch_phase24_workspace_preferences.sql
│   │   ├── patch_phase9.sql
│   │   └── schema_pre_baseline.sql
│   ├── migrations
│   │   ├── 0001_rooftop_realty_logo.sql
│   │   └── README.md
│   └── schema.sql
├── src
│   ├── app.ts
│   ├── config
│   │   └── env.ts
│   ├── db.ts
│   ├── integrations
│   │   └── abc
│   ├── jobs
│   │   ├── invoiceReminders.ts
│   │   └── taskNotifications.ts
│   ├── lib
│   │   ├── aging.ts
│   │   ├── authCookies.ts
│   │   ├── brand.ts
│   │   ├── companyLogo.ts
│   │   ├── companySlug.ts
│   │   ├── estimatePdf.ts
│   │   ├── helpGuide.ts
│   │   ├── intakeRateLimit.ts
│   │   ├── invite-email.ts
│   │   ├── invoicePdf.ts
│   │   ├── jobHealth.ts
│   │   ├── jobLifecycle.ts
│   │   ├── mailer.ts
│   │   ├── monogram.ts
│   │   ├── notifications.ts
│   │   ├── pdf-layout.ts
│   │   ├── print-theme.ts
│   │   ├── startHere.ts
│   │   ├── tenant.ts
│   │   └── upload.ts
│   ├── middleware
│   │   ├── auth.ts
│   │   ├── error.ts
│   │   ├── requireRole.ts
│   │   └── utils.ts
│   ├── routes
│   │   ├── abc.routes.ts
│   │   ├── auth.routes.ts
│   │   ├── automation.routes.ts
│   │   ├── company.routes.ts
│   │   ├── dashboard.routes.ts
│   │   ├── estimates.routes.ts
│   │   ├── estimateTemplates.routes.ts
│   │   ├── files.routes.ts
│   │   ├── help.routes.ts
│   │   ├── intake.routes.ts
│   │   ├── integrations.routes.ts
│   │   ├── invoices.routes.ts
│   │   ├── jobs.routes.ts
│   │   ├── leads.routes.ts
│   │   ├── notes.routes.ts
│   │   ├── notification.routes.ts
│   │   ├── portal.routes.ts
│   │   ├── preferences.routes.ts
│   │   ├── productMetrics.routes.ts
│   │   ├── publicCompanies.routes.ts
│   │   ├── publicEstimates.routes.ts
│   │   ├── quickbooks.routes.ts
│   │   ├── reports.routes.ts
│   │   ├── savedViews.routes.ts
│   │   ├── search.routes.ts
│   │   ├── tasks.routes.ts
│   │   └── users.routes.ts
│   ├── server.ts
│   ├── services
│   │   ├── automation.service.ts
│   │   ├── dashboard.service.ts
│   │   ├── estimateCalculations.ts
│   │   ├── estimates
│   │   ├── estimates.service.ts
│   │   ├── estimateTemplates.service.ts
│   │   ├── files.service.ts
│   │   ├── intake.service.ts
│   │   ├── invoices.service.ts
│   │   ├── jobActivity.service.ts
│   │   ├── jobMeasurements.service.ts
│   │   ├── jobs.service.ts
│   │   ├── leads.service.ts
│   │   ├── notes.service.ts
│   │   ├── notification.service.ts
│   │   ├── performanceHistory.service.ts
│   │   ├── portal.service.ts
│   │   ├── preferences.service.ts
│   │   ├── productEvents.service.ts
│   │   ├── quickbooks.service.ts
│   │   ├── reports.service.ts
│   │   ├── savedViews.service.ts
│   │   ├── search.service.ts
│   │   ├── tasks.service.ts
│   │   └── teamPerformance.service.ts
│   ├── utils
│   │   ├── appBase.ts
│   │   └── asyncHandler.ts
│   └── validators
│       ├── auth.schemas.ts
│       ├── company.schemas.ts
│       ├── estimateTemplates.schemas.ts
│       ├── files.schemas.ts
│       ├── intake.schemas.ts
│       ├── jobs.schemas.ts
│       ├── leads.schemas.ts
│       ├── notes.schemas.ts
│       ├── notification.schemas.ts
│       ├── preferences.schemas.ts
│       ├── savedViews.schemas.ts
│       ├── tasks.schemas.ts
│       └── users.schemas.ts
├── test
│   ├── assignment.visibility.test.ts
│   ├── auth-dashboard.test.ts
│   ├── authorization.integration.test.ts
│   ├── automation.integration.test.ts
│   ├── brand.test.ts
│   ├── companies.auth.test.ts
│   ├── companies.branding.test.ts
│   ├── companies.isolation.test.ts
│   ├── companies.schema.test.ts
│   ├── dashboard-actions.test.ts
│   ├── estimate-templates.integration.test.ts
│   ├── estimates-public.integration.test.ts
│   ├── estimates.integration.test.ts
│   ├── files.integration.test.ts
│   ├── fixtures
│   │   └── monogram-cases.json
│   ├── help.integration.test.ts
│   ├── helpers
│   │   ├── auth.ts
│   │   ├── db.ts
│   │   └── setup.ts
│   ├── intake.integration.test.ts
│   ├── invite-email.test.ts
│   ├── invoices.integration.test.ts
│   ├── job-lifecycle.integration.test.ts
│   ├── jobs.integration.test.ts
│   ├── notes.integration.test.ts
│   ├── notifications.integration.test.ts
│   ├── portal.integration.test.ts
│   ├── preferences.integration.test.ts
│   ├── reports.integration.test.ts
│   ├── savedViews.integration.test.ts
│   ├── setupAfterEnv.ts
│   ├── setupEnv.ts
│   ├── tasks.integrations.test.ts
│   └── users.integration.test.ts
├── tsconfig.jest.json
├── tsconfig.json
├── uploads
│   ├── 04058c49-0db7-46f3-9754-754a3d096f14
│   │   └── 1794294579488-0qftpo.png
│   ├── fb20a747-eb35-4433-bdff-9b87e30f1df9
│   │   └── 1794299308753-mdndfp.png
│   ├── qa-fixture-competing-bid.pdf
│   ├── qa-fixture-measurements.pdf
│   ├── qa-fixture-roof-ridge.png
│   └── qa-fixture-roof-south.png
└── users_backup.sql

30 directories, 193 files
