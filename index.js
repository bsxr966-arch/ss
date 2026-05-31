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
// GET MID COOKIE
// ============================================================
async function getMidCookie() {
  try {
    const resp = await axios.get('https://www.instagram.com/', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      }
    });
    const cookies = resp.headers['set-cookie'];
    if (cookies) {
      const mid = cookies.find(c => c.startsWith('mid='));
      return mid ? mid.split(';')[0] : '';
    }
    return '';
  } catch (e) {
    console.log('Failed to get mid cookie:', e.message);
    return '';
  }
}

// ============================================================
// CHECK INSTAGRAM USER
// ============================================================
async function checkInstagramUser(username) {
  try {
    const midCookie = await getMidCookie();
    const res = await axios.get(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
      {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'X-IG-App-ID': '936619743392459',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.instagram.com/',
          'Origin': 'https://www.instagram.com',
          'Cookie': midCookie
        }
      }
    );

    if (res.status === 200) {
      const userData = res.data?.data?.user;
      if (!userData) {
        return { status: 'banned', message: 'User not found / restricted', followers: 0 };
      }
      return { 
        status: 'active', 
        message: 'User is active', 
        followers: userData.edge_followed_by?.count || 0
      };
    }

    return { status: 'error', message: `Unexpected status: ${res.status}`, followers: 0 };

  } catch (e) {
    if (e.response && e.response.status === 404) {
      return { status: 'banned', message: 'User not found (404)', followers: 0 };
    }
    if (e.response && e.response.status === 401) {
      return {
        status: 'error',
        message: 'Request flagged (401)',
        followers: 0
      };
    }
    if (e.response && e.response.status === 429) {
      console.log('====================================');
      console.log('INSTAGRAM RATE LIMIT (429)');
      console.log('Username:', username);
      console.log('Response:', e.response.data);
      console.log('====================================');

      return {
        status: 'error',
        message: 'Rate limited (429)',
        followers: 0
      };
    }
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
  if (!webhookUrl) {
    console.log('No WEBHOOK_URL set in .env');
    return;
  }

  try {
    await axios.post(webhookUrl, {
      content: content,
      embeds: [embed]
    });
    console.log('Webhook sent successfully');
  } catch (e) {
    console.error('Failed to send webhook:', e.message);
  }
}

// ============================================================
// COMMANDS LIST
// ============================================================
const commands = [
  {
    name: 'check',
    description: 'Check if an Instagram user is banned or active',
    options: [
      { type: 3, name: 'username', description: 'Instagram username', required: true }
    ]
  },
  {
    name: 'monitor',
    description: 'Add Instagram user to ban monitoring list',
    options: [
      { type: 3, name: 'username', description: 'Instagram username', required: true }
    ]
  },
  { name: 'monitor-list', description: 'Show all monitored users' },
  {
    name: 'monitor-remove',
    description: 'Remove user from monitoring list',
    options: [
      { type: 3, name: 'username', description: 'Instagram username', required: true }
    ]
  },
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
    for (const cmd of oldCmds.values()) {
      await cmd.delete();
    }
    console.log('Old commands deleted');
  } catch (e) {
    console.log('No old commands to delete');
  }

  await client.application.commands.set(commands);
  console.log('Slash commands registered');

  cron.schedule('*/10 * * * *', async () => {
    console.log('Monitor check running...');
    
    for (const entry of monitorList) {
      const result = await checkInstagramUser(entry.username);

      // ====== USER GOT BANNED ======
      if (result.status === 'banned' && !entry.lastStatusWasBanned) {
        entry.lastStatusWasBanned = true;
        saveDb();

        const embed = new EmbedBuilder()
          .setColor('#00aaff')
          .setTitle('Username Banned')
          .setDescription(`@${entry.username}`)
          .addFields(
            { name: `${entry.followers.toLocaleString()} followers`, value: '\u200B', inline: false },
            { name: 'Profile URL', value: `instagram.com/${entry.username}`, inline: false },
            { name: 'Reason', value: entry.reason || 'Account banned / not found', inline: false },
            { name: 'Time Taken', value: getTimeTaken(entry.username), inline: false },
            { name: 'Status', value: '🔴 BANNED', inline: false }
          )
          .setImage('https://i.imgur.com/ouxoMH3.jpeg')
          .setFooter({
            text: `@Lie | Today at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`,
            iconURL: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png'
          });

        // Send to Discord channel
        const channel = client.channels.cache.find(c => c.name === 'bans');
        if (channel) {
          await channel.send({
            content: `The Account "@${entry.username}" Banned`,
            embeds: [embed]
          });
        }

        // Send to webhook
        await sendWebhookNotification(embed, `The Account "@${entry.username}" Banned`);

        historyList.push({
          username: entry.username,
          status: 'banned',
          date: new Date().toISOString(),
          reason: entry.reason || 'Account banned / not found'
        });
        saveDb();
      
      // ====== USER GOT UNBANNED ======
      } else if (result.status === 'active' && entry.lastStatusWasBanned) {
        entry.lastStatusWasBanned = false;
        entry.followers = result.followers;
        saveDb();

        const timeTaken = getTimeTaken(entry.username);
        const timeDisplay = timeTaken !== 'N/A' ? timeTaken : 'N/A';

        const embed = new EmbedBuilder()
          .setColor('#00aaff')
          .setTitle('Username Unbanned Successfully')
          .setDescription(`@${entry.username}`)
          .addFields(
            { name: `${result.followers.toLocaleString()} followers`, value: '\u200B', inline: false },
            { name: 'Profile URL', value: `instagram.com/${entry.username}`, inline: false },
            { name: 'Status', value: '🟢 ACTIVE', inline: false }
          )
          .setImage('https://i.imgur.com/ouxoMH3.jpeg')
          .setFooter({
            text: `@Lie | Today at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`,
            iconURL: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png'
          });

        // Send to webhook ONLY (no Discord channel)
        await sendWebhookNotification(embed, `The Account "@${entry.username}" Unbanned Successfully`);

        historyList.push({
          username: entry.username,
          status: 'unbanned',
          date: new Date().toISOString(),
          reason: 'Ban lifted'
        });
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

  if (interaction.isChatInputCommand()) {

    // ============ CHECK ============
    if (interaction.commandName === 'check') {
      const username = interaction.options.getString('username');
      await interaction.reply(` Checking @${username}...`);

      const result = await checkInstagramUser(username);

      if (result.status === 'active') {
        const embed = new EmbedBuilder()
          .setColor('#00aaff')
          .setTitle('Username Active')
          .setDescription(`@${username}`)
          .addFields(
            { name: `${result.followers.toLocaleString()} followers`, value: '\u200B', inline: false },
            { name: 'Profile URL', value: `instagram.com/${username}`, inline: false },
            { name: 'Status', value: '🟢 ACTIVE', inline: false }
          )
          .setImage('https://i.imgur.com/ouxoMH3.jpeg')
          .setFooter({
            text: `@Lie | Today at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`,
            iconURL: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png'
          });

        await interaction.editReply({
          content: `The Account "@${username}" Active`,
          embeds: [embed]
        });

      } else if (result.status === 'banned') {
        const embed = new EmbedBuilder()
          .setColor('#00aaff')
          .setTitle('Username Banned')
          .setDescription(`@${username}`)
          .addFields(
            { name: '0 followers', value: '\u200B', inline: false },
            { name: 'Profile URL', value: `instagram.com/${username}`, inline: false },
            { name: 'Reason', value: 'Account banned / not found', inline: false },
            { name: 'Time Taken', value: 'N/A', inline: false },
            { name: 'Status', value: '🔴 BANNED', inline: false }
          )
          .setImage('https://i.imgur.com/ouxoMH3.jpeg')
          .setFooter({
            text: `@Lie | Today at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`,
            iconURL: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png'
          });

        await interaction.editReply({
          content: `The Account "@${username}" Banned`,
          embeds: [embed]
        });

      } else {
        await interaction.editReply(` Error: ${result.message}`);
      }
    }

    // ============ MONITOR ============
    if (interaction.commandName === 'monitor') {
      const username = interaction.options.getString('username').toLowerCase();

      const existing = monitorList.find(m => m.username === username);
      if (existing) {
        return interaction.reply(` @${username} is already being monitored.`);
      }

      await interaction.reply(` Checking @${username} before adding...`);
      const result = await checkInstagramUser(username);

      if (result.status === 'error') {
        return interaction.editReply(` Could not verify @${username}. Error: ${result.message}`);
      }

      monitorList.push({
        username,
        reason: 'N/A',
        followers: result.followers,
        lastStatusWasBanned: (result.status === 'banned'),
        addedAt: new Date().toISOString()
      });
      saveDb();

      await interaction.editReply(` Added @${username} to monitoring list. I will notify you on ban AND unban.`);
    }

    // ============ MONITOR LIST ============
    if (interaction.commandName === 'monitor-list') {
      if (monitorList.length === 0) {
        return interaction.reply(' No users in monitor list.');
      }

      const list = monitorList.map((m, i) => 
        `**${i + 1}.** @${m.username} | Followers: ${m.followers.toLocaleString()} | Status: ${m.lastStatusWasBanned ? '🔴 BANNED' : '🟢 ACTIVE'}`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setColor('#00aaff')
        .setTitle(' Monitored Users')
        .setDescription(list)
        .setFooter({ text: `Total: ${monitorList.length} users` });

      await interaction.reply({ embeds: [embed] });
    }

    // ============ MONITOR REMOVE ============
    if (interaction.commandName === 'monitor-remove') {
      const username = interaction.options.getString('username').toLowerCase();
      const idx = monitorList.findIndex(m => m.username === username);

      if (idx === -1) {
        return interaction.reply(` @${username} is not in monitor list.`);
      }

      monitorList.splice(idx, 1);
      saveDb();
      await interaction.reply(` Removed @${username} from monitoring list.`);
    }

    // ============ HISTORY ============
    if (interaction.commandName === 'history') {
      if (historyList.length === 0) {
        return interaction.reply(' No ban/unban history yet.');
      }

      const entries = historyList.slice(-20).reverse().map((h, i) =>
        `**${i + 1}.** @${h.username} | ${h.status === 'banned' ? '🔴 BANNED' : '🟢 UNBANNED'} | ${new Date(h.date).toLocaleString()}`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setColor('#00aaff')
        .setTitle(' Ban/Unban History (Last 20)')
        .setDescription(entries)
        .setFooter({ text: `Total events: ${historyList.length}` });

      await interaction.reply({ embeds: [embed] });
    }

    // ============ HELP ============
    if (interaction.commandName === 'help') {
      const embed = new EmbedBuilder()
        .setColor('#00aaff')
        .setTitle(' Instagram Ban Monitor - Help')
        .setDescription(
`**Commands:**
\`/check <username>\` - Check if user is banned
\`/monitor <username>\` - Add user to monitoring
\`/monitor-list\` - Show monitored users
\`/monitor-remove <username>\` - Remove from list
\`/history\` - Show ban/unban history
\`/help\` - This menu

**Features:**
🔴 Ban detection → Notification in #bans channel + Webhook
🟢 Unban detection → Notification via Webhook only
 Auto-check every 10 minutes
 Full history with timestamps`
        )
        .setImage('https://i.imgur.com/ouxoMH3.jpeg')
        .setFooter({
          text: '@Lie | Instagram Ban Monitor',
          iconURL: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png'
        });

      await interaction.reply({ embeds: [embed] });
    }
  }
});

// ============================================================
// LOGIN
// ============================================================
client.login(process.env.TOKEN);