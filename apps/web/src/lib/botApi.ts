const botUrl = process.env.BOT_API_URL ?? "http://localhost:4000";

export async function proxyBot(path: string, token: string | null, init: RequestInit = {}) {
  const response = await fetch(`${botUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": token ?? "",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" }
  });
}
