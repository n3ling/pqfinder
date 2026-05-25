const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'parties.db');

let db;

function init() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS parties (
      message_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      max_size INTEGER DEFAULT 4,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS party_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES parties(message_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_members_message_id ON party_members(message_id);
    CREATE INDEX IF NOT EXISTS idx_parties_created_at ON parties(created_at);
  `);

  return db;
}

function createParty(messageId, guildId, channelId, creatorId, title, description, maxSize = 4) {
  const stmt = db.prepare(
    'INSERT INTO parties (message_id, guild_id, channel_id, creator_id, title, description, max_size) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  stmt.run(messageId, guildId, channelId, creatorId, title, description, maxSize);
  addMember(messageId, creatorId);
}

function getParty(messageId) {
  return db.prepare('SELECT * FROM parties WHERE message_id = ?').get(messageId);
}

function updateParty(messageId, title, description) {
  db.prepare('UPDATE parties SET title = ?, description = ? WHERE message_id = ?').run(title, description, messageId);
}

function getMembers(messageId) {
  return db.prepare('SELECT user_id FROM party_members WHERE message_id = ?').all(messageId);
}

function addMember(messageId, userId) {
  const existing = db.prepare('SELECT 1 FROM party_members WHERE message_id = ? AND user_id = ?').get(messageId, userId);
  if (existing) return false;

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM party_members WHERE message_id = ?').get(messageId);
  const party = getParty(messageId);
  if (count >= party.max_size) return false;

  db.prepare('INSERT INTO party_members (message_id, user_id) VALUES (?, ?)').run(messageId, userId);
  return true;
}

function removeMember(messageId, userId) {
  const { changes } = db.prepare('DELETE FROM party_members WHERE message_id = ? AND user_id = ?').run(messageId, userId);
  return changes > 0;
}

function deleteParty(messageId) {
  const delMembers = db.prepare('DELETE FROM party_members WHERE message_id = ?');
  const delParty = db.prepare('DELETE FROM parties WHERE message_id = ?');
  const transaction = db.transaction(() => {
    delMembers.run(messageId);
    delParty.run(messageId);
  });
  transaction();
}

function getAllParties() {
  return db.prepare('SELECT * FROM parties').all();
}

function getOldParties(hoursOld = 24) {
  return db.prepare(
    "SELECT * FROM parties WHERE created_at < datetime('now', ?)"
  ).all(`-${hoursOld} hours`);
}

function close() {
  if (db) db.close();
}

module.exports = {
  init, createParty, getParty, updateParty,
  getMembers, addMember, removeMember, deleteParty, getAllParties,
  getOldParties, close,
};
