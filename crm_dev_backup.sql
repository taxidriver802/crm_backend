--
-- PostgreSQL database dump
--

\restrict 0iR2BY6d6vfL9RoT0fcEIZmHoeNclzaafZbaSOrU0gEciVrK6B1CkaJj4Le8uDW

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg13+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: deals; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.deals (
    id integer NOT NULL,
    lead_id integer,
    property_id integer,
    deal_value numeric,
    commission numeric,
    status text DEFAULT 'Under Contract'::text,
    closing_date date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.deals OWNER TO crm;

--
-- Name: deals_id_seq; Type: SEQUENCE; Schema: public; Owner: crm
--

CREATE SEQUENCE public.deals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.deals_id_seq OWNER TO crm;

--
-- Name: deals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: crm
--

ALTER SEQUENCE public.deals_id_seq OWNED BY public.deals.id;


--
-- Name: files; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.files (
    id integer NOT NULL,
    uploaded_by_user_id integer,
    original_name text NOT NULL,
    storage_key text NOT NULL,
    mime_type text,
    size_bytes integer,
    lead_id integer,
    task_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    job_id integer
);


ALTER TABLE public.files OWNER TO crm;

--
-- Name: files_id_seq; Type: SEQUENCE; Schema: public; Owner: crm
--

CREATE SEQUENCE public.files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.files_id_seq OWNER TO crm;

--
-- Name: files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: crm
--

ALTER SEQUENCE public.files_id_seq OWNED BY public.files.id;


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.jobs (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'New'::text NOT NULL,
    address text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.jobs OWNER TO crm;

--
-- Name: jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: crm
--

CREATE SEQUENCE public.jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.jobs_id_seq OWNER TO crm;

--
-- Name: jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: crm
--

ALTER SEQUENCE public.jobs_id_seq OWNED BY public.jobs.id;


--
-- Name: lead_properties; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.lead_properties (
    lead_id integer NOT NULL,
    property_id integer NOT NULL
);


ALTER TABLE public.lead_properties OWNER TO crm;

--
-- Name: leads; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.leads (
    id integer NOT NULL,
    user_id integer,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text,
    phone text,
    source text,
    status text DEFAULT 'New'::text,
    budget_min numeric,
    budget_max numeric,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.leads OWNER TO crm;

--
-- Name: leads_id_seq; Type: SEQUENCE; Schema: public; Owner: crm
--

CREATE SEQUENCE public.leads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.leads_id_seq OWNER TO crm;

--
-- Name: leads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: crm
--

ALTER SEQUENCE public.leads_id_seq OWNED BY public.leads.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    entity_type text,
    entity_id integer,
    metadata jsonb,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    dedupe_key text,
    CONSTRAINT notifications_entity_type_check CHECK (((entity_type IS NULL) OR (entity_type = ANY (ARRAY['task'::text, 'lead'::text, 'invite'::text])))),
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['TASK_DUE_SOON'::text, 'TASK_OVERDUE'::text, 'TASK_ASSIGNED'::text, 'INVITE_ACCEPTED'::text])))
);


ALTER TABLE public.notifications OWNER TO crm;

--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: crm
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.notifications_id_seq OWNER TO crm;

--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: crm
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: properties; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.properties (
    id integer NOT NULL,
    user_id integer,
    address text NOT NULL,
    city text NOT NULL,
    state text NOT NULL,
    zip_code text,
    price numeric NOT NULL,
    bedrooms integer,
    bathrooms numeric,
    square_feet integer,
    status text DEFAULT 'Active'::text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.properties OWNER TO crm;

--
-- Name: properties_id_seq; Type: SEQUENCE; Schema: public; Owner: crm
--

CREATE SEQUENCE public.properties_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.properties_id_seq OWNER TO crm;

--
-- Name: properties_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: crm
--

ALTER SEQUENCE public.properties_id_seq OWNED BY public.properties.id;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.tasks (
    id integer NOT NULL,
    user_id integer NOT NULL,
    lead_id integer,
    title text NOT NULL,
    description text,
    due_date timestamp with time zone,
    status text DEFAULT 'Pending'::text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT now(),
    job_id integer
);


ALTER TABLE public.tasks OWNER TO crm;

--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: crm
--

CREATE SEQUENCE public.tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tasks_id_seq OWNER TO crm;

--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: crm
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: crm
--

CREATE TABLE public.users (
    id integer NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    password_hash text,
    role text DEFAULT 'agent'::text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    status text DEFAULT 'active'::text NOT NULL,
    invite_token_hash text,
    invite_expires_at timestamp with time zone,
    invited_at timestamp with time zone,
    password_set_at timestamp with time zone,
    last_login_at timestamp with time zone,
    invite_revoked_at timestamp with time zone,
    invite_superseded_at timestamp with time zone,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'agent'::text]))),
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'disabled'::text])))
);


ALTER TABLE public.users OWNER TO crm;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: crm
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO crm;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: crm
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: deals id; Type: DEFAULT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.deals ALTER COLUMN id SET DEFAULT nextval('public.deals_id_seq'::regclass);


--
-- Name: files id; Type: DEFAULT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.files ALTER COLUMN id SET DEFAULT nextval('public.files_id_seq'::regclass);


--
-- Name: jobs id; Type: DEFAULT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.jobs ALTER COLUMN id SET DEFAULT nextval('public.jobs_id_seq'::regclass);


--
-- Name: leads id; Type: DEFAULT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.leads ALTER COLUMN id SET DEFAULT nextval('public.leads_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: properties id; Type: DEFAULT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.properties ALTER COLUMN id SET DEFAULT nextval('public.properties_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: deals; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.deals (id, lead_id, property_id, deal_value, commission, status, closing_date, created_at) FROM stdin;
\.


--
-- Data for Name: files; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.files (id, uploaded_by_user_id, original_name, storage_key, mime_type, size_bytes, lead_id, task_id, created_at, job_id) FROM stdin;
6	3	Crm_roadmap.md	1774711192809-hww22u.md	text/markdown	3047	\N	\N	2026-03-28 15:19:52.825187+00	3
7	3	context.md	1774849025484-tfbjc7.md	text/markdown	6585	\N	\N	2026-03-30 05:37:06.000742+00	\N
9	3	jason_cox_resume.pdf	1774858383907-k5u4vu.pdf	application/pdf	3951	\N	\N	2026-03-30 08:13:03.91497+00	\N
10	3	jason_cox_resume.pdf	1774862444960-eurpbr.pdf	application/pdf	3951	15	\N	2026-03-30 09:20:44.077086+00	\N
11	3	localhost_3000_dashboard (7).png	1775119694240-e6tos6.png	image/png	335208	\N	\N	2026-04-02 08:48:14.688306+00	\N
\.


--
-- Data for Name: jobs; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.jobs (id, user_id, title, description, status, address, created_at, updated_at) FROM stdin;
1	3	roof inspection for 123 main street	notes or context for this job	New	123 main street	2026-03-28 07:41:08.97681+00	2026-03-28 07:41:08.97681+00
2	3	testing	this is a test.	Proposal Sent	test street 123 ln	2026-03-28 08:26:12.597549+00	2026-03-28 09:16:54.213981+00
3	3	Test for job with task	THIS JOB IS BEING CREATED TO ALLOW ME TO TEST WITH TASKS	New	34 13 62nd Ave N, Brooklyn Center, MN 55429	2026-03-28 13:11:36.52138+00	2026-03-28 13:11:36.52138+00
\.


--
-- Data for Name: lead_properties; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.lead_properties (lead_id, property_id) FROM stdin;
\.


--
-- Data for Name: leads; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.leads (id, user_id, first_name, last_name, email, phone, source, status, budget_min, budget_max, notes, created_at, updated_at) FROM stdin;
15	3	Marcus	Christiansen	Mark.M.Chris@adp.org	5617005676	Website	Contacted	70000	120000	Wants to tour 3 homes in the Minneapolis area. range listed. prefers townhome/house over apartment.	2026-03-22 06:06:46.095906+00	2026-03-22 06:10:45.603026+00
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.notifications (id, user_id, type, title, message, entity_type, entity_id, metadata, read_at, created_at, dedupe_key) FROM stdin;
502	3	TASK_ASSIGNED	New task assigned	You were assigned: another test	task	27	\N	\N	2026-03-28 13:21:35.6852+00	\N
509	3	TASK_DUE_SOON	Task due soon	hahahah is due soon	task	20	\N	\N	2026-03-28 14:20:29.022377+00	due_soon:20:Sun Mar 29 2026 03:52:00 GMT-0500 (Central Daylight Time)
525	3	TASK_DUE_SOON	Task due soon	THIS IS THE TASK TO TEST THE JOB W/ TASK is due soon	task	26	\N	\N	2026-03-30 05:37:03.629221+00	due_soon:26:Mon Mar 30 2026 08:12:00 GMT-0500 (Central Daylight Time)
526	3	TASK_OVERDUE	Task overdue	hahahah is overdue	task	20	\N	\N	2026-03-30 05:37:03.724991+00	overdue:20:Sun Mar 29 2026 03:52:00 GMT-0500 (Central Daylight Time)
626	3	TASK_OVERDUE	Task overdue	Call with showing options is overdue	task	18	\N	\N	2026-04-02 04:18:31.266888+00	overdue:18:Wed Apr 01 2026 14:00:00 GMT-0500 (Central Daylight Time)
627	3	TASK_OVERDUE	Task overdue	THIS IS THE TASK TO TEST THE JOB W/ TASK is overdue	task	26	\N	\N	2026-04-02 04:18:32.893567+00	overdue:26:Mon Mar 30 2026 08:12:00 GMT-0500 (Central Daylight Time)
698	3	TASK_ASSIGNED	New task assigned	You were assigned: hello world test	task	28	\N	\N	2026-04-02 08:39:21.488507+00	\N
699	3	TASK_ASSIGNED	New task assigned	You were assigned: teseting again	task	29	\N	\N	2026-04-02 08:41:51.287201+00	\N
700	3	TASK_DUE_SOON	Task due soon	hello world test is due soon	task	28	\N	\N	2026-04-02 08:42:30.223246+00	due_soon:28:Fri Apr 03 2026 03:39:00 GMT-0500 (Central Daylight Time)
704	3	TASK_ASSIGNED	New task assigned	You were assigned: TESTING	task	30	\N	\N	2026-04-02 08:43:44.472924+00	\N
713	3	TASK_DUE_SOON	Task due soon	please is due soon	task	21	\N	\N	2026-04-02 08:57:30.402073+00	due_soon:21:Fri Apr 03 2026 03:54:00 GMT-0500 (Central Daylight Time)
\.


--
-- Data for Name: properties; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.properties (id, user_id, address, city, state, zip_code, price, bedrooms, bathrooms, square_feet, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.tasks (id, user_id, lead_id, title, description, due_date, status, created_at, updated_at, job_id) FROM stdin;
21	3	15	please	work	2026-04-03 08:54:00+00	Pending	2026-03-23 08:54:48.503385+00	2026-03-23 08:54:48.503385+00	\N
22	3	15	task	task	\N	Pending	2026-03-23 08:56:08.354213+00	2026-03-23 08:56:08.354213+00	\N
24	3	15	idk	idk	2026-03-26 04:00:00+00	Completed	2026-03-26 04:55:07.525571+00	2026-03-26 04:55:20.060405+00	\N
19	3	15	notification should work	testing notifications	2026-03-24 08:46:00+00	Completed	2026-03-23 08:47:06.114587+00	2026-03-26 05:00:38.03027+00	\N
18	3	15	Call with showing options	Call client and explain the three options and make a plan to go from there.	2026-04-01 19:00:00+00	Pending	2026-03-22 06:07:41.670946+00	2026-03-28 08:51:24.490891+00	\N
26	3	\N	THIS IS THE TASK TO TEST THE JOB W/ TASK	THIS IS THE TASK TO TEST THE JOB W/ TASK	2026-03-30 13:12:00+00	Pending	2026-03-28 13:12:08.918483+00	2026-03-28 13:12:08.918483+00	3
27	3	\N	another test	idk what to pur here	2026-04-04 13:21:00+00	Completed	2026-03-28 13:21:35.639096+00	2026-03-28 13:22:55.094167+00	3
23	3	15	due soon	due soon	2026-03-23 09:02:00+00	Completed	2026-03-23 09:00:26.239653+00	2026-04-02 07:09:13.704035+00	\N
28	3	15	hello world test	testing again	2026-04-03 08:39:00+00	Pending	2026-04-02 08:39:21.458046+00	2026-04-02 08:39:21.458046+00	\N
29	3	\N	teseting again	testing once more loser	2026-04-09 08:41:00+00	Pending	2026-04-02 08:41:51.261292+00	2026-04-02 08:41:51.261292+00	3
30	3	\N	TESTING	Task creation linked to jnob	2026-04-10 08:43:00+00	Pending	2026-04-02 08:43:44.461233+00	2026-04-02 08:43:44.461233+00	1
20	3	15	hahahah	idk	2026-03-29 08:52:00+00	Completed	2026-03-23 08:52:20.745719+00	2026-04-02 09:22:01.83758+00	\N
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.users (id, first_name, last_name, email, password_hash, role, created_at, updated_at, status, invite_token_hash, invite_expires_at, invited_at, password_set_at, last_login_at, invite_revoked_at, invite_superseded_at) FROM stdin;
3	Jason	Cox	JAcox12@icloud.com	$2b$10$r96Kh5fxNA8xWyxVv7WwjOjFnhFKpa4VbR0gXcl5HiUVSicJ0aI1.	owner	2026-03-04 12:15:16.229079+00	2026-03-04 12:15:16.229079+00	active	\N	\N	\N	\N	\N	\N	\N
18	Kayla	Cox	rooftoprealty.mn@gmail.com	$2b$10$cIIVllpbFagzDPG1uQ231ucOF3BftIhLNgb3tcfEQhEiLh4oy5NqW	owner	2026-03-19 11:56:03.711714+00	2026-03-23 06:51:36.96008+00	active	\N	\N	2026-03-19 11:57:16.211529+00	2026-03-19 12:10:48.041853+00	2026-03-19 12:10:48.041853+00	\N	\N
\.


--
-- Name: deals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: crm
--

SELECT pg_catalog.setval('public.deals_id_seq', 1, false);


--
-- Name: files_id_seq; Type: SEQUENCE SET; Schema: public; Owner: crm
--

SELECT pg_catalog.setval('public.files_id_seq', 11, true);


--
-- Name: jobs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: crm
--

SELECT pg_catalog.setval('public.jobs_id_seq', 3, true);


--
-- Name: leads_id_seq; Type: SEQUENCE SET; Schema: public; Owner: crm
--

SELECT pg_catalog.setval('public.leads_id_seq', 15, true);


--
-- Name: notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: crm
--

SELECT pg_catalog.setval('public.notifications_id_seq', 754, true);


--
-- Name: properties_id_seq; Type: SEQUENCE SET; Schema: public; Owner: crm
--

SELECT pg_catalog.setval('public.properties_id_seq', 1, false);


--
-- Name: tasks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: crm
--

SELECT pg_catalog.setval('public.tasks_id_seq', 30, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: crm
--

SELECT pg_catalog.setval('public.users_id_seq', 21, true);


--
-- Name: deals deals_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: lead_properties lead_properties_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.lead_properties
    ADD CONSTRAINT lead_properties_pkey PRIMARY KEY (lead_id, property_id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_leads_created_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_created_at ON public.leads USING btree (created_at);


--
-- Name: idx_leads_name; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_name ON public.leads USING btree (last_name, first_name);


--
-- Name: idx_leads_status; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_status ON public.leads USING btree (status);


--
-- Name: idx_leads_user_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_leads_user_id ON public.leads USING btree (user_id);


--
-- Name: idx_notifications_dedupe_key; Type: INDEX; Schema: public; Owner: crm
--

CREATE UNIQUE INDEX idx_notifications_dedupe_key ON public.notifications USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);


--
-- Name: idx_notifications_type; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_notifications_type ON public.notifications USING btree (type);


--
-- Name: idx_notifications_user_created_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_notifications_user_created_at ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_notifications_user_read_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_notifications_user_read_at ON public.notifications USING btree (user_id, read_at);


--
-- Name: idx_properties_user_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_properties_user_id ON public.properties USING btree (user_id);


--
-- Name: idx_tasks_due_date; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_tasks_due_date ON public.tasks USING btree (due_date);


--
-- Name: idx_tasks_job_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_tasks_job_id ON public.tasks USING btree (job_id);


--
-- Name: idx_tasks_lead_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_tasks_lead_id ON public.tasks USING btree (lead_id);


--
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- Name: idx_tasks_user_id; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_tasks_user_id ON public.tasks USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_invite_expires_at; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_users_invite_expires_at ON public.users USING btree (invite_expires_at);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_status; Type: INDEX; Schema: public; Owner: crm
--

CREATE INDEX idx_users_status ON public.users USING btree (status);


--
-- Name: deals deals_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: deals deals_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL;


--
-- Name: files files_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


--
-- Name: files files_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: files files_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: files files_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: jobs jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: lead_properties lead_properties_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.lead_properties
    ADD CONSTRAINT lead_properties_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_properties lead_properties_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.lead_properties
    ADD CONSTRAINT lead_properties_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: leads leads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: properties properties_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: crm
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 0iR2BY6d6vfL9RoT0fcEIZmHoeNclzaafZbaSOrU0gEciVrK6B1CkaJj4Le8uDW

