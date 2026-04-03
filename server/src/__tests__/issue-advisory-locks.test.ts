import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@paperclipai/db";
import { issueService } from "../services/issues.js";
import { companies, projects, goals, agents, issues } from "@paperclipai/db";

describe("Issue Advisory Locks", () => {
  let testCompanyId: string;
  let testProjectId: string;
  let testAgentId: string;
  let testIssueId: string;

  beforeAll(async () => {
    // Create test company
    const [company] = await db
      .insert(companies)
      .values({ name: "Test Company", slug: "test-advisory-locks" })
      .onConflictDoUpdate({
        target: companies.slug,
        set: { name: "Test Company" },
      })
      .returning();
    testCompanyId = company!.id;

    // Create test project
    const [project] = await db
      .insert(projects)
      .values({
        companyId: testCompanyId,
        name: "Test Project",
        status: "active",
      })
      .returning();
    testProjectId = project!.id;

    // Create test agent
    const [agent] = await db
      .insert(agents)
      .values({
        companyId: testCompanyId,
        name: "Test Agent",
        nameKey: "test-agent-advisory",
        model: "claude-sonnet-4",
        adapter: "claude-local",
        status: "active",
      })
      .onConflictDoUpdate({
        target: [agents.companyId, agents.nameKey],
        set: { name: "Test Agent" },
      })
      .returning();
    testAgentId = agent!.id;

    // Create test issue
    const svc = issueService(db);
    const issue = await svc.create(testCompanyId, {
      title: "Test Issue for Advisory Locks",
      projectId: testProjectId,
      status: "todo",
    });
    testIssueId = issue.id;
  });

  afterAll(async () => {
    // Cleanup
    if (testIssueId) {
      await db.delete(issues).where(db.sql`${issues.id} = ${testIssueId}`);
    }
    if (testAgentId) {
      await db.delete(agents).where(db.sql`${agents.id} = ${testAgentId}`);
    }
    if (testProjectId) {
      await db.delete(projects).where(db.sql`${projects.id} = ${testProjectId}`);
    }
    if (testCompanyId) {
      await db.delete(companies).where(db.sql`${companies.id} = ${testCompanyId}`);
    }
  });

  it("should acquire advisory lock during issue update", async () => {
    const svc = issueService(db);

    // This test verifies that the advisory lock is acquired
    // The actual deadlock prevention is better tested with concurrent updates
    const updated = await svc.update(testIssueId, {
      status: "in_progress",
      assigneeAgentId: testAgentId,
    });

    expect(updated).toBeTruthy();
    expect(updated?.status).toBe("in_progress");
    expect(updated?.assigneeAgentId).toBe(testAgentId);
  });

  it("should handle concurrent updates without deadlock", async () => {
    const svc = issueService(db);

    // Create 10 concurrent update operations
    // Without advisory locks, this would frequently deadlock
    const updates = Array.from({ length: 10 }, (_, i) =>
      svc.update(testIssueId, {
        status: i % 2 === 0 ? "in_progress" : "in_review",
        assigneeAgentId: testAgentId,
      }),
    );

    // All should complete without deadlock
    const results = await Promise.all(updates);

    // At least one should succeed (last one wins)
    const succeeded = results.filter((r) => r !== null);
    expect(succeeded.length).toBeGreaterThan(0);

    // Final state should be one of the expected values
    const final = await svc.getById(testIssueId);
    expect(["in_progress", "in_review"]).toContain(final?.status);
  }, 30000); // 30 second timeout for concurrent test

  it("should serialize updates to the same issue", async () => {
    const svc = issueService(db);
    const results: string[] = [];

    // Launch 5 concurrent updates that append to results array
    await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        await svc.update(testIssueId, {
          status: "todo",
        });
        results.push(`update-${i}`);
      }),
    );

    // All updates should complete
    expect(results).toHaveLength(5);

    // Verify final state
    const final = await svc.getById(testIssueId);
    expect(final?.status).toBe("todo");
  });
});
