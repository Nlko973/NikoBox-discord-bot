import { proxyBot } from "../../../../../../lib/botApi";

export async function GET(request: Request, { params }: { params: { guildId: string } }) {
  return proxyBot(`/api/guilds/${params.guildId}/state`, request.headers.get("x-admin-token"));
}
