import type { HTMLAttributes } from "react";
import type { NavLinkProps } from "react-router-dom";
import { NavLink } from "react-router-dom";

import { cn } from "../../utils/cn.ts";

/**
 * Studio-style page header with compound sub-components.
 * Copied from experience-studio libs/components/src/studioheader/StudioHeader.tsx
 * Adaptation: @exs/routing NavLink → react-router-dom NavLink (same API).
 */

const StudioHeaderTitle = (props: HTMLAttributes<HTMLHeadingElement>) => {
  const { children, className, ...rest } = props;
  return (
    <h1
      {...rest}
      className={cn("m-0 me-8 shrink-0 text-display", className, "ds-studio-header__title")}
    >
      {children}
    </h1>
  );
};

const StudioHeaderDescription = (props: HTMLAttributes<HTMLParagraphElement>) => (
  <p
    {...props}
    className={cn(
      "m-0 max-w-[600px] text-12 leading-16 text-neutral-medium",
      props.className,
      "ds-studio-header__description"
    )}
  />
);

const StudioHeaderArea = (props: HTMLAttributes<HTMLDivElement>) => (
  <div
    {...props}
    className={cn(
      "flex gap-8 [&_.ds-ghost-button]:whitespace-nowrap",
      props.className,
      "ds-studio-header__item"
    )}
  />
);

const StudioHeaderBox = (props: HTMLAttributes<HTMLDivElement>) => (
  <div
    {...props}
    className={cn(
      "flex flex-col items-start justify-start",
      props.className,
      "ds-studio-header__box"
    )}
  />
);

const StudioHeaderTierOne = (props: HTMLAttributes<HTMLElement>) => (
  <section
    {...props}
    className={cn(
      "flex items-center justify-between border-b border-b-neutral-weak px-40 py-24",
      props.className,
      "ds-studio-header__tier-one"
    )}
  />
);

const StudioHeaderTierTwo = (props: HTMLAttributes<HTMLElement>) => (
  <section
    {...props}
    className={cn(
      "flex items-center justify-between border-b border-b-neutral-weak px-40 py-12",
      props.className,
      "ds-studio-header__tier-two"
    )}
  />
);

const StudioHeaderTierNavigation = (props: HTMLAttributes<HTMLElement>) => (
  <nav
    {...props}
    className={cn(
      "flex h-[46px] items-center justify-between border-b border-b-neutral-weak px-40",
      props.className,
      "ds-studio-header__tier-navigation"
    )}
  />
);

const StudioHeaderNavLink = (props: NavLinkProps) => {
  const { to, className, ...rest } = props;

  return (
    <NavLink
      {...rest}
      to={to}
      className={(args) =>
        cn(
          "relative inline-flex h-[32px] items-center rounded-8 px-8 hover:bg-neutral-surface-hover active:bg-neutral-surface-pressed",
          args.isActive
            ? "text-title-sm after:absolute after:-bottom-[7px] after:left-0 after:block after:h-[2px] after:w-full after:rounded-t-8 after:bg-neutral-strong"
            : "text-label-sm",
          typeof className === "string" ? className : className?.(args)
        )
      }
    />
  );
};

const StudioHeader = (props: HTMLAttributes<HTMLElement>) => (
  <header
    {...props}
    className={cn("w-full bg-neutral-surface", props.className, "ds-studio-header")}
  />
);

StudioHeader.TierNavigation = StudioHeaderTierNavigation;
StudioHeader.TierTwo = StudioHeaderTierTwo;
StudioHeader.TierOne = StudioHeaderTierOne;
StudioHeader.NavLink = StudioHeaderNavLink;
StudioHeader.Area = StudioHeaderArea;
StudioHeader.Box = StudioHeaderBox;
StudioHeader.Title = StudioHeaderTitle;
StudioHeader.Description = StudioHeaderDescription;

export default StudioHeader;
