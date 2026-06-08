import { GhostButton, SettingsIcon } from "@staffbase/design";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { PostsList } from "../components/admin/PostsList.tsx";
import { SettingsDialog } from "../components/admin/SettingsDialog.tsx";
import { useAdminI18n } from "../hooks/useAdminI18n.ts";
import { useInstanceSettings } from "../hooks/useInstanceSettings.ts";
import { useAuth } from "../context/AuthContext.tsx";

export default function AdminView() {
  const { isEditor } = useAuth();
  const { t } = useAdminI18n();
  const { hasApiToken } = useInstanceSettings();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Non-editors are redirected immediately to the user view
  if (!isEditor) return <Navigate to="/" replace />;

  return (
    <>
      <div className="flex h-full flex-col bg-canvas">
        {/* Page header */}
        <header className="flex shrink-0 items-center justify-between gap-16 border-b border-neutral-weak px-24 py-16">
          <h1 className="text-heading-sm font-semibold text-neutral-strong">{t("title")}</h1>
          <GhostButton
            variant="secondary"
            icon={<SettingsIcon />}
            onClick={() => setIsSettingsOpen(true)}
          >
            {t("settings-btn")}
          </GhostButton>
        </header>

        {/* Credentials warning */}
        {!hasApiToken && (
          <div className="mx-24 mt-16 rounded-lg border border-warning-weak bg-warning-soft px-16 py-12">
            <p className="text-body-sm text-warning-strong">{t("news.credentials-missing")}</p>
          </div>
        )}

        {/* Posts list takes the remaining height */}
        <div className="flex flex-1 flex-col min-h-0">
          <PostsList />
        </div>
      </div>

      <SettingsDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
}
