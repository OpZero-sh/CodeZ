import type { AuthUser } from "../auth";
import { getStableMachineId } from "../hub";

export async function hubTokenRoute(req: Request, user: AuthUser | undefined): Promise<Response> {
  if (req.method !== "GET") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  if (!user?.sub || !user.sub.startsWith("mat_")) {
    return Response.json({ error: "hub_token_unavailable" }, { status: 404 });
  }

  // machineId lets the SPA recognize this server in the hub machine list
  // so it isn't offered twice (locally and as its own remote).
  return Response.json({ accessToken: user.sub, machineId: await getStableMachineId() });
}
