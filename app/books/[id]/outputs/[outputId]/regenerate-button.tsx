"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateOutputAction } from "@/lib/actions/outputs";

export function RegenerateOutputButton({ sessionId }: { sessionId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await regenerateOutputAction(sessionId);
          router.refresh();
        })
      }
      className="rounded border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
    >
      {pending ? "Regenerando…" : "Regenerar transcripción"}
    </button>
  );
}
