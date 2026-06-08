import { Button } from "@staffbase/design";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import StudioHeader from "../components/studio/StudioHeader.tsx";
import { toast } from "../components/studio/ToastProvider.tsx";
import { getToken } from "../token.ts";

interface LocaldevResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export async function postLocaldev(
  path: "seed" | "clear",
  fetchFn: typeof fetch = fetch
): Promise<LocaldevResult> {
  const res = await fetchFn(`/api/localdev/${path}`, { method: "POST" });
  if (!res.ok) {
    // Non-OK bodies are often not JSON (e.g. a plain "404 Not Found" when the
    // localdev routes aren't mounted because NODE_ENV !== "development"). Never
    // blind-parse them — surface a clear status error instead of a cryptic
    // "Unexpected non-whitespace character after JSON" from JSON.parse.
    throw new Error(
      `HTTP ${res.status} from /api/localdev/${path} — localdev routes need IS_LOCALDEV=true and NODE_ENV=development.`
    );
  }
  const body: LocaldevResult = await res.json();
  if (!body.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body;
}

export default function DevView() {
  const queryClient = useQueryClient();

  const seedMutation = useMutation({
    mutationFn: () => postLocaldev("seed"),
    onSuccess: (data) => {
      toast.success(data.message ?? "Seeded.");
      queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(`Seed failed: ${(err as Error).message}`),
  });

  const clearMutation = useMutation({
    mutationFn: () => postLocaldev("clear"),
    onSuccess: (data) => {
      toast.success(data.message ?? "Cleared.");
      queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(`Clear failed: ${(err as Error).message}`),
  });

  // Safety guard: only show this page when running locally with a "dev" token
  if (getToken() !== "dev") {
    return <Navigate to="/" replace />;
  }

  const isBusy = seedMutation.isPending || clearMutation.isPending;

  return (
    <div className="flex h-full flex-col">
      <StudioHeader>
        <StudioHeader.TierOne>
          <StudioHeader.Title>Dev Tools</StudioHeader.Title>
        </StudioHeader.TierOne>
      </StudioHeader>

      <div className="flex-1 overflow-auto px-40 py-32">
        <div className="mx-auto flex max-w-xl flex-col gap-16">
          <div className="rounded-4 border border-neutral-weak bg-white px-24 py-20">
            <p className="mb-4 text-14 font-semibold text-neutral-strong">Sample data</p>
            <p className="mb-16 text-12 text-neutral-medium">
              Insert ~20 generic <code>items</code> (mix of categories and statuses) so the admin
              table, filters, sort, and pagination have something to render. Re-running seed wipes
              the existing rows for this instance first.
            </p>
            <div className="flex gap-8">
              <Button variant="primary" disabled={isBusy} onClick={() => seedMutation.mutate()}>
                {seedMutation.isPending ? "Seeding…" : "Seed sample data"}
              </Button>
              <Button variant="critical" disabled={isBusy} onClick={() => clearMutation.mutate()}>
                {clearMutation.isPending ? "Clearing…" : "Clear all data"}
              </Button>
            </div>
          </div>

          <div className="rounded-4 border border-neutral-weak bg-white px-24 py-20">
            <p className="mb-4 text-14 font-semibold text-neutral-strong">
              Dev tooling — extend here
            </p>
            <p className="text-12 text-neutral-medium">
              Add localdev-only utilities to <code>client/src/pages/DevView.tsx</code> (UI) and{" "}
              <code>server/src/routes/localdev.ts</code> (HTTP handlers). This page only renders
              when the synthetic "dev" token is set by the IS_LOCALDEV bypass — it is never
              reachable in production.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
