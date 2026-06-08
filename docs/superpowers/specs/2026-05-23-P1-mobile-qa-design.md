# P1 — Mobile QA Pipeline Additions — Design

**Date:** 2026-05-23
**Author:** Max (`max@staffbase.com`)
**Status:** Draft for review

## Context

P1 is sub-plan 1 of the CC Custom Plugin Platform roadmap (see [`../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md`](../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md) §P1). It is the only code-bearing sub-plan in week 1 and produces the artifact P6 propagates to every downstream.

Today's [`cc-custom-plugin-template/playwright.config.ts`](../../../playwright.config.ts) defines four desktop-only browser projects (Chromium, Firefox, WebKit, Edge). The widget — rendered inside the Staffbase native app's WKWebView (iOS) / Custom Chrome Tab (Android) — has **zero** automated mobile coverage. Existing manual coverage lives in [`cc-custom-plugin-template/docs/qa/mobile-checklist.md`](../../qa/mobile-checklist.md) and is exercised inconsistently per release.

Roadmap scope (verbatim from §P1):

- Add Playwright mobile-emulation projects (Pixel 7, iPhone 14, iPad Mini) via new `playwright.mobile.config.ts`.
- **First step**: confirm Staffbase BrowserStack subscription. If active, add real-device leg (iOS Safari + Android Chrome on Staffbase mobile app's WKWebView/CCT shell) — wire `BROWSERSTACK_USER` + `BROWSERSTACK_KEY` from Vault via existing template secret pattern. If not, document as future work, ship emulation only.
- Extend the manual mobile checklist for native shell QA (touch targets, viewport clipping, scroll trapping, iframe headers, deep-link return).
- CI matrix adds `mobile-emulation` leg (always) and `mobile-realdevice` leg (gated on subscription).

**Acceptance** (verbatim): `bun run test:e2e:mobile` green locally + CI; mobile checklist published in mkdocs; widget specs catch viewport-clipping / touch-target / scroll regressions; BrowserStack leg present iff subscription confirmed.

P1 ships before P6 begins — P6 propagates the entire P1 surface (config + specs + checklist + CI legs) to every downstream via the standard template-sync DRAFT-PR + `dev`-label flow.

## Mobile-emulation matrix

The new `playwright.mobile.config.ts` registers exactly three Playwright `devices[...]` presets — picked because they cover the three real form-factor regression classes the native app hits:

| Project | Playwright preset | Form factor | Why this one |
|---|---|---|---|
| `mobile-pixel-7` | `devices["Pixel 7"]` | 412 × 915, Chrome 119, Android 13 | Largest Android-Chrome installed base on Staffbase tenants per Pendo Q1/2026; CCT shell. |
| `mobile-iphone-14` | `devices["iPhone 14"]` | 390 × 844, Safari 16, iOS 16 | iPhone notch + safe-area inset class; WKWebView shell on the native app. |
| `mobile-ipad-mini` | `devices["iPad Mini"]` | 768 × 1024 portrait, Safari 16 | Tablet/landscape edge — catches widget layouts that break between phone and desktop breakpoints. |

Rejected presets and rationale (so P6 reviewers don't re-litigate):

- `Galaxy S9+` / `Galaxy Tab S4` — Samsung Internet quirks are real but already covered manually in `mobile-checklist.md`; adding a fourth Playwright project doubles CI runtime without catching a new bug class Pixel 7 misses.
- `iPhone SE` — small-viewport class is already exercised by the iPhone 14's 320 px breakpoint asserts in widget specs; adding SE just adds noise.
- `Desktop Safari` — already in the desktop matrix; out of scope here.

`playwright.mobile.config.ts` extends the existing root `playwright.config.ts` shape (same `webServer`, same `globalSetup`, same `testDir: "./e2e/tests"`) and only diverges on `projects[]` — keeps CI cache reuse and avoids duplicating the seeding logic.

## Mobile-emulation spec — what it enforces

New file: [`cc-custom-plugin-template/e2e/tests/widget-mobile.spec.ts`](../../../e2e/tests/widget-mobile.spec.ts) (placeholder path — file lands during impl). It mirrors the test shape used by [`e2e/tests/smoke/template.spec.ts`](../../../e2e/tests/smoke/template.spec.ts) but uses Playwright's mobile-aware locators (`tap()` not `click()`, `page.touchscreen` for scroll trapping).

Selectors the spec asserts on (concrete contracts the widget must honour):

| Concern | Selector / assertion | What it catches |
|---|---|---|
| **Touch targets ≥ 44×44 pt** | `await expect(button).toHaveCSS("min-width", /^4[4-9]px\|^[5-9]\dpx/)` plus `boundingBox()` ≥ `{ width: 44, height: 44 }` for every `[data-testid$="-button"]` and `[role="button"]` in the rendered widget shadow tree. | iOS HIG / Android touch-target regressions when a designer ships a 32 px button. |
| **No horizontal overflow** | `await expect.poll(() => page.evaluate(() => document.scrollingElement.scrollWidth === document.scrollingElement.clientWidth)).toBe(true)` at viewports 320 / 375 / 414 / 768. | Widget rendering a fixed-width table or absolute-positioned overlay that leaks past the viewport. |
| **Scroll trapping inside containers** | Programmatic touch-drag inside `[data-testid="widget-scroll-container"]` must move container.scrollTop, not window.scrollY. Asserted via before/after `evaluate(() => window.scrollY)`. | Native app double-scroll bug — outer page hijacks inner list scroll. |
| **Safe-area inset respected** | On `iPhone 14`, the widget root computed style must include `padding-top: env(safe-area-inset-top)` or an equivalent CSS var > 0 px. | Notch / Dynamic Island clipping the widget header. |
| **iframe header propagation** | `Content-Security-Policy` and `X-Frame-Options` headers on `/widget.js` request — caught via `page.on("response", ...)` and asserted against the template's published policy (see [`cc-custom-plugin-template/server/src/middleware/csp.ts`](../../../server/src/middleware/csp.ts) when present). | A future template change accidentally tightens CSP so the widget refuses to render in WKWebView. |
| **Deep-link return** | After `await page.goto("/widget?deep-link-target=item-42")`, the widget renders item-42 in viewport without intermediate full-page reload. | Push-notification tap → deep link → broken navigation. |

Spec is wired into the existing [`e2e/global-setup.ts`](../../../e2e/global-setup.ts) so seeding is identical to the desktop matrix — no separate fixtures.

## CI matrix wiring

Roadmap §P1 explicitly says the mobile-emulation leg runs **always**. Concrete CI shape for [`cc-custom-plugin-template/.github/workflows/ci.yml`](../../../.github/workflows/ci.yml):

- New `e2e-mobile` job, sibling to the existing `e2e` and `e2e-a11y` jobs (lines 78–164 of current `ci.yml`). Runs on every PR open / reopen / synchronize **and** on push to `main`. **Not** nightly — the roadmap calls for it on every PR and the marginal cost (~2 min wall-clock per leg with one worker) is acceptable.
- Matrix shape mirrors the existing `e2e` job: `strategy.matrix.include` lists the three mobile projects (`mobile-pixel-7`, `mobile-iphone-14`, `mobile-ipad-mini`); `fail-fast: false` so all three legs report even when one breaks; postgres service + `bun migrate` + `.env` block identical to today's `e2e` job.
- Command: `bunx playwright test --config=playwright.mobile.config.ts --project ${{ matrix.project }}`.
- Artifact upload: `playwright-report-mobile-${{ matrix.project }}` (14-day retention, matches the desktop legs).
- The job is gated by `name: Playwright E2E Mobile (${{ matrix.project }})` so a single failing leg surfaces as a discrete required-check in branch protection — `e2e-mobile` must be added to the protected-branch required-checks list as part of P6 rollout.

New `e2e-mobile-realdevice` job, present iff the BrowserStack subscription check below resolves YES:

- Runs **nightly** on `main` only (cron: `0 3 * * *`), not on PR — real-device runtime is 8–15 min per device and we don't want it gating the PR feedback loop. Roadmap §P1 does not explicitly state nightly-vs-PR; "always" in the roadmap text refers to emulation. Real-device is operationally too slow for per-PR.
- Calls `bunx playwright test --config=playwright.mobile.config.ts --project realdevice-ios --project realdevice-android` against BrowserStack's WebKit-on-iOS-17 + Chrome-on-Android-14 capabilities, with `BROWSERSTACK_USER` and `BROWSERSTACK_KEY` injected from the existing Vault path (`kv/cc-custom-plugin-template/ci/browserstack`) via the template's GitHub Actions OIDC → Vault flow.
- On red, posts to `#cc-tech` Slack via the existing notification webhook; does **not** open an autofix PR (false-positive rate on real-device is too high to autobranch).

## BrowserStack subscription check — protocol

Roadmap §P1 demands "first step: confirm Staffbase BrowserStack subscription". Concrete protocol:

1. Author (Max) posts in `#engineering-ops` Slack: "Does Staffbase have an active BrowserStack Automate subscription that cc-tech can use for cc-custom plugin CI? Need device farm access for iOS Safari + Android Chrome." Threads the question, tags `@ops-on-call`.
2. **Authoritative confirmer**: Engineering Ops manager (or the IT-procurement owner listed in Backstage for the BrowserStack vendor entity, queryable via `mcp__claude_ai_Backstage__find_owner_by_repo` with the BrowserStack tooling component). One named human must reply YES + provide the account-owner contact; YES from a peer in `#cc-tech` is insufficient.
3. **Result recording**: outcome captured in this spec's **§Decision log** below (this file), in the impl plan, and as a CHANGELOG entry on the P1-shipping PR. Format:
   - YES → add line "BrowserStack subscription confirmed by `<name>@staffbase.com` on `<YYYY-MM-DD>`; account-owner: `<name>`."
   - NO → add line "No active BrowserStack subscription as of `<YYYY-MM-DD>`; real-device leg deferred (see §Future work)."
4. If YES, a follow-up Vault-write task (gated by approval — see roadmap deployment patterns) provisions `kv/cc-custom-plugin-template/ci/browserstack` with `user` + `access_key` fields wired via the existing VSO → GitHub Actions OIDC binding pattern documented in the bootstrap skill.
5. If NO, ship emulation-only and add a one-line follow-up to [`cc-custom-plugin-template/CHANGELOG.md`](../../../CHANGELOG.md): "`[future]` Revisit real-device leg when BrowserStack subscription becomes available."

**Decision log** (filled during impl):

| Date | Result | Confirmer | Notes |
|---|---|---|---|
| _TBD_ | _TBD_ | _TBD_ | _TBD_ |

## Manual mobile checklist — extensions

The existing [`docs/qa/mobile-checklist.md`](../../qa/mobile-checklist.md) already covers layout / tap targets / text input / language switcher / forms / push / dark mode / network resilience for the user-facing iframe + widget surfaces. P1 extends it with four new subsections — paired exactly to the regression classes the new Playwright spec covers, so manual QA stays the safety net for what emulation can't see:

1. **Native shell quirks (WKWebView vs CCT)** — WKWebView intercepting `target=_blank` links, CCT cookie-jar isolation, iOS in-app browser `viewport-fit=cover` interaction with the notch.
2. **Iframe header propagation** — manually confirm via Safari Web Inspector / Chrome remote debug that CSP + `X-Frame-Options` arrive on the widget bundle when loaded from the dev tenant.
3. **Scroll trapping under finger** — physical-device only; verify that two-finger vs one-finger scroll inside a scrollable list does not propagate to the outer native scroll view.
4. **Deep-link return from push** — tap a push notification on a locked device, confirm the deep-link parameter survives the native app's cold-start path.

The published mkdocs build (`bunx mkdocs serve`) must surface the checklist under `docs/qa/mobile-checklist.md`; the new nav entry lands in [`cc-custom-plugin-template/mkdocs.yml`](../../../mkdocs.yml) under the existing `QA` section.

## Files touched

```
cc-custom-plugin-template/
├── playwright.mobile.config.ts                            (new)
├── e2e/tests/widget-mobile.spec.ts                        (new)
├── docs/qa/mobile-checklist.md                            (extended — 4 new subsections)
├── .github/workflows/ci.yml                               (new e2e-mobile job; conditional e2e-mobile-realdevice job)
├── mkdocs.yml                                             (QA nav: confirm mobile-checklist entry; optional new "Mobile QA" sub-nav)
├── package.json                                           (new script: "test:e2e:mobile": "playwright test --config=playwright.mobile.config.ts")
├── CHANGELOG.md                                           (new [sync] entries — emulation, plus [sync] or [future] for real-device)
└── docs/superpowers/specs/2026-05-23-P1-mobile-qa-design.md  (this file)
```

Nothing under `server/`, `client/`, `widget/`, `scripts/`, `docs/adrs/` changes. P1 is purely QA-pipeline + docs.

## Acceptance criteria

1. `bun run test:e2e:mobile` runs green locally on all three projects (`mobile-pixel-7`, `mobile-iphone-14`, `mobile-ipad-mini`) against a freshly migrated localdev DB.
2. CI job `Playwright E2E Mobile` shows three green legs on every PR after this lands; the job is added to the protected-branch required-checks list.
3. The new spec catches a forced regression: temporarily reduce a primary button's `min-width` to 32 px and confirm `mobile-pixel-7` leg fails with a touch-target assertion; revert.
4. The new spec catches a horizontal-overflow regression: temporarily inject a 600 px-wide fixed-position element into the widget and confirm `mobile-iphone-14` leg fails the no-overflow poll; revert.
5. `docs/qa/mobile-checklist.md` extensions render in `bunx mkdocs build --strict` and the file appears in the nav.
6. **BrowserStack outcome recorded** in §Decision log above + CHANGELOG entry — YES → real-device leg in CI nightly + Vault provisioned; NO → `[future]` CHANGELOG line + spec §Future work amended.
7. CHANGELOG entries carry the `[sync]` tag on every line that downstream plugins must inherit (emulation config, spec, checklist extensions, CI emulation leg). The real-device leg carries `[sync]` only if subscription is YES, otherwise stays `[template-only]` / `[future]`.

## Open questions

| Open question | Best-guess answer | Needs |
|---|---|---|
| Does Staffbase have an active BrowserStack Automate subscription that cc-tech can use? | Unknown — P1 cannot land the real-device leg without this. | Eng-ops confirmation; see §BrowserStack subscription check protocol above. |
| If YES, which account owner authorises adding cc-custom plugin CI to the BS billing? | Procurement owner per Backstage. | Resolved by the same Slack thread that answers question 1. |
| Should the `mobile-emulation` leg block PR merge (required check) or be advisory-only at first? | **Required** from day one. Advisory checks rot — engineers stop reading them. P6 reviewers expect the same answer; consistency matters. | User confirmation on branch-protection update. |
| For nightly real-device runs, who triages a red leg overnight? | `#cc-tech` Slack notification → next-business-day triage; nothing pages overnight (P1 is not P0 customer-facing). | Confirm with cc-tech on-call rotation. |
| Should the iPad Mini project run on every PR or only nightly (since tablet is a smaller regression surface)? | Every PR. Three legs in parallel finish in the same wall-clock as two; the cost is artifact storage, not CI minutes. | None — author decision. |
| Does the existing `e2e-a11y` job need a mobile twin? | Out of scope for P1 — open as a follow-up if real users surface a11y issues on mobile. axe-core's mobile-emulation support is uneven. | None — deferred. |

## Future work (if BrowserStack subscription is NO)

- File a procurement ticket on the IT-procurement Jira queue with the cost-justification line "real-device coverage required for native-app embedded widgets across iOS Safari + Android Chrome; emulation cannot catch WKWebView/CCT shell regressions".
- In the interim, the manual checklist (§Manual mobile checklist extensions) is the safety net — engineers run it manually on a real device for any PR touching widget shadow-DOM rendering, push notifications, or deep-link routing.
- Document a "real-device drill" cadence in [`cc-custom-plugin-template/docs/guides/testing.md`](../../guides/testing.md) — engineer manually runs the checklist on personal-device + a colleague's opposite-platform device once per release cut.

## Implementation plan pointer

Implementation plan will land at `cc-custom-plugin-template/docs/superpowers/plans/2026-05-23-P1-mobile-qa-plan.md` after this spec is approved. Plan order: BrowserStack confirmation (Day 1) → `playwright.mobile.config.ts` + minimal spec (Day 1, can land before BS answer) → CI emulation leg (Day 2) → checklist extensions + mkdocs nav (Day 2) → real-device leg or `[future]` CHANGELOG entry (Day 3, contingent on BS answer) → tag template + hand off to P6 (Day 3).

## References

- Roadmap: [`../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md`](../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md) §P1
- Current desktop config: [`cc-custom-plugin-template/playwright.config.ts`](../../../playwright.config.ts)
- Current a11y config (sibling shape): [`cc-custom-plugin-template/playwright.a11y.config.ts`](../../../playwright.a11y.config.ts)
- Existing mobile checklist: [`cc-custom-plugin-template/docs/qa/mobile-checklist.md`](../../qa/mobile-checklist.md)
- Existing CI matrix: [`cc-custom-plugin-template/.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)
- Template-sync mechanism (used by P6): [`cc-custom-plugin-template/docs/guides/template-sync.md`](../../guides/template-sync.md)
- Existing smoke spec (test shape reference): [`cc-custom-plugin-template/e2e/tests/smoke/template.spec.ts`](../../../e2e/tests/smoke/template.spec.ts)
- Sibling spec for tone/density reference: [`./2026-05-23-P2-user-stories-skill-design.md`](./2026-05-23-P2-user-stories-skill-design.md)
