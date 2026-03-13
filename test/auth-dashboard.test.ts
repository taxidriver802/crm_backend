/// <reference types="jest" />
import request from "supertest";
import { app } from "../src/app";
import { resetDb } from "./helpers/db";
import { ensureSchema } from "./helpers/setup";

describe("Auth + Dashboard integration", () => {
  beforeAll(async () => {
  await ensureSchema();
  await resetDb();
});

  afterAll(async () => {
    // close pool if your db.ts exports it; otherwise tests hang
    const { pool } = await import("../src/db");
    await pool.end();
  });

  it("login -> create lead/task -> dashboard updates -> logout blocks", async () => {
    const agent = request.agent(app);

// register
const email = `test${Date.now()}@example.com`;
const password = "TaxiDriver12";

const register = await agent.post("/auth/register").send({
  first_name: "Test",
  last_name: "User",
  email,
  password,
});

expect([200, 201]).toContain(register.status);
expect(register.body.ok).toBe(true);

// login
const login = await agent.post("/auth/login").send({ email, password });

expect([200, 201]).toContain(login.status);
expect(login.body.ok).toBe(true);

    // create lead
    const leadRes = await agent
      .post("/leads")
      .send({ first_name: "Test", last_name: "Lead", source: "Test", status: "New" });

    expect([200, 201]).toContain(leadRes.status);
    const leadId = leadRes.body.lead.id;

    // create task
    const taskRes = await agent
      .post("/tasks")
      .send({ lead_id: leadId, title: "Test Task", due_date: new Date().toISOString() });

    expect([200, 201]).toContain(taskRes.status);

    // dashboard should reflect
    const dash = await agent.get("/dashboard");
    expect([200, 201]).toContain(dash.status);
    expect(dash.body.ok).toBe(true);

    // logout
    const logout = await agent.post("/auth/logout");
    expect([200, 201]).toContain(logout.status);

    // should now be blocked
    const dashAfter = await agent.get("/dashboard");
    expect(dashAfter.status).toBe(401);
  });
});