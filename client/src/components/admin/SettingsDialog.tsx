import {
  AlertDialog,
  AlertIcon,
  Button,
  Dialog,
  Field,
  IconGhostButton,
  TextField,
  ViewAltIcon,
  ViewIcon,
} from "@staffbase/design";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api/index.ts";
import { useAdminI18n } from "../../hooks/useAdminI18n.ts";
import { getToken } from "../../token.ts";
import { toast } from "../studio/ToastProvider.tsx";
import { ChangelogDialog } from "./ChangelogDialog.tsx";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SettingsData {
  staffbaseUrl: string | null;
  hasApiToken: boolean;
  emailServiceUrl: string | null;
}

export function SettingsDialog({ isOpen, onClose }: Readonly<SettingsDialogProps>) {
  const { t } = useAdminI18n({ keyPrefix: "settings" });
  const { t: tc } = useAdminI18n({ keyPrefix: "changelog" });
  const queryClient = useQueryClient();
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isExportingAuditLog, setIsExportingAuditLog] = useState(false);

  const { data: settingsData } = useQuery<SettingsData>({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsData>("/api/settings").then((r) => r.data),
    enabled: isOpen,
  });

  const [apiToken, setApiToken] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [isTokenRevealed, setIsTokenRevealed] = useState(false);
  const [emailServiceUrl, setEmailServiceUrl] = useState("");

  const { refetch: fetchToken, isFetching: isFetchingToken } = useQuery<{
    apiToken: string | null;
  }>({
    queryKey: ["settings", "token"],
    queryFn: () => api.get<{ apiToken: string | null }>("/api/settings/token").then((r) => r.data),
    enabled: false,
  });

  function handleRevealToken() {
    if (isTokenRevealed) {
      setApiToken("");
      setIsTokenRevealed(false);
      return;
    }
    fetchToken().then((result) => {
      const plain = result.data?.apiToken ?? "";
      setApiToken(plain);
      setIsTokenRevealed(true);
    });
  }

  useEffect(() => {
    if (settingsData !== undefined) {
      setApiToken("");
      setTokenError("");
      setEmailServiceUrl(settingsData.emailServiceUrl ?? "");
    }
  }, [settingsData]);

  const saveMutation = useMutation({
    mutationFn: (payload: { apiToken?: string | null; emailServiceUrl?: string | null }) =>
      api.put<SettingsData>("/api/settings", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
      toast.success(t("saved"));
    },
    onError: () => {
      toast.error(t("save-error"));
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => api.delete("/api/admin/clear-all"),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success(t("clear-all-success"));
      setIsClearConfirmOpen(false);
      onClose();
    },
  });

  function handleSave() {
    const trimmedToken = apiToken.trim();

    if (!trimmedToken && !settingsData?.hasApiToken) {
      setTokenError(t("api-token-required"));
      return;
    }

    const payload: Parameters<typeof saveMutation.mutate>[0] = {};
    if (trimmedToken) payload.apiToken = trimmedToken;
    // Always sync emailServiceUrl: send null to clear, or the trimmed value
    const trimmedUrl = emailServiceUrl.trim();
    payload.emailServiceUrl = trimmedUrl || null;
    saveMutation.mutate(payload);
  }

  async function handleExportAuditLog() {
    setIsExportingAuditLog(true);
    try {
      const headers: Record<string, string> = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const instanceId = globalThis.__USER__?.instanceId;
      if (instanceId) headers["X-Instance-Id"] = instanceId;
      const response = await fetch("/api/changelog/export", {
        headers,
        credentials: "include",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(tc("export-success"));
    } catch {
      toast.error(tc("export-error"));
    } finally {
      setIsExportingAuditLog(false);
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setIsClearConfirmOpen(false);
      setIsChangelogOpen(false);
      clearMutation.reset();
      saveMutation.reset();
      setTokenError("");
      setIsTokenRevealed(false);
      onClose();
    }
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Dialog.Popup className="w-[min(92vw,720px)]!">
        <Dialog.Header>
          <Dialog.Title>{t("title")}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body className="p-0!">
          <div className="flex flex-col gap-20 px-24 py-20">
            <Field.Root invalid={!!tokenError}>
              <Field.Label>{t("api-token-label")}</Field.Label>
              <Field.Description>
                {settingsData?.hasApiToken ? t("api-token-configured") : t("api-token-description")}
              </Field.Description>
              <div className="flex min-w-0 items-center gap-8">
                <div className="min-w-0 grow">
                  <TextField
                    type={isTokenRevealed ? "text" : "password"}
                    value={apiToken}
                    onChange={(e) => {
                      setApiToken(e.target.value);
                      if (isTokenRevealed) setIsTokenRevealed(false);
                      if (tokenError) setTokenError("");
                    }}
                    placeholder={
                      settingsData?.hasApiToken
                        ? t("api-token-replace-placeholder")
                        : t("api-token-placeholder")
                    }
                    autoComplete="new-password"
                  />
                </div>
                {settingsData?.hasApiToken && (
                  <IconGhostButton
                    icon={isTokenRevealed ? <ViewAltIcon /> : <ViewIcon />}
                    aria-label={t(isTokenRevealed ? "api-token-hide" : "api-token-reveal")}
                    disabled={isFetchingToken}
                    onClick={handleRevealToken}
                  />
                )}
              </div>
              {tokenError && <p className="mt-4 text-body-sm text-red-600">{tokenError}</p>}
            </Field.Root>

            <Field.Root>
              <Field.Label>{t("email-service-url-label")}</Field.Label>
              <Field.Description>{t("email-service-url-description")}</Field.Description>
              <TextField
                value={emailServiceUrl}
                onChange={(e) => setEmailServiceUrl(e.target.value)}
                placeholder={t("email-service-url-placeholder")}
                type="url"
                autoComplete="off"
              />
            </Field.Root>
          </div>

          <div className="flex flex-col divide-y divide-neutral-weak border-t border-neutral-weak px-24 py-20">
            {/* Activity Log */}
            <div className="flex flex-wrap items-start gap-x-16 gap-y-8 pb-16">
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-semibold text-neutral-strong">{tc("title")}</p>
                <p className="mt-2 text-body-sm text-neutral-medium">{tc("description")}</p>
              </div>
              <div className="flex gap-8">
                <Button variant="secondary" onClick={() => setIsChangelogOpen(true)}>
                  {tc("view-btn")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={isExportingAuditLog}
                  onClick={() => void handleExportAuditLog()}
                >
                  {isExportingAuditLog ? tc("export-loading") : tc("export-btn")}
                </Button>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="flex flex-wrap items-start gap-x-16 gap-y-8 pt-16">
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-semibold text-danger-strong">
                  {t("danger-zone-title")}
                </p>
                <p className="mt-2 text-body-sm text-neutral-medium">
                  {t("danger-zone-description")}
                </p>
              </div>
              <div>
                <Button variant="critical" onClick={() => setIsClearConfirmOpen(true)}>
                  {t("clear-all-btn")}
                </Button>
              </div>
            </div>
          </div>
        </Dialog.Body>

        <ChangelogDialog isOpen={isChangelogOpen} onClose={() => setIsChangelogOpen(false)} />

        <AlertDialog.Root
          open={isClearConfirmOpen}
          onOpenChange={(open) => {
            if (!open) {
              setIsClearConfirmOpen(false);
              clearMutation.reset();
            }
          }}
        >
          <AlertDialog.Popup>
            <AlertDialog.Icon>
              <AlertIcon />
            </AlertDialog.Icon>
            <AlertDialog.Title>{t("clear-all-title")}</AlertDialog.Title>
            <AlertDialog.Description>{t("clear-all-description")}</AlertDialog.Description>
            <AlertDialog.Action
              variant="critical"
              disabled={clearMutation.isPending}
              onClick={() => clearMutation.mutate()}
            >
              {t("clear-all-confirm")}
            </AlertDialog.Action>
            <AlertDialog.Cancel disabled={clearMutation.isPending}>
              {t("clear-all-cancel")}
            </AlertDialog.Cancel>
          </AlertDialog.Popup>
        </AlertDialog.Root>

        <Dialog.Footer>
          <Button variant="secondary" disabled={saveMutation.isPending} onClick={onClose}>
            {t("close")}
          </Button>
          <Button variant="primary" disabled={saveMutation.isPending} onClick={handleSave}>
            {saveMutation.isPending ? t("saving") : t("save")}
          </Button>
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
