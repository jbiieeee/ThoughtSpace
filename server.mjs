import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "notes.json");
const port = Number(process.env.PORT) || 4173;
const categories = new Set(["Ideas", "Questions", "Life", "Creativity", "Just because"]);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };
let writeQueue = Promise.resolve();
let mutationQueue = Promise.resolve();
const eventClients = new Set();

await mkdir(dataDir, { recursive: true });
try { await readFile(dataFile, "utf8"); } catch { await writeFile(dataFile, "[]\n", "utf8"); }

async function readNotes() { return JSON.parse(await readFile(dataFile, "utf8")); }
function publicNote(note) { const { likedBy = [], replies = [], ...data } = note; return { ...data, likes: likedBy.length, replyCount: replies.length }; }
function persist(notes) {
  writeQueue = writeQueue.then(async () => {
    const temp = `${dataFile}.tmp`;
    await writeFile(temp, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
    await rename(temp, dataFile);
  });
  return writeQueue;
}
function mutateNotes(change) {
  const task = mutationQueue.then(async () => {
    const notes = await readNotes();
    const result = change(notes);
    if (result.persist !== false) await persist(notes);
    return result;
  });
  mutationQueue = task.then(() => undefined, () => undefined);
  return task;
}
function send(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function broadcast(name, value) {
  const message = `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`;
  for (const client of eventClients) client.write(message);
}
async function bodyJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 12_000) throw new Error("Request too large");
  }
  return JSON.parse(body || "{}");
}

const server = createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { return send(res, 400, { error: "Invalid URL" }); }

  try {
    if (pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write("retry: 3000\nevent: ready\ndata: {}\n\n");
      eventClients.add(res);
      const keepAlive = setInterval(() => { if (!res.destroyed) res.write(": keep-alive\n\n"); }, 20000);
      res.on("close", () => { clearInterval(keepAlive); eventClients.delete(res); });
      return;
    }
    if (pathname === "/api/notes" && req.method === "GET") {
      const notes = await readNotes();
      return send(res, 200, notes.sort((a, b) => b.createdAt - a.createdAt).map(publicNote));
    }
    if (pathname === "/api/notes" && req.method === "POST") {
      const data = await bodyJson(req);
      const content = typeof data.content === "string" ? data.content.trim() : "";
      const title = typeof data.title === "string" ? data.title.trim().slice(0, 90) : "";
      const author = typeof data.author === "string" ? data.author.trim().slice(0, 40) || "Someone" : "Someone";
      const category = categories.has(data.category) ? data.category : "";
      if (!content || content.length > 500) return send(res, 400, { error: "A note must contain 1 to 500 characters." });
      const anonymous = data.anonymous === true;
      const note = { id: randomUUID(), title, content, category, anonymous, author: anonymous ? "" : author, createdAt: Date.now(), likedBy: [], replies: [] };
      await mutateNotes(notes => { notes.unshift(note); return { note }; });
      broadcast("note:created", publicNote(note));
      return send(res, 201, publicNote(note));
    }
    const replyMatch = pathname.match(/^\/api\/notes\/([\w-]+)\/replies$/);
    if (replyMatch && req.method === "GET") {
      const notes = await readNotes(), note = notes.find(item => item.id === replyMatch[1]);
      if (!note) return send(res, 404, { error: "Note not found." });
      return send(res, 200, (note.replies || []).slice().sort((a, b) => a.createdAt - b.createdAt));
    }
    if (replyMatch && req.method === "POST") {
      const data = await bodyJson(req);
      const id = typeof data.id === "string" ? data.id.trim().slice(0, 80) : "";
      const content = typeof data.content === "string" ? data.content.trim() : "";
      const author = typeof data.author === "string" ? data.author.trim().slice(0, 40) || "Someone" : "Someone";
      const anonymous = data.anonymous === true;
      if (!id || !content || content.length > 500) return send(res, 400, { error: "A reply needs an ID and 1 to 500 characters." });
      const result = await mutateNotes(notes => {
        const note = notes.find(item => item.id === replyMatch[1]);
        if (!note) return { persist: false, missing: true };
        note.replies ||= [];
        const previous = note.replies.find(reply => reply.id === id);
        if (previous) return { persist: false, duplicate: true, reply: previous, note };
        const reply = { id, noteId: note.id, content, author: anonymous ? "" : author, anonymous, createdAt: Date.now() };
        note.replies.push(reply);
        return { reply, note };
      });
      if (result.missing) return send(res, 404, { error: "Note not found." });
      if (result.duplicate) return send(res, 200, { reply: result.reply, replyCount: result.note.replies.length });
      const payload = { noteId: result.note.id, reply: result.reply, replyCount: result.note.replies.length };
      broadcast("reply:created", payload);
      return send(res, 201, { reply: result.reply, replyCount: result.note.replies.length });
    }
    const likeMatch = pathname.match(/^\/api\/notes\/([\w-]+)\/like$/);
    if (likeMatch && req.method === "POST") {
      const data = await bodyJson(req);
      if (typeof data.clientId !== "string" || data.clientId.length > 80 || typeof data.liked !== "boolean") return send(res, 400, { error: "Invalid reaction." });
      const result = await mutateNotes(notes => {
        const note = notes.find(item => item.id === likeMatch[1]);
        if (!note) return { persist: false, missing: true };
        note.likedBy ||= [];
        note.likedBy = data.liked ? [...new Set([...note.likedBy, data.clientId])] : note.likedBy.filter(id => id !== data.clientId);
        return { note };
      });
      if (result.missing) return send(res, 404, { error: "Note not found." });
      broadcast("note:updated", publicNote(result.note));
      return send(res, 200, { likes: result.note.likedBy.length });
    }
    if (pathname.startsWith("/api/")) return send(res, 404, { error: "Not found." });
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed." });

    const requested = pathname === "/" ? "/index.html" : pathname;
    const file = path.resolve(root, `.${requested}`);
    if (!file.startsWith(`${root}${path.sep}`)) return send(res, 403, { error: "Forbidden." });
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return send(res, 404, { error: "Not found." });
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Content-Length": info.size, "X-Content-Type-Options": "nosniff" });
    if (req.method === "HEAD") return res.end();
    res.end(await readFile(file));
  } catch (error) {
    if (!res.headersSent) send(res, 500, { error: "The request could not be completed." });
    else res.end();
    console.error(error);
  }
});

server.listen(port, "0.0.0.0", () => console.log(`ThoughtSpace is running at http://localhost:${port}`));
