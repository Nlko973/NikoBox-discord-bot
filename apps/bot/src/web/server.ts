import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import type { Client } from "discord.js";
import type { DashboardEvent, RepeatMode, SeekMode } from "@nikobox/shared";
import type { PlayerManager } from "../music/PlayerManager.js";

export function startWebServer(client: Client, players: PlayerManager, port: number, adminToken: string) {
  const app = express();
  app.use(express.json());

  const requireAuth: express.RequestHandler = (req, res, next) => {
    if (req.header("x-admin-token") !== adminToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };

  app.get("/health", (_req, res) => res.json({ ok: true, ready: client.isReady() }));

  app.use("/api", requireAuth);

  app.get("/api/guilds", (_req, res) => {
    res.json(
      client.guilds.cache.map((guild) => ({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconURL({ size: 64 }) ?? undefined
      }))
    );
  });

  app.get("/api/guilds/:guildId/state", (req, res) => res.json(players.state(req.params.guildId)));

  app.post("/api/guilds/:guildId/play", async (req, res, next) => {
    try {
      const { query, voiceChannelId } = req.body as { query: string; voiceChannelId?: string };
      if (!voiceChannelId) throw new Error("voiceChannelId is required for dashboard play.");
      const result = await players.get(req.params.guildId).add(query, "Dashboard", voiceChannelId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/guilds/:guildId/:action", async (req, res, next) => {
    try {
      const player = players.get(req.params.guildId);
      const action = req.params.action;
      if (action === "pause") await player.pause();
      else if (action === "resume") await player.resume();
      else if (action === "skip") await player.skip();
      else if (action === "stop") await player.stop();
      else if (action === "volume") await player.setVolume(Number(req.body.volume));
      else if (action === "seek") await player.seek(req.body.value, (req.body.mode ?? "absolute") as SeekMode);
      else if (action === "repeat") player.setRepeat(req.body.repeat as RepeatMode);
      else if (action === "shuffle") player.setShuffle(Boolean(req.body.shuffle));
      else if (action === "remove") player.remove(Number(req.body.index));
      else if (action === "clear") player.clear();
      else if (action === "reorder") player.reorder(Number(req.body.from), Number(req.body.to));
      else throw new Error(`Unknown action ${action}`);
      res.json(player.snapshot());
    } catch (error) {
      next(error);
    }
  });

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: error.message });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  const broadcast = (event: DashboardEvent) => {
    const data = JSON.stringify(event);
    for (const socket of wss.clients) {
      if (socket.readyState === socket.OPEN) socket.send(data);
    }
  };

  for (const state of players.states()) {
    players.get(state.guildId).on("state", (nextState) => broadcast({ type: "state", guildId: state.guildId, state: nextState }));
  }

  const originalGet = players.get.bind(players);
  players.get = ((guildId: string) => {
    const player = originalGet(guildId);
    if (player.listenerCount("state") === 0) {
      player.on("state", (state) => broadcast({ type: "state", guildId, state }));
    }
    return player;
  }) as PlayerManager["get"];

  server.listen(port, () => {
    console.log(`Bot API listening on :${port}`);
  });
}
