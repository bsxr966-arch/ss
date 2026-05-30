require('dotenv').config();
const { REST, Routes } = require('discord.js');

const commands = [
  { name: 'unban', description: 'Monitor an Instagram username for unban', options: [{ type: 3, name: 'username', description: 'Instagram username', required: true }, { type: 3, name: 'reason', description: 'Reason for ban', required: true }] },
  { name: 'history', description: 'Show all unbanned usernames with dates' },
  { name: 'monitor', description: 'Show monitored usernames list' },
  { name: 'monitor-add', description: 'Add username to monitor list', options: [{ type: 3, name: 'username', description: 'Instagram username', required: true }] },
  { name: 'monitor-remove', description: 'Remove username from monitor list', options: [{ type: 3, name: 'username', description: 'Instagram username', required: true }] },
  { name: 'monitor-check', description: 'Check if a user is banned', options: [{ type: 3, name: 'username', description: 'Instagram username', required: true }] },
  { name: 'settings', description: 'Open bot settings panel' },
  { name: 'help', description: 'Show help menu' }
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    // First, delete all global commands
    const allCommands = await rest.get(Routes.applicationCommands(process.env.CLIENT_ID));
    for (const cmd of allCommands) {
      await rest.delete(Routes.applicationCommand(process.env.CLIENT_ID, cmd.id));
      console.log('Deleted:', cmd.name);
    }
    // Then register new ones
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('Commands registered:', commands.length);
  } catch (e) {
    console.error(e);
  }
})();