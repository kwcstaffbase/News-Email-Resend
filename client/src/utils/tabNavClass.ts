export function tabNavClass(isActive: boolean): string {
  return isActive
    ? "text-label-sm font-semibold text-neutral-strong text-white bg-black rounded-sm px-10 py-10 shrink-0 shadow-sm"
    : "text-label-sm text-neutral-medium hover:text-neutral-strong px-2 py-2 shrink-0 transition-colors";
}
