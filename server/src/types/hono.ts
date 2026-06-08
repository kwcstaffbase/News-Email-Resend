import type { ScopedDb } from "../db/scoped.ts";

export type AppEnv = {
  Variables: {
    user: {
      userId: string;
      userName: string;
      instanceId: string;
      pluginId: string;
      role: "editor" | "user";
      firstName: string | null;
      lastName: string | null;
      locale: string | null;
      type: string | null;
      branchId: string | null;
      externalId: string | null;
      issuerDomain: string | null;
      branchSlug: string | null;
      staffbaseSessionHash: string | null;
    };
    rawToken: string;
    /** Tenant-scoped query predicates. Always set by ssoMiddleware. */
    scopedDb: ScopedDb;
  };
};
