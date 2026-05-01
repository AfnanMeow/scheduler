require('dotenv').config();
// Keep-alive HTTP server for Render
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running!');
});
server.listen(3000, () => {
  console.log('Keep-alive server running on port 3000');
});
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const fs = require('fs');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

// --- Data Storage (JSON file, replace with DB for production) ---
const DATA_FILE = './availability_data.json';

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- Helpers ---
function getWeekKey(offset = 0) {
  const now = new Date();
  now.setDate(now.getDate() - now.getDay() + offset * 7); // Sunday start
  return now.toISOString().slice(0, 10);
}

function getWeekLabel(weekKey) {
  const d = new Date(weekKey);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

// Build ASCII grid showing group availability heatmap
function buildGrid(guildData, weekKey) {
  const week = guildData[weekKey] || {};
  const totalMembers = Object.keys(week).length;

  // Count how many people are free at each slot
  const counts = {};
  for (const [userId, slots] of Object.entries(week)) {
    for (const slot of slots) {
      counts[slot] = (counts[slot] || 0) + 1;
    }
  }

  const emoji = (n, total) => {
    if (!n) return '⬛';
    const ratio = n / total;
    if (ratio >= 0.8) return '🟡';
    if (ratio >= 0.6) return '🟠';
    if (ratio >= 0.4) return '🔴';
    if (ratio >= 0.2) return '🟥';
    return '🔲';
  };

  let grid = '`     ' + DAYS.map(d => d.slice(0, 1)).join('  ') + '`\n';
  for (let h = 0; h < 24; h++) {
    if (h % 3 !== 0) continue; // show every 3 hours to save space
    const label = String(h).padStart(2, '0') + ':00';
    const cells = DAYS.map((_, d) => {
      const key = `${d}-${h}`;
      return emoji(counts[key] || 0, totalMembers || 1);
    }).join('');
    grid += `\`${label}\` ${cells}\n`;
  }
  return grid;
}

// Find best meeting slots
function findBestSlots(guildData, weekKey, durationHours = 1) {
  const week = guildData[weekKey] || {};
  const totalMembers = Object.keys(week).length;
  if (totalMembers === 0) return [];

  const counts = {};
  for (const [, slots] of Object.entries(week)) {
    for (const slot of slots) {
      counts[slot] = (counts[slot] || 0) + 1;
    }
  }

  const scored = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h <= 24 - durationHours; h++) {
      let minCount = Infinity;
      for (let i = 0; i < durationHours; i++) {
        minCount = Math.min(minCount, counts[`${d}-${h + i}`] || 0);
      }
      if (minCount > 0) {
        scored.push({ day: d, hour: h, count: minCount, total: totalMembers });
      }
    }
  }

  scored.sort((a, b) => b.count - a.count || a.day - a.day || a.hour - b.hour);
  return scored.slice(0, 5);
}

// --- Slash Commands Registration ---
const commands = [
  new SlashCommandBuilder()
    .setName('availability')
    .setDescription('Open the availability grid to mark your free time')
    .addIntegerOption(opt =>
      opt.setName('week').setDescription('0 = this week, 1 = next week').setMinValue(0).setMaxValue(3)),

  new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Show the group availability heatmap')
    .addIntegerOption(opt =>
      opt.setName('week').setDescription('0 = this week, 1 = next week').setMinValue(0).setMaxValue(3)),

  new SlashCommandBuilder()
    .setName('findmeeting')
    .setDescription('Find the best time for everyone to meet')
    .addIntegerOption(opt =>
      opt.setName('duration').setDescription('Meeting duration in hours (default 1)').setMinValue(1).setMaxValue(4))
    .addIntegerOption(opt =>
      opt.setName('week').setDescription('0 = this week, 1 = next week').setMinValue(0).setMaxValue(3)),

  new SlashCommandBuilder()
    .setName('clearavailability')
    .setDescription('Clear your availability for the week'),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  console.log('Registering slash commands...');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) });
  console.log('Commands registered!');
}

// --- Bot Client ---
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  const data = loadData();
  const guildId = interaction.guildId;
  if (!data[guildId]) data[guildId] = {};

  // --- /availability ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'availability') {
    const weekOffset = interaction.options.getInteger('week') ?? 0;
    const weekKey = getWeekKey(weekOffset);

    // Build day-selection buttons (first pick a day, then hours)
    const rows = [];
    for (let i = 0; i < 2; i++) {
      const row = new ActionRowBuilder();
      for (let d = i * 3; d < Math.min((i + 1) * 3 + (i === 1 ? 1 : 0), 7); d++) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`day_${d}_${weekKey}`)
            .setLabel(DAYS[d])
            .setStyle(ButtonStyle.Secondary)
        );
      }
      if (row.components.length > 0) rows.push(row);
    }

    const embed = new EmbedBuilder()
      .setTitle(`📅 Set Your Availability — Week of ${getWeekLabel(weekKey)}`)
      .setDescription('Select a **day** to toggle your free hours for that day.')
      .setColor(0x5865F2)
      .setFooter({ text: 'Use /schedule to see the group heatmap • /findmeeting for best slots' });

    await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
  }

  // --- Day button clicked → show hour buttons ---
  if (interaction.isButton() && interaction.customId.startsWith('day_')) {
    const [, dayStr, weekKey] = interaction.customId.split('_');
    const day = parseInt(dayStr);
    const userId = interaction.user.id;
    const guildData = data[guildId];
    if (!guildData[weekKey]) guildData[weekKey] = {};
    const userSlots = new Set(guildData[weekKey][userId] || []);

    // Show hour buttons in groups of 5
    const rows = [];
    const hourGroups = [[6,7,8,9,10],[11,12,13,14,15],[16,17,18,19,20],[21,22,23,0,1]];
    for (const group of hourGroups) {
      const row = new ActionRowBuilder();
      for (const h of group) {
        const slotKey = `${day}-${h}`;
        const isFree = userSlots.has(slotKey);
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`hour_${day}_${h}_${weekKey}`)
            .setLabel(`${String(h).padStart(2,'0')}:00`)
            .setStyle(isFree ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji(isFree ? '✅' : '🕐')
        );
      }
      rows.push(row);
    }

    // Back button
    const backRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`back_${weekKey}`).setLabel('← Back to days').setStyle(ButtonStyle.Danger)
    );
    rows.push(backRow);

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle(`📅 ${DAYS[day]} — Click to toggle your free hours`)
        .setDescription('🟢 Green = you are free · Grey = busy')
        .setColor(0x57F287)],
      components: rows,
    });
  }

  // --- Hour button clicked → toggle slot ---
  if (interaction.isButton() && interaction.customId.startsWith('hour_')) {
    const parts = interaction.customId.split('_');
    const day = parseInt(parts[1]);
    const hour = parseInt(parts[2]);
    const weekKey = parts[3];
    const userId = interaction.user.id;
    const guildData = data[guildId];
    if (!guildData[weekKey]) guildData[weekKey] = {};
    if (!guildData[weekKey][userId]) guildData[weekKey][userId] = [];

    const slotKey = `${day}-${hour}`;
    const slots = new Set(guildData[weekKey][userId]);
    if (slots.has(slotKey)) slots.delete(slotKey);
    else slots.add(slotKey);
    guildData[weekKey][userId] = [...slots];
    saveData(data);

    // Rebuild hour buttons
    const hourGroups = [[6,7,8,9,10],[11,12,13,14,15],[16,17,18,19,20],[21,22,23,0,1]];
    const rows = [];
    for (const group of hourGroups) {
      const row = new ActionRowBuilder();
      for (const h of group) {
        const key = `${day}-${h}`;
        const isFree = slots.has(key);
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`hour_${day}_${h}_${weekKey}`)
            .setLabel(`${String(h).padStart(2,'0')}:00`)
            .setStyle(isFree ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji(isFree ? '✅' : '🕐')
        );
      }
      rows.push(row);
    }
    const backRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`back_${weekKey}`).setLabel('← Back to days').setStyle(ButtonStyle.Danger)
    );
    rows.push(backRow);

    await interaction.update({ components: rows });
  }

  // --- Back button ---
  if (interaction.isButton() && interaction.customId.startsWith('back_')) {
    const weekKey = interaction.customId.split('_')[1];
    const rows = [];
    for (let i = 0; i < 2; i++) {
      const row = new ActionRowBuilder();
      for (let d = i * 3; d < Math.min((i + 1) * 3 + (i === 1 ? 1 : 0), 7); d++) {
        row.addComponents(
          new ButtonBuilder().setCustomId(`day_${d}_${weekKey}`).setLabel(DAYS[d]).setStyle(ButtonStyle.Secondary)
        );
      }
      if (row.components.length) rows.push(row);
    }
    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle(`📅 Set Your Availability — Week of ${getWeekLabel(weekKey)}`)
        .setDescription('Select a **day** to toggle your free hours.')
        .setColor(0x5865F2)],
      components: rows,
    });
  }

  // --- /schedule ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'schedule') {
    const weekOffset = interaction.options.getInteger('week') ?? 0;
    const weekKey = getWeekKey(weekOffset);
    const guildData = data[guildId];
    const week = guildData[weekKey] || {};
    const memberCount = Object.keys(week).length;

    const grid = buildGrid(guildData, weekKey);

    const embed = new EmbedBuilder()
      .setTitle(`🗓️ Group Availability — Week of ${getWeekLabel(weekKey)}`)
      .setDescription(grid + `\n⬛ None  🔲 Few  🟥 Some  🔴 Half  🟠 Most  🟡 All`)
      .setColor(0xFEE75C)
      .setFooter({ text: `${memberCount} member(s) responded · Use /findmeeting to find the best slot` });

    await interaction.reply({ embeds: [embed] });
  }

  // --- /findmeeting ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'findmeeting') {
    const weekOffset = interaction.options.getInteger('week') ?? 0;
    const duration = interaction.options.getInteger('duration') ?? 1;
    const weekKey = getWeekKey(weekOffset);
    const guildData = data[guildId];
    const best = findBestSlots(guildData, weekKey, duration);

    if (!best.length) {
      return interaction.reply({ content: '😕 No overlapping availability found. Ask your team to use `/availability` first!', ephemeral: true });
    }

    const lines = best.map((s, i) => {
      const endHour = (s.hour + duration) % 24;
      return `${i + 1}. **${DAYS[s.day]}** ${String(s.hour).padStart(2,'0')}:00 – ${String(endHour).padStart(2,'0')}:00 · ${s.count}/${s.total} people free`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`🤝 Best Meeting Times — Week of ${getWeekLabel(weekKey)}`)
      .setDescription(lines)
      .setColor(0x57F287)
      .setFooter({ text: `Duration: ${duration}h · Ranked by most people available` });

    await interaction.reply({ embeds: [embed] });
  }

  // --- /clearavailability ---
  if (interaction.isChatInputCommand() && interaction.commandName === 'clearavailability') {
    const weekKey = getWeekKey(0);
    const userId = interaction.user.id;
    if (data[guildId]?.[weekKey]?.[userId]) {
      delete data[guildId][weekKey][userId];
      saveData(data);
    }
    await interaction.reply({ content: '🗑️ Your availability for this week has been cleared.', ephemeral: true });
  }
});

// --- Start ---
registerCommands().then(() => client.login(TOKEN));
