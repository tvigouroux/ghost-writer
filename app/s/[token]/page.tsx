import { loadRoomFromToken } from "@/lib/actions/turns";
import { Room } from "./room";

export const dynamic = "force-dynamic";

export default async function InterviewRoomPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let initial: Awaited<ReturnType<typeof loadRoomFromToken>> | null = null;
  let error: string | null = null;
  try {
    initial = await loadRoomFromToken(token);
  } catch (err) {
    error = (err as Error).message;
  }

  if (error || !initial) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold">No pudimos abrir la sala</h1>
        <p className="mt-2 text-sm text-stone-500">
          Es posible que el link haya expirado o ya no sea válido. Pedí al
          autor del libro un link nuevo.
        </p>
        {process.env.NODE_ENV === "development" ? (
          <pre className="mt-4 whitespace-pre-wrap text-xs text-stone-500">{error}</pre>
        ) : null}
      </main>
    );
  }

  return <Room token={token} initial={initial} />;
}
