import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import dotenv from "dotenv";

dotenv.config();

const db = await open({
  filename: process.env.DB_FILENAME || "chat.db",
  driver: sqlite3.Database,
});

await db.exec(`
  CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT
  );
`);

await db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_user INTEGER,
    client_offset TEXT UNIQUE,
    content TEXT,
    FOREIGN KEY (id_user) REFERENCES users(id)
  );
`);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {},
});

app.use(express.json());

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

app.post("/register", async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).send("Name is required");
  }
  const result = await db.run("INSERT INTO users (name) VALUES (?)", name);
  return res.status(201).json({ id: result.lastID, name });
});

io.emit("hello", "world");

io.on("connection", async (socket) => {
  socket.on("chat message", async (msg, userId) => {
    let result;
    try {
      result = await db.run(
        "INSERT INTO messages (content, id_user) VALUES (?, ?)",
        msg,
        userId
      );
    } catch (e) {
      console.error("failed to store message", e);
      return;
    }
    const row = await db.get(
      `SELECT messages.id, messages.content, users.name 
   FROM messages 
   JOIN users ON users.id = messages.id_user 
   WHERE messages.id = ?`,
      result.lastID
    );

    io.emit("chat message", row.content, row.name, row.id);
  });

  if (!socket.recovered) {
    try {
      await db.each(
        `SELECT messages.id, messages.content, users.name 
   FROM messages 
   JOIN users ON users.id = messages.id_user 
   WHERE messages.id > ?`,
        [socket.handshake.auth.serverOffset || 0],
        (_err, row) => {
          socket.emit("chat message", row.content, row.name, row.id);
        }
      );
    } catch (e) {}
  }
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`server running at http://localhost:${port}`);
});
