import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createGame, addPlayer, apply, tick, publicState } from "./public/engine.mjs";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const random = (n) => crypto.randomInt(n);
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const token = () => crypto.randomBytes(24).toString("base64url");
export function makeServer({
  dir = process.env.DATA_DIR || path.join(ROOT, "saves"),
  secure = process.env.COOKIE_SECURE === "1",
} = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const rooms = new Map(),
    streams = new Map(),
    limits = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => /^[a-f0-9]{16}\.json$/.test(f))) {
    try {
      const x = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (Date.now() - x.savedAt > 86400000) continue;
      if (x.state.status === "playing") {
        const delta = Date.now() - x.savedAt;
        x.state.phase.until += delta;
        if (x.state.trade) x.state.trade.until += delta;
        if (x.state.rescue) for (const o of x.state.rescue.offers) o.until += delta;
        x.pausedAt = Date.now();
      }
      rooms.set(x.state.id, x);
    } catch (e) {
      console.error("Не удалось восстановить сохранение:", f, e.message);
    }
  }
  function save(room) {
    room.savedAt = Date.now();
    const f = path.join(dir, room.state.id + ".json"),
      tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(room), { mode: 0o600 });
    fs.renameSync(tmp, f);
    rooms.set(room.state.id, room);
  }
  function json(res, status, data) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  }
  function session(req) {
    const raw = (req.headers.cookie || "").match(/(?:^|;\s*)kent=([^;]+)/)?.[1];
    if (!raw) return null;
    const h = hash(raw);
    for (const room of rooms.values()) {
      const id = room.auth[h];
      if (id) return { room, id };
    }
    return null;
  }
  function attach(res, room, id) {
    const secret = token();
    room.auth[hash(secret)] = id;
    res.setHeader(
      "Set-Cookie",
      `kent=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure ? "; Secure" : ""}`,
    );
  }
  function projection(room, id) {
    return {
      me: id,
      state: publicState(room.state, id),
      paused: !!room.pausedAt,
      invite: room.invite,
    };
  }
  function broadcast(room) {
    for (const item of streams.get(room.state.id) || []) {
      try {
        item.res.write("data: " + JSON.stringify(projection(room, item.id)) + "\n\n");
      } catch {}
    }
  }
  function commit(room, state) {
    const n = { ...room, state };
    save(n);
    broadcast(n);
    return n;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || "localhost";
      const url = new URL(req.url, "http://" + host);
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      if (url.pathname === "/health") {
        return json(res, 200, { ok: true, version: "0.3.0-alpha" });
      }
      if (url.pathname.startsWith("/api/")) {
        if (req.method === "POST") {
          const origin = req.headers.origin;
          let same = false;
          try {
            same = !!origin && new URL(origin).host === host;
          } catch {}
          if (!same) return json(res, 403, { error: "Запрос должен быть с адреса игры" });
          if (!String(req.headers["content-type"] || "").startsWith("application/json"))
            return json(res, 415, { error: "Нужен JSON" });
          const ip = req.socket.remoteAddress || "local",
            key = ip + ":" + (url.pathname === "/api/cmd" ? "cmd" : "join"),
            now = Date.now();
          const v = limits.get(key) || { at: now, n: 0 };
          if (now - v.at > 10000) {
            v.at = now;
            v.n = 0;
          }
          v.n++;
          limits.set(key, v);
          if (v.n > (url.pathname === "/api/cmd" ? 120 : 25))
            return json(res, 429, { error: "Слишком много запросов. Подождите." });
        }
        let body = {};
        if (req.method === "POST") {
          let raw = "";
          for await (const chunk of req) {
            raw += chunk;
            if (Buffer.byteLength(raw) > 32768) {
              json(res, 413, { error: "Запрос слишком большой" });
              return;
            }
          }
          try {
            body = JSON.parse(raw || "{}");
          } catch {
            return json(res, 400, { error: "Некорректный JSON" });
          }
        }
        if (req.method === "POST" && url.pathname === "/api/create") {
          if (rooms.size >= 200)
            return json(res, 503, {
              error: "Лимит комнат. Перезапустите после очистки старых сохранений.",
            });
          const id = crypto.randomBytes(8).toString("hex"),
            room = {
              state: createGame(id, random(2 ** 32)),
              invite: token(),
              auth: {},
              processed: {},
              savedAt: Date.now(),
              pausedAt: null,
            };
          const pid = token();
          addPlayer(room.state, pid, body.name, body.bank, body.pawn);
          attach(res, room, pid);
          save(room);
          return json(res, 201, projection(room, pid));
        }
        if (req.method === "POST" && url.pathname === "/api/join") {
          const room = [...rooms.values()].find((r) => r.invite === body.invite);
          if (!room) return json(res, 404, { error: "Приглашение не найдено" });
          const old = session(req);
          if (old?.room.state.id === room.state.id)
            return json(res, 200, projection(old.room, old.id));
          const n = structuredClone(room),
            pid = token();
          addPlayer(n.state, pid, body.name, body.bank, body.pawn);
          attach(res, n, pid);
          save(n);
          broadcast(n);
          return json(res, 200, projection(n, pid));
        }
        const a = session(req);
        if (!a) return json(res, 401, { error: "Войдите в комнату" });
        let { room, id } = a;
        if (req.method === "GET" && url.pathname === "/api/me")
          return json(res, 200, projection(room, id));
        if (req.method === "GET" && url.pathname === "/api/events") {
          if ((streams.get(room.state.id)?.size || 0) >= 24)
            return json(res, 429, { error: "Слишком много вкладок" });
          if (room.pausedAt) {
            const n = structuredClone(room),
              delta = Date.now() - n.pausedAt;
            n.state.phase.until += delta;
            if (n.state.trade) n.state.trade.until += delta;
            if (n.state.rescue) for (const o of n.state.rescue.offers) o.until += delta;
            n.pausedAt = null;
            save(n);
            room = n;
          }
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          });
          res.write("retry: 1500\n\n");
          const set = streams.get(room.state.id) || new Set();
          const item = { id, res };
          set.add(item);
          streams.set(room.state.id, set);
          broadcast(room);
          const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 10000);
          req.on("close", () => {
            clearInterval(heartbeat);
            set.delete(item);
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/cmd") {
          const key = id + ":" + body.commandId;
          if (typeof body.commandId !== "string" || body.commandId.length > 100 || !body.commandId)
            return json(res, 400, { error: "Нужен идентификатор команды" });
          if (room.processed[key])
            return json(res, 200, { ...projection(room, id), duplicate: true });
          if (body.version !== room.state.version)
            return json(res, 409, {
              error: "Состояние обновилось. Повторите действие.",
              ...projection(room, id),
            });
          if (room.pausedAt) return json(res, 409, { error: "Сначала восстановите подключение" });
          if (Object.keys(room.processed).length >= 20000)
            return json(res, 429, { error: "Достигнут защитный лимит команд комнаты" });
          const state = apply(room.state, id, body.command, Date.now(), random),
            n = { ...room, state, processed: { ...room.processed, [key]: true } };
          save(n);
          broadcast(n);
          return json(res, 200, projection(n, id));
        }
        return json(res, 404, { error: "Неизвестный адрес" });
      }
      if (req.method !== "GET") return json(res, 405, { error: "Метод недоступен" });
      const allowed = {
        "/": "index.html",
        "/index.html": "index.html",
        "/style.css": "style.css",
        "/app.mjs": "app.mjs",
        "/scene.mjs": "scene.mjs",
        "/engine.mjs": "engine.mjs",
        "/data.mjs": "data.mjs",
      };
      const file = allowed[url.pathname];
      if (!file) return json(res, 404, { error: "Страница не найдена" });
      const types = {
        html: "text/html; charset=utf-8",
        css: "text/css; charset=utf-8",
        mjs: "text/javascript; charset=utf-8",
      };
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'",
      );
      res.writeHead(200, {
        "Content-Type": types[file.split(".").at(-1)],
        "Cache-Control": "no-cache",
      });
      res.end(fs.readFileSync(path.join(ROOT, "public", file)));
    } catch (e) {
      if (!res.headersSent) json(res, 400, { error: e.message || "Не удалось выполнить действие" });
      else res.end();
    }
  });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const original of rooms.values()) {
      if (original.state.status !== "playing") continue;
      try {
        const count = streams.get(original.state.id)?.size || 0;
        if (!count) {
          if (!original.pausedAt) {
            const n = { ...original, pausedAt: now };
            save(n);
          }
          continue;
        }
        if (original.pausedAt) continue;
        const state = tick(original.state, now, random);
        if (state) commit(original, state);
      } catch (e) {
        console.error("Ошибка игрового таймера:", e.message);
      }
    }
    if (limits.size > 1000) for (const [k, v] of limits) if (now - v.at > 60000) limits.delete(k);
  }, 500);
  timer.unref();
  server.on("close", () => {
    clearInterval(timer);
    for (const set of streams.values()) for (const { res } of set) res.end();
  });
  return server;
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787),
    host = process.env.HOST || "0.0.0.0";
  makeServer().listen(port, host, () =>
    console.log(
      `Kentopoly alpha: http://localhost:${port}\nЛокальная альфа. Для интернета настройте HTTPS и COOKIE_SECURE=1.`,
    ),
  );
}
