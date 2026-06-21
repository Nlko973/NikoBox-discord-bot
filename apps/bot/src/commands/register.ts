import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { slashCommands } from "./definitions.js";
import type { Env } from "../env.js";

export async function registerCommands(env: Env) {
  const rest = new REST({ version: "10" }).setToken(env.discordToken);
  if (env.discordGuildIds.length > 0) {
    await Promise.all(
      env.discordGuildIds.map((guildId) =>
        rest.put(Routes.applicationGuildCommands(env.discordClientId, guildId), { body: slashCommands })
      )
    );
    return;
  }
  await rest.put(Routes.applicationCommands(env.discordClientId), { body: slashCommands });
}
