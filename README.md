# pqfinder — Discord LFG/Party Bot

A lightweight Discord bot for creating and managing gaming parties using native Discord UI (slash commands, modals, buttons). Parties are server-scoped — each server has its own independent parties.

## Requirements

- **Node.js** 18+ (Node 24 tested)
- A [Discord Application](https://discord.com/developers/applications) with a bot user

## Setup

### 1. Clone & install

```bash
npm install
```

### 2. Create a Discord Application

1. Go to https://discord.com/developers/applications
2. Click **New Application**, give it a name
3. Go to the **Bot** tab, click **Reset Token** and copy the token
4. Under *Privileged Gateway Intents*, **all are optional** — leave them off

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```
DISCORD_TOKEN=your_bot_token_here
```

### 4. Invite the bot to your server

```
https://discord.com/api/oauth2/authorize?client_id=1508562288766877746&permissions=83968&scope=bot%20applications.commands
```

Required permissions:
- **Send Messages**
- **Embed Links**
- **Read Message History**

### 5. Run

```bash
npm start
```

The `/lfg` command is registered globally and may take a few minutes to appear in all servers. Restarting the bot speeds up propagation.

## Usage

### Create a party — `/lfg`

1. Type `/lfg` in any channel
2. Fill out the modal:
   - **Party Title / Game Name** (required, max 100 chars)
   - **Max Members** (required, 1–32, default 4)
   - **Details / Requirements** (optional, max 1000 chars)
3. Submit — the bot posts a party embed in the channel

### Party embed (everyone sees)

| Button  | Who can use it | What it does |
|---------|---------------|--------------|
| **Join**   | Anyone not in the party | Adds you to the party (disabled when full) |
| **Leave**  | Anyone in the party     | Removes you from the party |
| **Manage** | Creator only            | Opens the admin panel; non-creators get a "not authorized" message |

- A user can be in **multiple parties** at the same time
- If the last member leaves, the party closes automatically

### Admin panel (ephemeral, creator only)

| Button   | What it does |
|----------|-------------|
| **Edit**   | Opens a pre-filled modal to change title / description |
| **Close**  | Deletes the party embed and removes it from the database |
| **Remove** | Shows a select menu to kick a non-creator member |

## Cleanup

Parties older than **24 hours** are automatically removed. Runs on startup and every hour thereafter. If a party embed is deleted manually, the database entry is cleaned up on the fly.


## Project structure

```
pqfinder/
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── src/
│   ├── index.js       # Bot entry — commands, modals, buttons, admin panel
│   ├── db.js          # SQLite wrapper
│   ├── cleanup.js     # 24-hour stale party purger
│   └── purge.js       # Manual full-purge script (operator only)
└── data/
    └── parties.db     # Created on first run (gitignored)
```
