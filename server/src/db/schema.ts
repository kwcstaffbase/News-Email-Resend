import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    userId: text("user_id").notNull(),
    instanceId: text("instance_id").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    status: text("status").notNull().default("active"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // Last time the upstream Staffbase API confirmed this user still exists.
    // Used by revalidateAccessor() to bound the per-request SCIM check by TTL.
    lastVerifiedAt: timestamp("last_verified_at"),
  },
  (table) => ({
    // Composite PK on (instance_id, user_id). The single-column user_id PK
    // would have let two tenants in the same database collide on the same
    // Staffbase userId. The composite key enforces per-(instance, user)
    // uniqueness at the schema level (defence-in-depth).
    pk: primaryKey({ columns: [table.instanceId, table.userId] }),
  })
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    instanceId: text("instance_id").notNull(),
    role: text("role").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    staffbaseSessionHash: text("staffbase_session_hash"),
  },
  (table) => ({
    expiresAtIdx: index("sessions_expires_at_idx").on(table.expiresAt),
    userIdx: index("sessions_user_id_idx").on(table.userId),
    staffbaseHashIdx: index("sessions_staffbase_hash_idx").on(
      table.instanceId,
      table.staffbaseSessionHash
    ),
  })
);

export const settings = pgTable("settings", {
  instanceId: text("instance_id").primaryKey(),
  staffbaseUrl: text("staffbase_url"),
  apiToken: text("api_token"),
  // URL of the email service used to send acknowledgement reminder emails.
  // e.g. https://email-service.staffbase.com/api/v1/emails
  emailServiceUrl: text("email_service_url"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Generic demo entity to showcase table + filter + sort + pagination patterns.
// Replace with your own domain table(s); the rest of the admin UI infrastructure
// (search, filter, segmented tabs, sort) is wired off this shape.
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    instanceId: text("instance_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    status: text("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    instanceIdx: index("items_instance_id_idx").on(table.instanceId),
    instanceStatusIdx: index("items_instance_status_idx").on(table.instanceId, table.status),
  })
);

export const changelog = pgTable(
  "changelog",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    instanceId: text("instance_id").notNull(),
    userId: text("user_id"),
    userName: text("user_name"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    entityName: text("entity_name"),
    summary: text("summary").notNull(),
    payload: jsonb("payload"),
    gdprRelevant: boolean("gdpr_relevant").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    instanceCreatedAtIdx: index("changelog_instance_id_created_at_idx").on(
      table.instanceId,
      table.createdAt
    ),
  })
);
