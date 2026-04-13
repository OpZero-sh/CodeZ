import { stateStore } from "../state";

export async function stateRoutes(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method;

  if (method === "GET" && url.pathname === "/api/state") {
    return Response.json(stateStore.getAll());
  }

  if (method === "PATCH" && url.pathname === "/api/state") {
    const body = await req.json();
    const current = stateStore.getAll();
    const merged = {
      markers: { ...current.markers, ...(body.markers ?? {}) },
      preferences: { ...current.preferences, ...(body.preferences ?? {}) },
      recentCwds: body.recentCwds ?? current.recentCwds,
    };
    stateStore.set("markers", merged.markers);
    stateStore.set("preferences", merged.preferences);
    stateStore.set("recentCwds", merged.recentCwds);
    await stateStore.save();
    return Response.json(stateStore.getAll());
  }

  return new Response("Not Found", { status: 404 });
}