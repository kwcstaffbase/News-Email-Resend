import { TooltipNew } from "@staffbase/design";
import { useFormatDateTime, useFormatRelativeTime } from "@staffbase/design/hooks";
import { useTranslation } from "react-i18next";

interface Props {
  isoString: string;
}

function toDuration(isoString: string) {
  const diffMs = new Date(isoString).getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  const diffMonths = Math.round(diffMs / (86_400_000 * 30.44));
  const diffYears = Math.round(diffMs / (86_400_000 * 365.25));

  if (Math.abs(diffYears) >= 1) return { years: diffYears };
  if (Math.abs(diffMonths) >= 1) return { months: diffMonths };
  return { days: diffDays };
}

export function RelativeTimestamp({ isoString }: Readonly<Props>) {
  const { i18n } = useTranslation();
  const formatRelative = useFormatRelativeTime(i18n.language);
  const dateFormatter = useFormatDateTime(i18n.language, "long", "short");

  return (
    <TooltipNew.Root>
      <TooltipNew.Trigger>
        <time dateTime={isoString}>{formatRelative(toDuration(isoString))}</time>
      </TooltipNew.Trigger>
      <TooltipNew.Content is="description">
        {dateFormatter.format(new Date(isoString))}
      </TooltipNew.Content>
    </TooltipNew.Root>
  );
}
