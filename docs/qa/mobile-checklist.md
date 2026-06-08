# Mobile testing checklist — <PLUGIN_NAME>

For manual testing on real iOS + Android devices once the plugin is installed in a Staffbase test branch. Only **user-facing** surfaces are in scope — `/admin` is desktop-only.

> **Fork-customize note:** this is a generic template. Replace `<PLUGIN_NAME>` /
> `<plugin>` placeholders, then extend the "plugin-specific flows" section with
> the actual screens and interactions your plugin exposes (forms, lists, detail
> views, push paths, etc.).

## Surfaces

| # | Surface | Where |
|---|---------|-------|
| 1 | Frontend end-user view | Plugin iframe at `/` inside the Staffbase native app |
| 2 | Widget end-user view | `<<plugin>-widget>` rendered on a Studio page, consumed by the native app |

## Browsers / platforms to cover

- **iOS**: Safari (WKWebView underpins the native app) + Chrome on iOS.
- **Android**: Chrome + Samsung Internet (default browser on Samsung devices, has its own WebView quirks).

## Setup

- [ ] Test Staffbase branch on `dev/de1` (or stage) with the `<plugin>` plugin installed.
- [ ] Plugin host: confirm hostname returned by Gatekeeper (e.g. `<PLUGIN_NAME>.dev-de1.staffbase.dev`).
- [ ] iOS test device (latest stable iOS), in the Staffbase native app or TestFlight build matching the test branch.
- [ ] Android test device (latest stable Android), Staffbase app from Play internal track matching the branch.
- [ ] Test user accounts: at least one regular user, one editor.
- [ ] Network conditions to test: full Wi-Fi, 4G, throttled 3G (DevTools or device settings), offline → online recovery.
- [ ] (Optional) iPhone Safari + Chrome on Android + Samsung Internet on Android for a browser cross-check.

## 1 — Frontend end-user view (plugin iframe `/`)

### Layout + scrolling

- [ ] Content renders without horizontal scroll at viewports **320px / 375px / 414px / 768px**.
- [ ] No content clipped by safe-area insets on iPhone notch/Dynamic Island.
- [ ] Vertical scroll smooth through long lists (no jank / no momentum-loss).
- [ ] Wide content (code blocks, tables, images) scrolls **within** its container, not the whole page.

### Tap targets

- [ ] All interactive elements ≥ **44×44 pt** (iOS HIG) / **48×48 dp** (Android).
- [ ] Primary action targets uniform across rows / cards.
- [ ] Filter chips, segmented controls, etc. comfortably tappable, with at least 8 px spacing.

### Text input

- [ ] Tapping any text input opens the IME keyboard.
- [ ] Layout reflows so the active input remains visible above the keyboard.
- [ ] Submitting closes the keyboard (or commits and keeps it open — confirm UX choice).
- [ ] Clearing the input restores prior state.
- [ ] Debounced inputs work under slow typing.

### Plugin-specific interactive elements

> Replace with actual plugin flows — expand cards, switch tabs, open modals, etc.

- [ ] Tap on primary interactive element behaves smoothly (no flicker / no scroll jump).
- [ ] Repeat tap collapses / closes cleanly.
- [ ] State retained when scrolling back to the same element.

### Language switcher (if enabled)

- [ ] Dropdown placement does not extend off-screen.
- [ ] Long language names truncate or wrap correctly.
- [ ] Switching language updates rendered content without full re-mount jank.

### Forms (if applicable)

- [ ] Form fields full-width on small viewport.
- [ ] Multi-language tabs (if relevant) scroll horizontally or stack — confirm intended pattern.
- [ ] Validation toasts readable on small screen; don't cover the offending field for >2 s.
- [ ] After submission, follow-up UI updates without manual refresh.
- [ ] User receives a confirmation visible on-screen.

### Push notifications

- [ ] Triggering a push-emitting action delivers a notification to the test device on iOS.
- [ ] Same on Android.
- [ ] Tapping the notification deep-links into the plugin (target content visible).
- [ ] Channel routing respects per-instance settings (`pushChannelPush`, `pushChannelNotificationCenter`).

### Dark mode

- [ ] If the native app honours system dark mode, plugin colors invert correctly.
- [ ] Text contrast meets WCAG 2.1 AA in dark mode.
- [ ] No accidental white flashes during navigation.

### Network resilience

- [ ] Offline: spinner shown; no error toast loop.
- [ ] Reconnect: data refetches and renders without a manual reload.
- [ ] Slow 3G: pagination / spinners don't block taps on already-rendered content.

## 2 — Widget end-user view (`<<plugin>-widget>` in Studio page)

### Embed + load

- [ ] Widget loads inside a Studio page rendered by the native app.
- [ ] Shadow DOM isolation: page styles do not leak in (e.g. unexpected fonts / colours).
- [ ] Default config attributes render the default mode correctly.
- [ ] Switching widget config (e.g. `view-mode="…"`) in Studio re-renders correctly when reloaded.

### Layout

- [ ] No horizontal overflow at all four viewport breakpoints.
- [ ] Initial visible content reasonable without scroll on iPhone SE-sized viewports.
- [ ] Tap interactions work inside Shadow DOM (no event bubbling issues).

### Search / filtering (if applicable)

- [ ] Same checks as the Frontend section above.
- [ ] Per-locale resolution: filters honour the active locale.

### State retention across mode switches

- [ ] Switching widget config (if multiple modes exist) does not bleed state across modes.
- [ ] Re-mount: closing and re-opening the host page resets widget state cleanly.

## Findings / regressions

_Filled in by the tester. Reference the plugin's log queries (see [`docs/observability/how-to-verify-f2-f9.md`](../observability/how-to-verify-f2-f9.md)) to correlate device events with server-side activity on dev/de1._

| Date | Device / OS | Browser | Surface | Issue | Severity | PR / commit |
|------|-------------|---------|---------|-------|----------|-------------|
|      |             |         |         |       |          |             |
