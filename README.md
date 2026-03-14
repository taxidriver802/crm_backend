# Realtor CRM — Backend API

Backend API for a full-stack Realtor CRM platform.

This service provides REST endpoints for managing leads, tasks, and related CRM data using PostgreSQL.

The API is consumed by a Next.js frontend application.

---

# System Architecture
```bash
┌───────────────────────────┐
│        Next.js App        │
│     React + Tailwind      │
└─────────────┬─────────────┘
              │ REST API
              ▼
┌───────────────────────────┐
│      Express Backend      │
│      Business Logic       │
└─────────────┬─────────────┘
              │ SQL Queries
              ▼
┌───────────────────────────┐
│      PostgreSQL DB        │
│      Leads + Tasks        │
└───────────────────────────┘
```

# Tech Stack

Runtime
- Node.js

Framework
- Express.js

Database
- PostgreSQL

Security
- Helmet
- CORS

Logging
- Morgan

Architecture
- REST API
- Modular route structure
- Service-based database queries

---

# Features

## Lead Management

Endpoints allow full CRUD operations on leads.

Lead fields include:
- first_name
- last_name
- email
- phone
- source
- status
- budget range
- notes

Example operations:
- Create new lead
- Update lead status
- Retrieve lead details
- List all leads

---

## Task Management

Tasks can be assigned to leads and tracked through their lifecycle.

Fields include:
- title
- description
- due_date
- status
- lead_id

Endpoints support:

- Create task
- Update task
- Filter tasks
- Retrieve task summaries

---

## Task Summary Logic

Provides aggregated task data for dashboards.

Includes:

- overdue tasks
- tasks due today
- tasks due in next 7 days

This powers the frontend dashboard view.

---

# Database Schema

Core tables:

### Leads
```bash
leads
id
first_name
last_name
email
phone
source
status
budget_min
budget_max
notes
created_at
updated_at
```

### Tasks
```bash
tasks
id
lead_id
title
description
due_date
status
created_at
```

Relationships:
```bash
Lead (1) -> (many) tasks
```
---

# API Routes

## Leads
```bash
GET /leads
GET /leads/:id
POST /leads
PUT /leads/:id
DELETE /leads/:id
```

## Tasks
```bash
GET /tasks
GET /tasks/:id
POST /tasks
PUT /tasks/:id
DELETE /tasks/:id
```

## Task Summary
```bash
GET /tasks/summary
```

Returns dashboard data:
- overdue
- due today
- upcoming

---

# Running Locally

Clone repository
```bash
git clone https://github.com/taxidriver802/crm-backend
```


Install dependencies

```bash
npm install
```

Create environment variables

```bash
.env

Ex:
PORT=4000

DATABASE_URL=postgres://crm:crm@localhost:5432/crm_dev
```
Start server
```bash
npm run dev
```

Server runs on:
```bash
http://localhost:4000
```


---

# Future Improvements

Planned backend improvements:

- Authentication (JWT)
- User accounts
- Email integrations
- Lead import automation
- Activity logging
- Rate limiting
- Production deployment

---

# Author

Jason Cox  
Full-Stack Developer

Portfolio  
https://jasoncox.dev