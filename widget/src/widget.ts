import type {
  BlockDefinition,
  BlockFactory,
  ExternalBlockDefinition,
} from "@staffbase/widget-sdk";
import iconSvg from "../assets/icon.svg";
import { widgetAuthor, widgetLabel, widgetVersion } from "virtual:widget-meta";
import { WIDGET_ATTRS, configurationSchema, uiSchema } from "./configuration-schema.ts";

// ── Constants ───────────────────────────────────────────────────────────────

const WIDGET_TAG = "plugin-template-widget";

// ── Factory ────────────────────────────────────────────────────────────────

const factory: BlockFactory = (BaseBlockClass) => {
  return class PluginTemplateWidgetBlock extends BaseBlockClass {
    // True only while the viewer-side renderBlock path is active. Gates
    // attributeChangedCallback so attribute mutations in the Studio editor
    // (which uses the SDK-default renderBlockInEditor and never calls
    // renderBlock) cannot kick off any work.
    private _viewerMounted = false;

    private _getShadow(): ShadowRoot {
      return this.shadowRoot ?? this.attachShadow({ mode: "open" });
    }

    public renderBlock(_container: HTMLElement): void {
      this._viewerMounted = true;
      this._render();
    }

    public unmountBlock(_container: HTMLElement): void {
      this._viewerMounted = false;
      const shadow = this.shadowRoot;
      if (shadow) shadow.innerHTML = "";
    }

    public static get observedAttributes(): string[] {
      return WIDGET_ATTRS;
    }

    public attributeChangedCallback(): void {
      if (!this._viewerMounted) return;
      this._render();
    }

    private _render(): void {
      const installationId = (this.getAttribute("installation_id") ?? "").trim();
      const shadow = this._getShadow();

      // No installation bound — show an explicit unconfigured state so editors
      // notice they need to pick one. Viewer-side renders identically.
      if (!installationId) {
        shadow.innerHTML = `
          <style>
            .root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    padding: 24px; border: 1px dashed #f59e0b; border-radius: 8px;
                    background: #fffbeb; color: #92400e; }
            .root h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
            .root p  { margin: 0; font-size: 13px; }
          </style>
          <div class="root" data-testid="plugin-template-widget-unconfigured">
            <h2>Plugin installation not selected</h2>
            <p>Open the widget configuration in Studio and pick an installation.</p>
          </div>
        `;
        return;
      }

      shadow.innerHTML = `
        <style>
          .root {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            padding: 24px;
            border: 1px dashed #cbd5e1;
            border-radius: 8px;
            color: #1e293b;
          }
          .root h2 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
          .root p  { margin: 0; font-size: 14px; color: #64748b; }
          .root code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
        </style>
        <div class="root" data-testid="plugin-template-widget">
          <h2>Plugin Template Widget — start building here</h2>
          <p>
            Replace the render logic in <code>widget/src/widget.ts</code> with your
            plugin-specific UI. Bound to installation:
            <code>${escapeHtml(installationId)}</code>
          </p>
        </div>
      `;
    }
  };
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default:  return "&#39;";
    }
  });
}

// ── Block definition ───────────────────────────────────────────────────────

const blockDefinition: BlockDefinition = {
  name: WIDGET_TAG,
  factory,
  attributes: WIDGET_ATTRS,
  blockLevel: "block",
  label: widgetLabel,
  iconUrl: iconSvg,
  configurationSchema,
  uiSchema,
};

const externalBlockDefinition: ExternalBlockDefinition = {
  blockDefinition,
  version: widgetVersion,
  author: widgetAuthor,
};

(globalThis as unknown as { defineBlock: (def: ExternalBlockDefinition) => void }).defineBlock(
  externalBlockDefinition
);

export { widgetName, widgetLabel } from "virtual:widget-meta";
