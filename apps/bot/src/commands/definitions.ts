import { SlashCommandBuilder } from "discord.js";

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a link or search query")
    .addStringOption((option) => option.setName("query").setDescription("URL or search text").setRequired(true)),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the current queue"),
  new SlashCommandBuilder().setName("shuffle").setDescription("Toggle shuffle"),
  new SlashCommandBuilder()
    .setName("repeat")
    .setDescription("Set repeat mode")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Repeat mode")
        .setRequired(true)
        .addChoices({ name: "off", value: "off" }, { name: "track", value: "track" }, { name: "queue", value: "queue" })
    ),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set volume from 0 to 150")
    .addIntegerOption((option) => option.setName("value").setDescription("Volume").setRequired(true).setMinValue(0).setMaxValue(150)),
  new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Seek by timestamp or move forward/backward")
    .addStringOption((option) => option.setName("timestamp").setDescription("seconds, mm:ss, or hh:mm:ss").setRequired(true))
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Seek mode")
        .addChoices({ name: "absolute", value: "absolute" }, { name: "forward", value: "forward" }, { name: "backward", value: "backward" })
    ),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track")
];

export const slashCommands = commandBuilders.map((command) => command.toJSON());
