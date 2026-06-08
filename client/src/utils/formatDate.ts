import i18next from "i18next";

/**
 * Formats an ISO date string as a long-form locale date+time string.
 * Example (en-US): "December 27, 2021 at 12:49 PM"
 */
export function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString(i18next.language, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
