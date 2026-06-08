// Bun test preload — runs before any test file is evaluated.
//
// IS_REAL_LOCALDEV in server/src/app.ts requires NODE_ENV === "development"
// (or unset) before any of the localdev bypass paths can activate. Bun's
// default test environment sets NODE_ENV="test", which would otherwise
// disable every bypass path the suite is meant to exercise (delete-intercept
// skip, CORS wildcards, localdev-only routes). The bypass paths are not
// security-relevant when NODE_ENV is forced inside the test harness — they
// only activate when IS_LOCALDEV is ALSO true, which is itself set per-test.
process.env.NODE_ENV = "development";
