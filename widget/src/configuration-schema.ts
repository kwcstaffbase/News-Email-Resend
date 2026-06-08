import type { JSONSchema7 } from "json-schema";
import { component as InstallationPickerRjsfComponent } from "./installation-picker.tsx";

/**
 * Configuration schema shown in the Staffbase Studio editor when an editor
 * adds this widget to a page.
 *
 * The template ships with a single `installation_id` field bound to a custom
 * RJSF picker. A plugin can be installed multiple times on the same Staffbase
 * tenant; each widget instance must be tied to one installation so the viewer
 * fetches data from the correct scope.
 *
 * Extend this schema (and the `attributes` array in `manifest.json` +
 * `WIDGET_ATTRS` below) when you add plugin-specific configuration.
 */
export const configurationSchema: JSONSchema7 = {
  type: "object",
  required: ["installation_id"],
  properties: {
    installation_id: {
      type: "string",
      title: "Plugin installation",
      description:
        "Bind this widget to a specific plugin installation. Required when the plugin is installed multiple times on the same Staffbase tenant.",
      minLength: 1,
    },
  },
};

export const uiSchema = {
  installation_id: {
    "ui:widget": InstallationPickerRjsfComponent,
    "ui:help": "Pick from the installations you have permission to manage.",
  },
};

/** All attribute names that the widget observes. Derived from schema properties. */
export const WIDGET_ATTRS = Object.keys(configurationSchema.properties ?? {}) as string[];
