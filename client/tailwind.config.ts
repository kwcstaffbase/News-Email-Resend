// @ts-expect-error – no types for the design system preset
import { preset as sbPreset } from "@staffbase/design/themes/default";
import type { Config } from "tailwindcss";

// The Staffbase design system preset injects brand-aligned colors, typography scale, spacing
// tokens, and component utilities that match the Staffbase app shell. Using it here ensures
// the plugin UI looks native within the platform without manually duplicating design tokens.
export default {
  presets: [sbPreset],
} satisfies Config;
