import { proxyBot } from "../../../../../../lib/botApi";

export async function POST(request: Request, { params }: { params: { guildId: string; action: string } }) {
  return proxyBot(`/api/guilds/${params.guildId}/${params.action}`, request.headers.get("x-admin-token"), {
    method: "POST",
    body: await request.text()
  });
}
