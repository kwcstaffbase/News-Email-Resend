-- Replace the single-column PK on `users.user_id` with a composite PK on
-- `(instance_id, user_id)`. Defence-in-depth against cross-tenant collisions:
-- two tenants in the same database with the same Staffbase userId would
-- otherwise collide on upsert (one tenant's row clobbers the other's),
-- defeating the per-DB multi-tenancy guarantee.
--
-- Pre-flight check (operator MUST run against prod before applying):
--   SELECT user_id, COUNT(DISTINCT instance_id) AS instance_count
--   FROM users
--   GROUP BY user_id
--   HAVING COUNT(DISTINCT instance_id) > 1;
-- A non-empty result means the same userId already exists across multiple
-- instances. Reconcile (drop / rename / decide which tenant wins) BEFORE
-- this migration runs — the new PK would otherwise fail with a uniqueness
-- violation. Staffbase userIds are platform-guaranteed globally unique
-- MongoDB ObjectIds, so the expected result is zero rows.
--
-- Rollback (NOT executed automatically — operator runs manually if needed):
--   ALTER TABLE "users" DROP CONSTRAINT "users_instance_id_user_id_pk";
--   ALTER TABLE "users" ADD PRIMARY KEY ("user_id");

ALTER TABLE "users" DROP CONSTRAINT "users_pkey";
ALTER TABLE "users" ADD CONSTRAINT "users_instance_id_user_id_pk" PRIMARY KEY ("instance_id", "user_id");
