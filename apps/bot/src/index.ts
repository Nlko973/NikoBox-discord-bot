import { Client, GatewayIntentBits, Partials } from "discord.js";
import { env } from "./env.js";
import { LavalinkClient } from "./lavalink/LavalinkClient.js";
import { PlayerManager } from "./music/PlayerManager.js";
import { registerCommands } from "./commands/register.js";
import { startWebServer } from "./web/server.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel]
});

client.once("ready", async () => {
  if (!client.user) throw new Error("Discord client has no user");
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands(env);

  const lavalink = new LavalinkClient({
    host: env.lavalinkHost,
    port: env.lavalinkPort,
    password: env.lavalinkPassword,
    secure: env.lavalinkSecure,
    userId: client.user.id
  });
  const players = new PlayerManager(client, lavalink);

  client.on("raw", (packet) => void players.handleRaw(packet as { t?: string; d?: Record<string, unknown> }));
  client.on("interactionCreate", (interaction) => void players.handleInteraction(interaction));

  lavalink.on("ready", () => console.log("Connected to Lavalink websocket"));
  lavalink.on("session", (sessionId) => console.log(`Lavalink session ${sessionId}`));
  lavalink.on("error", (error) => console.error("Lavalink error", error));
  lavalink.connect();

  startWebServer(client, players, env.botPort, env.dashboardAdminToken);
});

process.on("SIGTERM", () => {
  client.destroy();
  process.exit(0);
});

await client.login(env.discordToken);
