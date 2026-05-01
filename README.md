# Discord Availability Bot

A Discord bot that lets your team mark their free time and find the best meeting slots — just like when2meet, but built into Discord.

## Features
- `/availability` — Opens an interactive grid. Pick a day, then click hour buttons to toggle free/busy. Only you see this (ephemeral).
- `/schedule` — Posts a public heatmap showing when the most people are free.
- `/findmeeting` — Finds the top 5 time slots where the most people overlap.
- `/clearavailability` — Clears your slots for the current week.

## Setup

### 1. Create a Discord Application
1. Go to https://discord.com/developers/applications
2. Click **New Application**, give it a name.
3. Go to **Bot** → click **Add Bot**.
4. Under **Token**, click **Reset Token** and copy it. This is your `DISCORD_TOKEN`.
5. Under **OAuth2 → General**, copy your **Application ID**. This is your `DISCORD_CLIENT_ID`.

### 2. Invite the Bot to Your Server
Go to **OAuth2 → URL Generator**:
- Scopes: `bot`, `applications.commands`
- Bot Permissions: `Send Messages`, `Use Slash Commands`, `Embed Links`

Copy the generated URL and open it in your browser to invite the bot.

### 3. Install & Run

```bash
# Install dependencies
npm install

# Set environment variables (or use a .env file with dotenv)
export DISCORD_TOKEN=your_token_here
export DISCORD_CLIENT_ID=your_client_id_here

# Start the bot
npm start
```

### Optional: Use a .env file
Install dotenv: `npm install dotenv`
Create `.env`:
```
DISCORD_TOKEN=your_token_here
DISCORD_CLIENT_ID=your_client_id_here
```
Add this line at the top of `bot.js`:
```js
require('dotenv').config();
```

## How It Works
1. Each team member runs `/availability` and clicks buttons to mark when they're free.
2. Anyone can run `/schedule` to see the colour-coded heatmap.
3. Run `/findmeeting` to get the top 5 best slots for a meeting.

## Data Storage
Availability is stored in `availability_data.json`. For production, replace the `loadData`/`saveData` functions with a proper database (e.g. SQLite, MongoDB, or PostgreSQL).

## Customization
- **Timezones**: Currently uses server-local time. Add a `/settimezone` command and store per-user timezone offsets.
- **Recurring weeks**: The bot auto-tracks current and next weeks via the `week` option.
- **Notifications**: Add a cron job to post the heatmap every Monday morning.
