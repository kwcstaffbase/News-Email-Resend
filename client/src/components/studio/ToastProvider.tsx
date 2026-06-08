import { PlainGrowl } from "@staffbase/design";
import type { RefCallback } from "react";
import { createPortal } from "react-dom";
import hotToast, { type ToastOptions, useToaster } from "react-hot-toast/headless";

export function ToastProvider() {
  const { toasts, handlers } = useToaster();
  const { startPause, endPause, updateHeight } = handlers;

  return createPortal(
    <section
      aria-label="Notifications"
      aria-live="polite"
      className="absolute top-16 right-16 z-9999 ml-16 flex flex-col gap-8"
      onMouseEnter={startPause}
      onMouseLeave={endPause}
    >
      {toasts.map((t) => {
        const ref: RefCallback<HTMLElement> = (el) => {
          if (el !== null && t.height === undefined) {
            updateHeight(t.id, el.getBoundingClientRect().height);
          }
        };

        return (
          <PlainGrowl
            key={t.id}
            ref={ref}
            style={{ opacity: t.visible ? 1 : 0 }}
            variant={t.type === "error" ? "critical" : "success"}
            className="w-72 transition-opacity duration-300"
            {...t.ariaProps}
          >
            {t.message as string}
          </PlainGrowl>
        );
      })}
    </section>,
    document.body
  );
}

export const toast = {
  success: (message: string, options?: ToastOptions) => hotToast.success(message, options),
  error: (message: string, options?: ToastOptions) => hotToast.error(message, options),
};
