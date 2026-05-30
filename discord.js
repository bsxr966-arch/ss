const embed = new EmbedBuilder()
  .setColor('#ff0000')
  .setTitle('Account Got Banned')
  .setDescription('This account got banned')
  .addFields(
    {
      name: 'User',
      value: '@jj1q',
      inline: false
    },
    {
      name: 'Profile URL',
      value: 'instagram.com/qy80',
      inline: true
    },
    {
      name: 'Reason',
      value: 'test',
      inline: true
    },
    {
      name: 'Confirmed After',
      value: '3 consecutive checks',
      inline: true
    },
    {
      name: 'Status',
      value: 'BANNED',
      inline: false
    }
  )
  .setThumbnail('https://i.imgur.com/2DhmtJ4.jpeg')
  .setFooter({
    text: 'Lie • Telegram: @hliwx'
  });

await interaction.reply({
  content: 'The Account "@jj1q" Got Banned!',
  embeds: [embed]
});