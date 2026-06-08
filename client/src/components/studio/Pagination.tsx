import * as RadixSelect from "@radix-ui/react-select";
import { ArrowLeftIcon, ArrowRightIcon, CaretDownIcon, IconGhostButton } from "@staffbase/design";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn.ts";

/**
 * Pagination building blocks.
 * Mirrors the pattern from experience-studio libs/components/src/pagination/.
 * Uses page-number (offset) based navigation — adapted for list views
 * that paginate via page/limit rather than cursor-based pagination.
 */

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

interface PaginationProps {
  children: ReactNode;
  className?: string;
}

export function Pagination({ children, className }: Readonly<PaginationProps>) {
  return <div className={cn("flex justify-between p-16 mt-40", className)}>{children}</div>;
}

Pagination.displayName = "Pagination";

// ---------------------------------------------------------------------------
// Info — "from–to of total"
// ---------------------------------------------------------------------------

interface PaginationInfoProps {
  from: number;
  to: number;
  total: number;
  className?: string;
}

function Info({ from, to, total, className }: Readonly<PaginationInfoProps>) {
  return (
    <div
      className={cn(
        "flex h-8 items-center justify-center border-r-2 border-neutral-weak pr-12 text-body-sm text-neutral-medium",
        className
      )}
    >
      {from}–{to} of {total}
    </div>
  );
}

Info.displayName = "Pagination.Info";

// ---------------------------------------------------------------------------
// Limit — per-page <select>
// ---------------------------------------------------------------------------

interface PaginationLimitProps {
  options: number[] | readonly number[];
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  className?: string;
}

function Limit({
  options,
  value,
  onChange,
  disabled,
  className = "text-neutral-strong",
}: Readonly<PaginationLimitProps>) {
  return (
    <div className={cn("flex items-center gap-8 text-label-sm", className)}>
      <RadixSelect.Root
        disabled={disabled}
        value={value.toString()}
        onValueChange={(next) => onChange(Number.parseInt(next, 10))}
      >
        <RadixSelect.Trigger
          className="group flex h-[32px] items-center gap-8 rounded-8 bg-neutral-medium px-12 text-body-sm text-neutral-strong disabled:text-neutral-placeholder"
          aria-label="Rows per page"
        >
          {value}
          <CaretDownIcon className="w-[12px] text-icon-neutral-medium group-disabled:text-icon-neutral-weak group-data-[state=open]:rotate-180" />
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            className="min-w-[64px] rounded-8 border border-neutral-weak bg-neutral-surface p-8 shadow-lg focus:outline-hidden"
            position="popper"
            side="bottom"
            align="start"
            sideOffset={4}
          >
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item
                  key={option}
                  value={option.toString()}
                  className="cursor-pointer rounded-4 px-4 text-neutral-strong focus:outline-hidden data-highlighted:bg-neutral-surface-hover data-[state=checked]:bg-primary-weak data-[state=checked]:data-highlighted:bg-primary-weak-hover"
                >
                  <RadixSelect.ItemText>{option}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>

      <span>per page</span>
    </div>
  );
}

Limit.displayName = "Pagination.Limit";

// ---------------------------------------------------------------------------
// Controls — prev / next
// ---------------------------------------------------------------------------

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

function Controls({ page, totalPages, onPageChange, disabled }: Readonly<PaginationControlsProps>) {
  return (
    <div className="flex items-center gap-8">
      <IconGhostButton
        variant="secondary"
        className="bg-transparent!"
        title="Previous page"
        icon={<ArrowLeftIcon />}
        disabled={(disabled ?? false) || page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
        type="button"
      />
      <IconGhostButton
        variant="secondary"
        className="bg-transparent!"
        title="Next page"
        icon={<ArrowRightIcon />}
        disabled={(disabled ?? false) || page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        type="button"
      />
    </div>
  );
}

Controls.displayName = "Pagination.Controls";

// ---------------------------------------------------------------------------
// Attach sub-components
// ---------------------------------------------------------------------------

Pagination.Info = Info;
Pagination.Limit = Limit;
Pagination.Controls = Controls;
