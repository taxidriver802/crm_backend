--
-- PostgreSQL database dump
--

\restrict J8dUFP6YyEV0Y5hPffaQpL8Hue9B9Dxc7DYXsPQ4gOybCxdWfvRBucwnvrFCpR1

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
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: crm
--

COPY public.users (id, first_name, last_name, email, password_hash, role, created_at, updated_at, status, invite_token_hash, invite_expires_at, invited_at, password_set_at, last_login_at, invite_revoked_at, invite_superseded_at) FROM stdin;
3	Jason	Cox	JAcox12@icloud.com	$2b$10$r96Kh5fxNA8xWyxVv7WwjOjFnhFKpa4VbR0gXcl5HiUVSicJ0aI1.	owner	2026-03-04 12:15:16.229079+00	2026-03-04 12:15:16.229079+00	active	\N	\N	\N	\N	\N	\N	\N
18	Kayla	Cox	rooftoprealty.mn@gmail.com	$2b$10$cIIVllpbFagzDPG1uQ231ucOF3BftIhLNgb3tcfEQhEiLh4oy5NqW	owner	2026-03-19 11:56:03.711714+00	2026-03-23 06:51:36.96008+00	active	\N	\N	2026-03-19 11:57:16.211529+00	2026-03-19 12:10:48.041853+00	2026-03-19 12:10:48.041853+00	\N	\N
\.


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: crm
--

SELECT pg_catalog.setval('public.users_id_seq', 21, true);


--
-- PostgreSQL database dump complete
--

\unrestrict J8dUFP6YyEV0Y5hPffaQpL8Hue9B9Dxc7DYXsPQ4gOybCxdWfvRBucwnvrFCpR1

