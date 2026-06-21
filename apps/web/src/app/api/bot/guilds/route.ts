import { proxyBot } from "../../../../lib/botApi";

export async function GET(request: Request) {
  return proxyBot("/api/guilds", request.headers.get("x-admin-token"));
}
