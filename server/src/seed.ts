/**
 * Local dev seed script — populates the `items` table with sample data so the
 * admin UI has something to show off (table, filters, sort, pagination).
 *
 * Run with:  bun --env-file=../.env src/seed.ts
 * Or call POST /api/localdev/seed (only mounted when IS_LOCALDEV=true).
 */

import { eq } from "drizzle-orm";
import { db } from "./db/client.ts";
import { changelog, items, settings, users } from "./db/schema.ts";

const INSTANCE_ID = Bun.env.LOCALDEV_INSTANCE_ID ?? "dev-instance";

interface SeedItem {
  name: string;
  description: string;
  category: "general" | "important" | "internal" | "external";
  status: "active" | "archived";
}

const SEED_ITEMS: SeedItem[] = [
  {
    name: "Welcome onboarding checklist",
    description: "Steps every new hire completes during their first week.",
    category: "important",
    status: "active",
  },
  {
    name: "Office WiFi credentials",
    description: "How to connect to the corporate and guest networks.",
    category: "internal",
    status: "active",
  },
  {
    name: "Quarterly all-hands recap",
    description: "Summary deck and recording link from the Q1 all-hands.",
    category: "general",
    status: "active",
  },
  {
    name: "Customer status report",
    description: "Public-facing weekly status update template.",
    category: "external",
    status: "active",
  },
  {
    name: "Security incident playbook",
    description: "Escalation steps for security incidents — must-read for on-call.",
    category: "important",
    status: "active",
  },
  {
    name: "Travel reimbursement policy",
    description: "Allowances, receipts, approval workflow.",
    category: "internal",
    status: "active",
  },
  {
    name: "Company swag store",
    description: "How to order branded merchandise for events and onboarding.",
    category: "general",
    status: "active",
  },
  {
    name: "Vendor procurement guide",
    description: "Steps to onboard a new vendor and get a PO approved.",
    category: "external",
    status: "active",
  },
  {
    name: "Code of conduct",
    description: "Behavioural expectations that apply to all employees.",
    category: "important",
    status: "active",
  },
  {
    name: "Holiday calendar 2026",
    description: "Public holidays per office location.",
    category: "general",
    status: "active",
  },
  {
    name: "Internal mentorship programme",
    description: "Sign-up page for the mentor / mentee match-up rounds.",
    category: "internal",
    status: "active",
  },
  {
    name: "Brand assets and logos",
    description: "Official logo files, colour palette, typography.",
    category: "external",
    status: "active",
  },
  {
    name: "Emergency contact list",
    description: "Phone numbers for facilities, IT, HR, and on-call rotations.",
    category: "important",
    status: "active",
  },
  {
    name: "Office floor plan",
    description: "Locations of desks, meeting rooms, kitchens, exits.",
    category: "general",
    status: "active",
  },
  {
    name: "VPN setup guide",
    description: "Install and configure the corporate VPN on macOS / Windows.",
    category: "internal",
    status: "active",
  },
  {
    name: "Public press kit",
    description: "Boilerplate, executive bios, high-resolution photos.",
    category: "external",
    status: "active",
  },
  {
    name: "Performance review cycle",
    description: "Timeline, rubric, and self-assessment template.",
    category: "important",
    status: "active",
  },
  {
    name: "Coffee machine maintenance",
    description: "Cleaning schedule and how to report breakdowns.",
    category: "general",
    status: "archived",
  },
  {
    name: "Old VPN configuration",
    description: "Replaced by the new client — kept for historical reference.",
    category: "internal",
    status: "archived",
  },
  {
    name: "Legacy brand guidelines",
    description: "Pre-rebrand assets. Do not use for new collateral.",
    category: "external",
    status: "archived",
  },
];

const SAMPLE_USERS = [
  { userId: "user-alice", firstName: "Alice", lastName: "Anderson" },
  { userId: "user-bob", firstName: "Bob", lastName: "Becker" },
  { userId: "user-carol", firstName: "Carol", lastName: "Carter" },
];

export async function clearAll(): Promise<string> {
  await db.transaction(async (tx) => {
    await tx.delete(items).where(eq(items.instanceId, INSTANCE_ID));
    await tx.delete(changelog).where(eq(changelog.instanceId, INSTANCE_ID));
    await tx.delete(users).where(eq(users.instanceId, INSTANCE_ID));
    await tx.delete(settings).where(eq(settings.instanceId, INSTANCE_ID));
  });
  return `Cleared all data for instance "${INSTANCE_ID}".`;
}

export async function seed(): Promise<string> {
  await clearAll();

  await db.insert(users).values(
    SAMPLE_USERS.map((u) => ({
      userId: u.userId,
      instanceId: INSTANCE_ID,
      firstName: u.firstName,
      lastName: u.lastName,
      status: "active",
    }))
  );

  const now = Date.now();
  await db.insert(items).values(
    SEED_ITEMS.map((it, idx) => {
      const createdBy = SAMPLE_USERS[idx % SAMPLE_USERS.length].userId;
      const createdAt = new Date(now - (SEED_ITEMS.length - idx) * 24 * 60 * 60 * 1000);
      return {
        instanceId: INSTANCE_ID,
        name: it.name,
        description: it.description,
        category: it.category,
        status: it.status,
        createdByUserId: createdBy,
        createdAt,
        updatedAt: createdAt,
      };
    })
  );

  return `Seeded ${SEED_ITEMS.length} items for instance "${INSTANCE_ID}".`;
}

if (import.meta.main) {
  const arg = Bun.argv[2];
  const action = arg === "clear" ? clearAll : seed;
  const message = await action();
  console.log(message);
  process.exit(0);
}
