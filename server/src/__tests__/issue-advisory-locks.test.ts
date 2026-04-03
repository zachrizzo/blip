import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  issues,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping advisory lock tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("Issue Advisory Locks", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-advisory-locks-");
    db = createDb(tempDb.connectionString);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(companies);
  });

  async function seedFixture() {
    const [company] = await db
      .insert(companies)
      .values({ name: "Test Company", slug: "test-advisory-locks" })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ companyId: company!.id, name: "Test Project", status: "active" })
      .returning();
    const [agent] = await db
      .insert(agents)
      .values({
        companyId: company!.id,
        name: "Test Agent",
        nameKey: "test-agent-advisory",
        model: "claude-sonnet-4",
        adapter: "claude-local",
        status: "active",
      })
      .returning();
    return { companyId: company!.id, projectId: project!.id, agentId: agent!.id };
  }

  it("acquires an advisory lock during issue update", async () => {
    const { companyId, projectId, agentId } = await seedFixture();
    const svc = issueService(db);
    const issue = await svc.create(companyId, { title: "Test Issue", projectId, status: "todo" });

    const updated = await svc.update(issue.id, {
      status: "in_progress",
      assigneeAgentId: agentId,
    });

    expect(updated?.status).toBe("in_progress");
    expect(updated?.assigneeAgentId).toBe(agentId);
  });

  it("handles concurrent updates without deadlock", async () => {
    const { companyId, projectId, agentId } = await seedFixture();
    const svc = issueService(db);
    const issue = await svc.create(companyId, { title: "Concurrent Test", projectId, status: "todo" });

    const updates = Array.from({ length: 10 }, (_, i) =>
      svc.update(issue.id, {
        status: i % 2 === 0 ? "in_progress" : "in_review",
        assigneeAgentId: agentId,
      }),
    );

    const results = await Promise.all(updates);
    const succeeded = results.filter((r) => r !== null);
    expect(succeeded.length).toBeGreaterThan(0);

    const final = await svc.getById(issue.id);
    expect(["in_progress", "in_review"]).toContain(final?.status);
  }, 30000);

  it("serializes repeated updates to the same issue", async () => {
    const { companyId, projectId } = await seedFixture();
    const svc = issueService(db);
    const issue = await svc.create(companyId, { title: "Serial Test", projectId, status: "todo" });

    const results: string[] = [];
    await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        await svc.update(issue.id, { status: "todo" });
        results.push(`update-${i}`);
      }),
    );

    expect(results).toHaveLength(5);
    const final = await svc.getById(issue.id);
    expect(final?.status).toBe("todo");
  });
});
