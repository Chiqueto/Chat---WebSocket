import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// open the database file
const db = await open({
  filename: "chat.db",
  driver: sqlite3.Database,
});

await db.exec(`
  CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT
  );
`);

// create our 'messages' table (you can ignore the 'client_offset' column for now)
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

// this will emit the event to all connected sockets
io.emit("hello", "world");

io.on("connection", async (socket) => {
  socket.on("chat message", async (msg, userId) => {
    let result;
    try {
      // store the message in the database
      result = await db.run(
        "INSERT INTO messages (content, id_user) VALUES (?, ?)",
        msg,
        userId
      );
    } catch (e) {
      // TODO handle the failure
      console.error("failed to store message", e);
      return;
    }
    // include the offset with the message
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
    // if the connection state recovery was not successful
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
    } catch (e) {
      // something went wrong
    }
  }
});

server.listen(3000, () => {
  console.log("server running at http://localhost:3000");
});
