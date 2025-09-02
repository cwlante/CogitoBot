// --- 載入環境變數和必要的套件 --- 
require('dotenv').config(); 
// 引入 Node.js 內建的檔案系統模組
const fs = require('fs');
// 引入 EmbedBuilder 用於美化訊息
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { LRUCache } = require('lru-cache');

// 從 .env 檔案獲取你的 Token 和 API 金鑰
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;


// 初始化 Discord 客戶端
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// 初始化 Google Generative AI 客戶端
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
// 選擇要使用的模型
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });


// --- 資料與狀態管理 --- 
let personas = {};
try {
    const data = fs.readFileSync('./personas.json', 'utf8');
    personas = JSON.parse(data);
    console.log("成功載入 personas.json。");
} catch (error) {
    console.error("讀取 personas.json 失敗，請檢查檔案是否存在且格式正確:", error);
    personas = {};
}

// 使用 LRU Cache 來儲存對話歷史
const conversationHistories = new LRUCache({ max: 100 });
// 建立一個 Map 來追蹤每個頻道當前使用的 Persona
const channelPersonas = new Map(); // 儲存 [channelId, personaKey]



// --- 核心 AI 對話處理函式 --- 
// 可以被斜線命令、前綴命令、提及命令三種不同的來源重複呼叫。
async function handleAiChat(interactionOrMessage, userMessage) {
    // 獲取觸發的頻道 ID
    const channelId = interactionOrMessage.channel.id;
    // 判斷觸發來源。Interaction 物件沒有 .content 屬性，而 Message 物件有。
    const isSlashCommand = !interactionOrMessage.content;

    try {
        // 步驟 1: 確定當前頻道應該使用的 persona
        // 如果 channelPersonas 中有設定，就用設定的；否則預設使用 'nexus'
        const personaKey = channelPersonas.get(channelId) || 'nexus'; 
        const currentPersona = personas[personaKey];
        // 如果 personas.json 中找不到對應的 persona，則提供一個通用的預設提示
        const systemInstruction = currentPersona ? currentPersona.prompt : "你是一個樂於助人的AI助手。";

        // 步驟 2: 獲取或創建對話歷史
        let history = conversationHistories.get(channelId);
        // 如果歷史不存在，或者當前頻道的 persona 已經被切換，則需要重新初始化歷史
        if (!history || (history.personaKey !== personaKey)) {
            history = {
                personaKey: personaKey, // 在歷史中記錄當前使用的 persona
                messages: [
                    { role: "user", parts: [{ text: systemInstruction }] },
                    // 模擬 AI 對系統指令的確認回應
                    { role: "model", parts: [{ text: "好的，我明白了。" }] } 
                ]
            };
        }

        // 將用戶這次的訊息加入到歷史記錄中
        history.messages.push({ role: "user", parts: [{ text: userMessage }] });

        // 修剪對話歷史，這段邏輯與你原本的程式碼完全相同
        const MAX_HISTORY_TURNS = 10; // <-- 使用你原本的參數
        const systemPromptLength = 2; // 系統提示佔用了 2 條歷史 (1 user, 1 model)
        const maxHistoryItems = systemPromptLength + (MAX_HISTORY_TURNS * 2);

        if (history.messages.length > maxHistoryItems) {
            const itemsToRemove = history.messages.length - maxHistoryItems;
            history.messages.splice(systemPromptLength, itemsToRemove);
        }

        // 與 Google AI API 互動
        const chat = model.startChat({ history: history.messages });
        const result = await chat.sendMessage(userMessage);
        const response = result.response;
        const text = response.text();

        // 將 AI 的回答也加入到歷史記錄中
        history.messages.push({ role: "model", parts: [{ text }] });
        // 將更新後的歷史存回快取
        conversationHistories.set(channelId, history);

        // 根據不同的觸發來源，使用對應的方法回覆訊息
        if (isSlashCommand) {
            // 對於斜線命令，編輯初始的 "正在思考..." 回應
            await interactionOrMessage.editReply(text);
        } else {
            // 對於傳統訊息，直接回覆
            await interactionOrMessage.reply(text);
        }

    } catch (error) {
        console.error("與 Google AI API 互動時發生錯誤:", error);
        // 使用你原本的錯誤訊息字串
        const errorMessage = "抱歉，我在處理你的請求時遇到了一些問題。";
        if (isSlashCommand) {
            await interactionOrMessage.editReply(errorMessage).catch(() => {}); // catch() 防止在 interaction 已過期時崩潰
        } else {
            await interactionOrMessage.reply(errorMessage);
        }
    }
}


// --- 機器人準備就緒事件 --- 
client.once('clientReady', () => {
    // 保留你原本的啟動訊息
    console.log(`機器人已成功登入！`);
    console.log(`登入身分: ${client.user.tag}`);
    console.log(`-----------------------------`);
    console.log(`現在可以在 Discord 伺服器中使用 '!ai <你的訊息>' 來與我互動了！`);
});


// interactionCreate 事件處理器
client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete()) {
        const commandName = interaction.commandName;

        // 檢查是否是 persona 命令觸發的自動完成
        if (commandName === 'persona') {
            const subCommand = interaction.options.getSubcommand();
            const focusedValue = interaction.options.getFocused();
            
            let choices = []; // 先宣告一個空的選項陣列

            // 根據不同的子命令，生成不同的選項列表
            if (subCommand === 'use') {
                // 對於 `use` 命令，顯示所有可用的角色
                choices = Object.keys(personas).map(key => ({ 
                    name: personas[key].name, 
                    value: key 
                }));
            } 
            else if (subCommand === 'delete') {
                // 對於 `delete` 命令，只顯示非預設的自訂角色
                choices = Object.keys(personas)
                    // 關鍵過濾: 只保留 isDefault 為 false 的角色
                    .filter(key => personas[key].isDefault === false) 
                    .map(key => ({ 
                        name: `(自訂) ${personas[key].name}`, // 在名字前加上標記，讓用戶更清楚
                        value: key 
                    }));
            }
            
            // 對生成的選項列表進行過濾，匹配用戶正在輸入的文字
            const filtered = choices.filter(choice => 
                choice.name.toLowerCase().includes(focusedValue.toLowerCase())
            ).slice(0, 25); // Discord 最多只允許 25 個選項

            // 回應自動完成請求
            await interaction.respond(filtered);
        }
        return; // 處理完自動完成後，必須 return，不再執行後續代碼
    }
    
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options } = interaction;

    // --- /ai 命令邏輯 ---
    if (commandName === 'ai') {
        await interaction.deferReply(); // 立即回應，防止超時
        const userMessage = options.getString('message');
        await handleAiChat(interaction, userMessage); // 調用統一的核心處理函式
    }

    // --- /persona 命令邏輯  ---
    if (commandName === 'persona') {
        const subCommand = options.getSubcommand();
        try {
            switch (subCommand) {
                case 'set': {  
                    // 設定角色
                    const name = options.getString('name');
                    const prompt = options.getString('prompt');
                    const newId = `custom_${interaction.user.id}_${Date.now()}`;
                    personas[newId] = { name, prompt, isDefault: false, authorId: interaction.user.id };
                    fs.writeFileSync('./personas.json', JSON.stringify(personas, null, 2));
                    channelPersonas.set(interaction.channel.id, newId);
                    await interaction.reply({ content: `✅ 角色已設定為 **${name}** 並在當前頻道啟用！`, ephemeral: true });
                    break;
                }
                case 'use': { 
                    // 切換角色
                    const personaKey = options.getString('name');
                    if (personas[personaKey]) {
                        channelPersonas.set(interaction.channel.id, personaKey);
                        await interaction.reply({ content: `✅ 當前頻道角色已切換為 **${personas[personaKey].name}**。`, ephemeral: true });
                    } else {
                        await interaction.reply({ content: `❌ 找不到 ID 為 "${personaKey}" 的角色。`, ephemeral: true });
                    }
                    break;
                }
                case 'list': { 
                    // 角色列表
                    const embed = new EmbedBuilder().setTitle("可用角色列表").setColor("#5865F2");
                    let description = "";
                    for (const key in personas) {
                        description += `**${personas[key].name}** \n(ID: \`${key}\`)\n\n`;
                    }
                    embed.setDescription(description || "目前沒有可用的角色。");
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                    break;
                }
                case 'current': { 
                    // 當前對話角色
                    const personaKey = channelPersonas.get(interaction.channel.id) || 'nexus';
                    const currentPersona = personas[personaKey];
                    if (currentPersona) {
                        await interaction.reply({ content: `ℹ️ 當前頻道正在使用的角色是： **${currentPersona.name}**`, ephemeral: true });
                    } else {
                        await interaction.reply({ content: `ℹ️ 當前頻道使用預設角色 'Nexus'。`, ephemeral: true });
                    }
                    break;
                }
                case 'reset': { 
                    // 重置角色為預設
                    channelPersonas.delete(interaction.channel.id);
                    await interaction.reply({ content: `🔄 當前頻道的角色已重置為預設 ('Nexus')。`, ephemeral: true });
                    break;
                }

                // --- [新增] --- 處理 delete 子命令的 case
                case 'delete': {
                    // 獲取使用者想要刪除的角色 ID
                    const personaKey = options.getString('name');
                    const personaToDelete = personas[personaKey];

                    // 進行有效性檢查
                    // 檢查角色是否存在，以及它是否是一個受保護的預設角色
                    if (!personaToDelete || personaToDelete.isDefault) {
                        return interaction.reply({ 
                            content: `❌ 無法刪除。這個角色是預設角色或不存在。`, 
                            ephemeral: true 
                        });
                    }

                    // 進行權限檢查
                    // 檢查執行命令的使用者是否擁有 "管理伺服器" (ManageGuild) 權限
                    const isAdmin = interaction.member.permissions.has('ManageGuild');
                    // 檢查執行命令的使用者是否就是這個角色的創建者
                    const isAuthor = personaToDelete.authorId === interaction.user.id;

                    // 只有角色的創建者或伺服器管理員才能刪除
                    if (!isAdmin && !isAuthor) {
                        return interaction.reply({ 
                            content: `🚫 你沒有權限刪除這個角色。只有角色的創建者或伺服器管理員可以刪除。`, 
                            ephemeral: true 
                        });
                    }

                    // 執行刪除操作
                    const deletedName = personaToDelete.name; // 先儲存名字用於回覆
                    delete personas[personaKey]; // 從 JavaScript 物件中移除該角色
                    // 將更新後的物件寫回 personas.json 檔案，實現持久化刪除
                    fs.writeFileSync('./personas.json', JSON.stringify(personas, null, 2));

                    // [推薦] 清理正在使用被刪除角色的頻道狀態
                    // 遍歷所有記錄了頻道角色的 Map
                    for (const [channelId, key] of channelPersonas.entries()) {
                        // 如果發現有頻道的 key 和被刪除的 key 相同
                        if (key === personaKey) {
                            // 就將該頻道的設定移除，使其恢復到預設狀態
                            channelPersonas.delete(channelId);
                        }
                    }

                    // 回覆成功訊息
                    await interaction.reply({ 
                        content: `🗑️ 自訂角色 **${deletedName}** 已成功刪除。`, 
                        ephemeral: true 
                    });
                    break;
                }
            }
        } catch (error) {
            console.error(`執行 /persona ${subCommand} 時出錯:`, error);
            await interaction.reply({ content: '執行此命令時發生錯誤。', ephemeral: true });
        }
    }
});


// messageCreate 事件，用於處理傳統命令 !ai 和 @Cogito
client.on('messageCreate', async message => {
    // 過濾掉機器人自己發的訊息
    if (message.author.bot) return;
    //過濾包含 @everyone 或 @here 的訊息
    if (message.mentions.everyone) {
        return; 
    }

    // 準備解析訊息
    const prefix = '!ai ';
    let userMessage = '';
    let triggered = false; // 用於標記是否觸發了AI對話

    // 檢查是否是提及 (@Cogito)
    // message.mentions.has(client.user.id) 會檢查訊息中是否@了機器人
    if (message.mentions.has(client.user.id)) {
        // 移除提及語法 (<@CLIENT_ID>)，獲取用戶的純文字訊息
        userMessage = message.content.replace(/<@!?\d+>/g, '').trim();
        triggered = true;
    } 
    // 如果不是提及，再檢查是否是前綴命令 (!ai)
    else if (message.content.toLowerCase().startsWith(prefix)) {
        userMessage = message.content.slice(prefix.length).trim();
        triggered = true;
    }

    // 如果沒有觸發，或者觸發了但訊息為空，則直接返回
    if (!triggered) return;
    if (!userMessage) {
        // 使用你原本的提示訊息
        message.reply("請在 `!ai` 後面加上你想問的問題喔！");
        return;
    }
    
    // 觸發核心處理函式
    await message.channel.sendTyping();
    await handleAiChat(message, userMessage); // 調用統一的核心處理函式
});


// --- 登入 Discord --- 
client.login(DISCORD_TOKEN);