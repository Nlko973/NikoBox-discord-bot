export interface Env {
  discordToken: string;
  discordClientId: string;
  discordGuildIds: string[];
  botPort: number;
  dashboardAdminToken: string;
  lavalinkHost: string;
  lavalinkPort: number;
  lavalinkPassword: string;
  lavalinkSecure: boolean;
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  yandexMusicToken?: string;
  vkAccessToken?: string;
}

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
};

export const env: Env = {
  discordToken: required("DISCORD_TOKEN"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordGuildIds: (process.env.DISCORD_GUILD_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
  botPort: Number(process.env.BOT_PORT ?? 4000),
  dashboardAdminToken: required("DASHBOARD_ADMIN_TOKEN"),
  lavalinkHost: process.env.LAVALINK_HOST ?? "lavalink",
  lavalinkPort: Number(process.env.LAVALINK_PORT ?? 2333),
  lavalinkPassword: required("LAVALINK_PASSWORD"),
  lavalinkSecure: process.env.LAVALINK_SECURE === "true",
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  yandexMusicToken: process.env.YANDEX_MUSIC_TOKEN,
  vkAccessToken: process.env.VK_ACCESS_TOKEN
};
