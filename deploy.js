const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');
require('dotenv').config();

const commands = [
    {
        name: 'ai',
        description: '與 AI 進行對話。',
        options: [
            {
                name: 'message',
                description: '你想對 AI 說的話。',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    {
        name: 'persona',
        description: '管理 AI 的角色和個性。',
        options: [
            {
                name: 'set',
                description: '設定一個全新的自訂角色並在當前頻道使用。',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'name', description: '給你的新角色取個名字。', type: ApplicationCommandOptionType.String, required: true },
                    { name: 'prompt', description: '詳細的角色描述和提示詞。', type: ApplicationCommandOptionType.String, required: true },
                ],
            },
            {
                name: 'use',
                description: '從已有的角色列表中選擇一個使用。',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    { name: 'name', description: '要使用的角色名稱。', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
                ],
            },
            {
                name: 'list',
                description: '顯示所有可用的角色。',
                type: ApplicationCommandOptionType.Subcommand,
            },
            {
                name: 'current',
                description: '查看當前頻道正在使用哪個角色。',
                type: ApplicationCommandOptionType.Subcommand,
            },
             {
                name: 'reset',
                description: '將當前頻道的角色恢復為預設。',
                type: ApplicationCommandOptionType.Subcommand,
            },
            {
                name: 'delete',
                description: '刪除所選的自訂角色。',
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {name: 'name', description: '要刪除的自訂角色名稱。', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
                ],
            },
        ],
    },
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {

        //全域註冊(正式發布)
        console.log('正在註冊全域應用程式 (/) 指令。');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('成功註冊全域應用程式 (/) 指令。');
        
        //伺服器限定註冊(開發測試)
        /*
        console.log('正在為伺服器註冊應用程式 (/) 指令。');

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('成功為伺服器註冊應用程式 (/) 指令。');
        */

    } catch (error) {
        console.error("註冊指令時發生錯誤",error);
    }
})();