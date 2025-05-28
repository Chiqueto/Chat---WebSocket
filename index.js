import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const db = await pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const setupDatabase = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name TEXT
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        id_user INTEGER,
        client_offset TEXT UNIQUE,
        content TEXT,
        FOREIGN KEY (id_user) REFERENCES users(id)
  `);
};

await setupDatabase();

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
  const result = await db.query(
    "INSERT INTO users (name) VALUES ($1) RETURNING id",
    [name]
  );
  return res.status(201).json({ id: result.rows[0].id, name });
});

io.emit("hello", "world");

io.on("connection", async (socket) => {
  socket.on("chat message", async (msg, userId) => {
    let result;
    try {
      result = await db.query(
        "INSERT INTO messages (content, id_user) VALUES ($1, $2) RETURNING id",
        [msg, userId]
      );
    } catch (e) {
      console.error("failed to store message", e);
      return;
    }
    const newId = result.rows[0].id;

    const selectResult = await db.query(
      `SELECT messages.id, messages.content, users.name 
   FROM messages 
   JOIN users ON users.id = messages.id_user 
   WHERE messages.id = $1`,
      [newId]
    );

    const row = selectResult.rows[0];

    io.emit("chat message", row.content, row.name, row.id);
  });

  if (!socket.recovered) {
    try {
      const result = await db.query(
        `SELECT messages.id, messages.content, users.name 
         FROM messages 
         JOIN users ON users.id = messages.id_user 
         WHERE messages.id > $1`,
        [socket.handshake.auth.serverOffset || 0]
      );

      for (const row of result.rows) {
        socket.emit("chat message", row.content, row.name, row.id);
      }
    } catch (e) {
      console.error("Falha ao recuperar mensagens:", e);
    }
  }
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`server running at http://localhost:${port}`);
});
