/**
 * Custom RJSF `ui:widget` rendered inside the Staffbase widget configuration
 * dialog. Lets editors pick which plugin installation this widget instance
 * should bind to, scoped to installations the editor has the `manage`
 * permission on.
 *
 * The selected installation UUID is written to the `installation_id` widget
 * attribute. The viewer-side `widget.ts` reads it to scope all subsequent
 * calls to that installation's data.
 *
 * Self-contained: no external CSS, no shared state — keeps the widget bundle
 * minimal and easy to fork.
 */

import React from "react";
import { fetchDiscovery, fetchManageableInstallations, type InstallationSummary } from "./api.ts";
import { PLUGIN_URL } from "./plugin-url.ts";

interface PickerProps {
  id?: string;
  value?: string;
  disabled?: boolean;
  readonly?: boolean;
  onChange: (value: string) => void;
  formContext?: { locale?: string | null };
}

interface PickerState {
  open: boolean;
  loading: boolean;
  error: string | null;
  results: InstallationSummary[];
  activeIndex: number;
  selected: InstallationSummary | null;
}

const SWALLOW = (): void => {
  /* intentional: errors are surfaced via state.error */
};

class InstallationPicker extends React.Component<PickerProps, PickerState> {
  private aborter: AbortController | null = null;
  private readonly containerRef = React.createRef<HTMLDivElement>();
  private cachedPluginId: string | null = null;
  private fetchedOnce = false;
  private mounted = false;

  constructor(props: PickerProps) {
    super(props);
    this.state = {
      open: false,
      loading: false,
      error: null,
      results: [],
      activeIndex: -1,
      selected: null,
    };
  }

  override componentDidMount(): void {
    this.mounted = true;
    document.addEventListener("mousedown", this.handleOutsideClick);
    // Pre-fetch when a value is already set so the resolved title can show.
    if (this.props.value) {
      void this.ensureLoaded().catch(SWALLOW);
    }
  }

  override componentWillUnmount(): void {
    this.mounted = false;
    document.removeEventListener("mousedown", this.handleOutsideClick);
    this.abortActive();
  }

  override componentDidUpdate(prevProps: PickerProps): void {
    if (!this.mounted) return;
    if (prevProps.value !== this.props.value) {
      const match = this.state.results.find((r) => r.id === this.props.value);
      this.setState({ selected: match ?? null });
    }
  }

  private abortActive(): void {
    if (this.aborter) {
      try {
        this.aborter.abort();
      } catch {
        /* noop */
      }
      this.aborter = null;
    }
  }

  private readonly handleOutsideClick = (e: MouseEvent): void => {
    if (!this.mounted) return;
    const root = this.containerRef.current;
    if (!root || root.contains(e.target as Node)) return;
    if (!this.state.open) return;
    this.setState({ open: false, activeIndex: -1 });
  };

  private async ensureLoaded(): Promise<void> {
    if (this.fetchedOnce && this.state.results.length > 0) return;
    if (!PLUGIN_URL) {
      if (this.mounted) {
        this.setState({
          error:
            "Cannot determine plugin server URL. The widget bundle must be served from the plugin host.",
        });
      }
      return;
    }
    this.abortActive();
    this.aborter = new AbortController();
    if (this.mounted) this.setState({ loading: true, error: null });
    try {
      const pluginId =
        this.cachedPluginId ?? (await this.resolvePluginId(this.aborter.signal));
      this.cachedPluginId = pluginId;
      const locale = this.props.formContext?.locale ?? null;
      const results = await fetchManageableInstallations(pluginId, {
        locale,
        signal: this.aborter.signal,
      });
      this.fetchedOnce = true;
      if (!this.mounted) return;
      const selected = this.props.value
        ? (results.find((r) => r.id === this.props.value) ?? null)
        : null;
      this.setState({
        loading: false,
        results,
        selected,
        activeIndex: results.length > 0 ? 0 : -1,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!this.mounted) return;
      const message =
        err instanceof Error ? err.message : "Failed to load installations.";
      this.setState({ loading: false, error: message });
    } finally {
      this.aborter = null;
    }
  }

  private async resolvePluginId(signal: AbortSignal): Promise<string> {
    const discovery = await fetchDiscovery(PLUGIN_URL, signal);
    return discovery.pluginId;
  }

  private readonly handleToggle = (): void => {
    if (this.props.disabled || this.props.readonly) return;
    this.setState(
      (prev) => ({ open: !prev.open }),
      () => {
        if (this.state.open) void this.ensureLoaded().catch(SWALLOW);
      }
    );
  };

  private readonly handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const { open, results, activeIndex } = this.state;
    if (e.key === "Escape") {
      e.preventDefault();
      this.setState({ open: false, activeIndex: -1 });
      return;
    }
    if (!open) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        this.handleToggle();
      }
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.setState({
        activeIndex: activeIndex < results.length - 1 ? activeIndex + 1 : 0,
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.setState({
        activeIndex: activeIndex > 0 ? activeIndex - 1 : results.length - 1,
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const idx = Math.max(activeIndex, 0);
      const target = results[idx];
      if (target) this.select(target);
    }
  };

  private select(item: InstallationSummary): void {
    this.props.onChange(item.id);
    this.setState({ selected: item, open: false, activeIndex: -1 });
  }

  private renderListBody(
    loading: boolean,
    results: InstallationSummary[],
    activeIndex: number,
    optionStyle: React.CSSProperties
  ): React.ReactNode {
    if (loading) {
      return (
        <li style={{ ...optionStyle, color: "#7a8791", cursor: "default" }}>
          Loading installations…
        </li>
      );
    }
    if (results.length === 0) {
      return (
        <li style={{ ...optionStyle, color: "#7a8791", cursor: "default" }}>
          No installations available.
        </li>
      );
    }
    return results.map((item, idx) => {
      const active = idx === activeIndex;
      return (
        <li
          key={item.id}
          role="option"
          aria-selected={active}
          onMouseEnter={() => this.setState({ activeIndex: idx })}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => this.select(item)}
          style={{ ...optionStyle, background: active ? "#f5f5f5" : "#fff" }}
        >
          <span
            style={{
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.title}
          </span>
          <span
            style={{
              fontSize: 12,
              color: "#7a8791",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.staffbaseUrl ? `${item.staffbaseUrl} · ` : ""}
            {item.id}
          </span>
        </li>
      );
    });
  }

  override render(): React.ReactNode {
    const { id, disabled, readonly } = this.props;
    const { open, loading, error, results, activeIndex, selected } = this.state;
    const interactive = !disabled && !readonly;
    const listId = `${id ?? "installation-picker"}-listbox`;
    const fallbackLabel = this.props.value
      ? `Loading installation ${this.props.value.slice(0, 8)}…`
      : "Select an installation…";

    const triggerStyle: React.CSSProperties = {
      minHeight: 48,
      backgroundColor: "rgb(250, 250, 250)",
      borderColor: "rgb(229, 229, 229)",
      padding: "0 11px",
      borderStyle: "solid",
      borderWidth: 1,
      borderRadius: 4,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      cursor: interactive ? "pointer" : "default",
      gap: 8,
    };
    const optionStyle: React.CSSProperties = {
      display: "flex",
      flexDirection: "column",
      padding: "8px 12px",
      cursor: "pointer",
    };

    const labelText = selected?.title ?? fallbackLabel;

    return (
      <div
        ref={this.containerRef}
        className="installation-picker"
        style={{ position: "relative", width: "100%" }}
      >
        <div
          id={id}
          role="combobox"
          aria-controls={listId}
          aria-expanded={open}
          aria-haspopup="listbox"
          tabIndex={interactive ? 0 : -1}
          aria-disabled={!interactive}
          onClick={this.handleToggle}
          onKeyDown={this.handleKeyDown}
          style={triggerStyle}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: selected ? "inherit" : "#7a8791",
            }}
            title={selected?.title ?? ""}
          >
            {labelText}
          </span>
          <span aria-hidden style={{ fontSize: 12, color: "#7a8791" }}>
            ▾
          </span>
        </div>

        {error ? (
          <p style={{ color: "#b00020", marginTop: 4, fontSize: 12 }}>{error}</p>
        ) : null}

        {open && interactive ? (
          <ul
            id={listId}
            role="listbox"
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              marginTop: 4,
              maxHeight: 240,
              overflowY: "auto",
              background: "#fff",
              border: "1px solid #ccc",
              borderRadius: 6,
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              zIndex: 1000,
              listStyle: "none",
              padding: 0,
            }}
          >
            {this.renderListBody(loading, results, activeIndex, optionStyle)}
          </ul>
        ) : null}
      </div>
    );
  }
}

export const componentName = "InstallationPickerRjsfComponent";
export const componentKind = "rjsf" as const;
export const component = InstallationPicker;
export default InstallationPicker;
