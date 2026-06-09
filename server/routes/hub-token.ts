import type { AuthUser } from "../auth";

export async function hubTokenRoute(req: Request, user: AuthUser | undefined): Promise<Response> {
  if (req.method !== "GET") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  if (!user?.sub || !user.sub.startsWith("mat_")) {
    return Response.json({ error: "hub_token_unavailable" }, { status: 404 });
  }

  return Response.json({ accessToken: user.sub });
}
