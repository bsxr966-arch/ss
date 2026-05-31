const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require('discord.js');

require('dotenv').config();
const cron = require('node-cron');
const axios = require('axios');
const JSONdb = require('simple-json-db');

const db = new JSONdb('database.json');

let monitorList = db.has('monitorList') ? db.get('monitorList') : [];
let historyList = db.has('historyList') ? db.get('historyList') : [];

function saveDb() {
  db.set('monitorList', monitorList);
  db.set('historyList', historyList);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ============================================================
// RAPIDAPI CONFIG
// ============================================================
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '9b1a4918c9mshdac0ef62110df83p146c79jsn43095edc6a23';
const RAPIDAPI_HOST = 'instagram120.p.rapidapi.com';

// ============================================================
// CHECK INSTAGRAM USER via RapidAPI
// ============================================================
async function checkInstagramUser(username) {
  try {
    const res = await axios.post(
      `https://${RAPIDAPI_HOST}/api/instagram/posts`,
      { username: username, maxId: "" },
      {
        timeout: 20000,
        headers: {
          'Content-Type': 'application/json',
          'x-rapidapi-host': RAPIDAPI_HOST,
          'x-rapidapi-key': RAPIDAPI_KEY
        }
      }
    );

    const data = res.data;

    // التحقق من البيانات
    if (data && (data.id || data.pk)) {
      const followers = data.follower_count || data.followers || 0;
      return {
        status: 'active',
        message: 'User is active',
        followers: followers
      };
    }

    if (data && data.status === 'fail') {
      return { status: 'banned', message: 'User not found / restricted', followers: 0 };
    }

    // لو رجع username فارغ أو error
    if (!data || data.error) {
      return { status: 'banned', message: 'User not found', followers: 0 };
    }

    return { 
      status: 'active', 
      message: 'User exists', 
      followers: data.follower_count || data.followers || 0 };
    } catch (e) {
    if (e.response && e.response.status === 404) {
      return { status: 'banned', message: 'User not found (404)', followers: 0 };
    }
    if (e.response && e.response.status === 429) {
      console.log('RapidAPI rate limited (429)');
      return { status: 'error', message: 'Rate limited (429)', followers: 0 };
    }
    console.log('RapidAPI error:', e.response?.data || e.message);
    return { status: 'error', message: e.message, followers: 0 };
  }
}

// ============================================================
// GET TIME TAKEN (from history)
// ============================================================
function getTimeTaken(username) {
  const banEntry = historyList
    .filter(h => h.username === username && h.status === 'banned')
    .pop();
  
  if (!banEntry) return 'N/A';

  const banTime = new Date(banEntry.date).getTime();
  const now = Date.now();
  const diffMs = now - banTime;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// ============================================================
// SEND WEBHOOK NOTIFICATION
// ============================================================
async function sendWebhookNotification(embed, content) {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) { console.log('No WEBHOOK_URL set in .env'); return; }
  try {
    await axios.post(webhookUrl, { content, embeds: [embed] });
    console.log('Webhook sent successfully');
  } catch (e) { console.error('Failed to send webhook:', e.message); }
}

// ============================================================
// COMMANDS LIST
// ============================================================
const commands = [
  { name: 'check', description: 'Check if an Instagram user is banned or active', options: [{ type: 3, name: 'username', description: 'Instagram username', required: true }] },
  { name: 'monitor', description: 'Add Instagram user to ban monitoring list', options: [{ type: 3, name: 'username', description: 'Instagram username', required: true }] },
  { name: 'monitor-list', description: 'Show all monitored users' },
  { name: 'monitor-remove', description: 'Remove user from monitoring list', options: [{ type: 3, name: 'username', description: 'Instagram username', required: true }] },
  { name: 'history', description: 'Show ban/unban history' },
  { name: 'help', description: 'Show help menu' }
];

// ============================================================
// READY EVENT
// ============================================================
client.once('ready', async () => {
  console.log(`${client.user.tag} Online`);

  try {
    const oldCmds = await client.application.commands.fetch();
    for (const cmd of oldCmds.values()) { await cmd.delete(); }
    console.log('Old commands deleted');
  } catch (e) { console.log('No old commands to delete'); }

  await client.application.commands.set(commands);
  console.log('Slash commands registered');

  cron.schedule('*/10 * * * *', async () => {
    console.log('Monitor check running...');
    for (const entry of monitorList) {
      const result = await checkInstagramUser(entry.username);

      if (result.status === 'banned' && !entry.lastStatusWasBanned) {
        entry.lastStatusWasBanned = true;
        saveDb();

        const embed = new EmbedBuilder()
          .setColor('#00aaff').setTitle('Username Banned').setDescription(`@${entry.username}`)
          .addFields(
            { name: `${entry.followers.toLocaleString()} followers`, value: '\u200B', inline: false },
            { name: 'Profile URL', value: `instagram.com/${entry.username}`, inline: false },
            { name: 'Reason', value: entry.reason || 'Account banned / not found', inline: false },
            { name: 'Time Taken', value: getTimeTaken(entry.username), inline: false },
            { name: 'Status', value: '\uD83D\uDD34 BANNED', inline: false }
          )
          .setImage('https://i.imgur.com/ouxoMH3.jpeg')
          .setFooter({ text: `@Lie | Today at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`, iconURL: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png' });

        const channel = client.channels.cache.find(c => c.name === 'bans');
        if (channel) await channel.send({ content: `The Account "@${entry.username}" Banned`, embeds: [embed] });
        await sendWebhookNotification(embed, `The Account "@${entry.username}" Banned`);

        historyList.push({ username: entry.username, status: 'banned', date: new Date().toISOString(), reason: entry.reason || 'Account banned / not found' });
        saveDb();

      } else if (result.status === 'active' && entry.lastStatusWasBanned) {
        entry.lastStatusWasBanned = false;
        entry.followers = result.followers;
        saveDb();

        const embed = new EmbedBuilder()
          .setColor('#00aaff').setTitle('Username Unbanned Successfully').setDescription(`@${entry.username}`)
          .addFields(
            { name: `${result.followers.toLocaleString()} followers`, value: '\u200B', inline: false },
            { name: 'Profile URL', value: `instagram.com/${entry.username}`, inline: false },
            { name: 'Status', value: '\uD83D\uDFE2 ACTIVE', inline: false }
          )
          .setImage('https://i.imgur.com/ouxoMH3.jpeg')
          .setFooter({ text: `@Lie | Today at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`, iconURL: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png' });

        await sendWebhookNotification(embed, `The Account "@${entry.username}" Unbanned Successfully`);
        historyList.push({ username: entry.username, status: 'unbanned', date: new Date().toISOString(), reason: 'Ban lifted' });
        saveDb();

      } else if (result.status === 'active') {
        entry.lastStatusWasBanned = false;
        entry.followers = result.followers;
        saveDb();
      }
    }
  });
});

// ============================================================
// INTERACTION HANDLER
// ============================================================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'check') {
    const username = interaction.options.getString('username');
    await interaction.reply(`\uD83D\uDD0D Checking @${username}...`);

    const result = await checkInstagramUser(username);

    if (result.status === 'active') {
      const embed = new EmbedBuilder()
        .setColor('#00aaff').setTitle('Username Active').setDescription(`@${username}`)
        .addFields(
          { name: `${result.followers.toLocaleString()} followers`, value: '\u200B', inline: false },
          { name: 'Profile URL', value: `instagram.com/${username}`, inline: false },
          { name: 'Status', value: '\uD83D\uDFE2 ACTIVE', inline: false }
        )
        .setImage('https://i.imgur.com/ouxoMH3.jpeg')
        .setFooter({ text: `@Lie | Today at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`, iconURL: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png' });

      await interaction.editReply({ content: `The Account "@${username}" Active`, embeds: [embed] });

    } else if (result.status === 'banned') {
      const embed = new EmbedBuilder()
        .setColor('#00aaff').setTitle('Username Banned').setDescription(`@${username}`)
        .addFields(
          { name: '0 followers', value: '\u200B' },
          { name: 'Profile URL', value: `instagram.com/${username}` },
          { name: 'Status', value: '\uD83D\uDD34 BANNED' }
        )
        .setImage('https://i.imgur.com/ouxoMH3.jpeg')
        .setFooter({ text: `@Lie | Today at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`, iconURL: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png' });

      await interaction.editReply({ content: `The Account "@${username}" Banned`, embeds: [embed] });

    } else {
      await interaction.editReply(`\u274C Error: ${result.message}`);
    }
  }

  if (interaction.commandName === 'monitor') {
    const username = interaction.options.getString('username').toLowerCase();
    if (monitorList.find(m => m.username === username)) return interaction.reply(`\u26A0\uFE0F @${username} is already monitored.`);

    await interaction.reply(`\uD83D\uDD0D Checking @${username}...`);
    const result = await checkInstagramUser(username);
    if (result.status === 'error') return interaction.editReply(`\u274C Error: ${result.message}`);

    monitorList.push({ username, reason: 'N/A', followers: result.followers, lastStatusWasBanned: (result.status === 'banned'), addedAt: new Date().toISOString() });
    saveDb();
    await interaction.editReply(`\u2705 Added @${username} to monitoring list.`);
  }

  if (interaction.commandName === 'monitor-list') {
    if (monitorList.length === 0) return interaction.reply('No monitored users.');
    const list = monitorList.map((m, i) => `**${i+1}.** @${m.username} | Status: ${m.lastStatusWasBanned ? '\uD83D\uDD34 BANNED' : '\uD83D\uDFE2 ACTIVE'}`).join('\n');
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#00aaff').setTitle('Monitored Users').setDescription(list).setFooter({ text: `Total: ${monitorList.length}` })] });
  }

  if (interaction.commandName === 'monitor-remove') {
    const username = interaction.options.getString('username').toLowerCase();
    const idx = monitorList.findIndex(m => m.username === username);
    if (idx === -1) return interaction.reply(`\u26A0\uFE0F @${username} not found.`);
    monitorList.splice(idx, 1);
    saveDb();
    await interaction.reply(`\u2705 Removed @${username} from monitoring list.`);
  }

  if (interaction.commandName === 'history') {
    if (historyList.length === 0) return interaction.reply('No history yet.');
    const entries = historyList.slice(-20).reverse().map((h, i) => `**${i+1}.** @${h.username} | ${h.status === 'banned' ? '\uD83D\uDD34 BANNED' : '\uD83D\uDFE2 UNBANNED'} | ${new Date(h.date).toLocaleString()}`).join('\n');
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#00aaff').setTitle('History').setDescription(entries)] });
  }

  if (interaction.commandName === 'help') {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor('#00aaff').setTitle('Help').setDescription(
        '/check <username> - Check if banned\n/monitor <username> - Add to monitor\n/monitor-list - Show monitored\n/monitor-remove <username> - Remove\n/history - Ban/unban history\n/help - This menu'
      )]
    });
  }
});

// ============================================================
// LOGIN
// ============================================================
client.login(process.env.TOKEN);