import {
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  forwardRef,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "../../utils/cn.ts";

/**
 * Styled building blocks for a table of contents.
 * Contains _NO_ logic like filtering, etc. as this should be handled in the individual view/usecase.
 *
 * Copied from experience-studio libs/components/src/table/Table.tsx
 */

const TableWrapper = forwardRef<ComponentRef<"div">, ComponentPropsWithoutRef<"div">>(
  function TableWrapper(props, ref) {
    return (
      <div
        {...props}
        className={cn("w-full max-w-full overflow-x-auto", props.className)}
        ref={ref}
      />
    );
  }
);

export default function Table(props: ComponentProps<"table">): ReactElement {
  return (
    <table
      {...props}
      className={cn(
        "min-w-full table-fixed border-collapse overflow-hidden rounded-8 bg-neutral-surface",
        props.className
      )}
    />
  );
}

function TableEmpty(props: { children: ReactNode }) {
  const { children } = props;

  return (
    <tbody>
      <tr>
        <td colSpan={100} height={400}>
          <div className="grid place-items-center">{children}</div>
        </td>
      </tr>
    </tbody>
  );
}

function TableRow(props: ComponentProps<"tr">): ReactElement {
  return (
    <tr
      {...props}
      className={cn(
        "border-b border-neutral-weak align-middle last-of-type:border-b-0",
        props.className
      )}
    />
  );
}

function TableErrorRow(props: ComponentProps<"tr">) {
  return (
    <tr
      {...props}
      className={cn(
        "border-b-2 border-b-critical bg-critical-weak last-of-type:border-b-0",
        props.className
      )}
    />
  );
}

function TableHeader(props: ComponentProps<"thead">): ReactElement {
  return <thead {...props} className={cn("border-b border-neutral-weak", props.className)} />;
}

function TableHeaderCell(props: ComponentProps<"th">): ReactElement {
  return (
    <th
      {...props}
      className={cn(
        "p-24 text-start text-label-sm text-neutral-strong last-of-type:text-end [&_button]:ml-[auto]",
        props.className
      )}
    />
  );
}

function TableBody(props: ComponentProps<"tbody">) {
  return <tbody {...props} />;
}

function TableCell(props: ComponentProps<"td">): ReactElement {
  return (
    <td
      {...props}
      className={cn(
        "min-w-[100px] px-24 py-12 text-body-sm text-neutral-medium last-of-type:text-end [&_button]:ml-[auto]",
        props.className
      )}
    />
  );
}

Table.Body = TableBody;
Table.Empty = TableEmpty;
Table.Cell = TableCell;
Table.Row = TableRow;
Table.ErrorRow = TableErrorRow;
Table.Header = TableHeader;
Table.HeaderCell = TableHeaderCell;
Table.Wrap = TableWrapper;
