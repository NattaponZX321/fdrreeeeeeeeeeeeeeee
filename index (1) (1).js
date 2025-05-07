const fs = require("fs");
const login = require("ryuu-fca-api");
const chalk = require("chalk").default;
const figlet = require("figlet");
const path = require("path");

let users = {};
if (fs.existsSync("./users.json")) {
  users = JSON.parse(fs.readFileSync("./users.json", "utf-8"));
}

const botSessions = {};

let sharedCommands = {};
if (fs.existsSync("./shared_commands.json")) {
  sharedCommands = JSON.parse(fs.readFileSync("./shared_commands.json", "utf-8"));
}

if (!fs.existsSync("./shared_commands")) {
  fs.mkdirSync("./shared_commands");
}

function loadCommands(user, commandSource) {
  const allCommands = {};

  if (commandSource === "system" || commandSource === "both") {
    if (fs.existsSync("./commands")) {
      fs.readdirSync("./commands").forEach((file) => {
        if (file.endsWith(".js")) {
          const command = require(`./commands/${file}`);
          if (command.config && command.config.name) {
            allCommands[command.config.name.toLowerCase()] = {
              ...command,
              source: "ระบบ",
            };
            console.log(`📦 โหลดคำสั่งระบบ: ${command.config.name}`);
          }
        }
      });
    }
  }

  if (commandSource === "user" || commandSource === "both") {
    if (user) {
      const userCommandsPath = `./user_commands/${user}`;
      if (fs.existsSync(userCommandsPath)) {
        fs.readdirSync(userCommandsPath).forEach((file) => {
          if (file.endsWith(".js")) {
            const command = require(path.join(__dirname, `user_commands/${user}/${file}`));
            if (command.config && command.config.name) {
              allCommands[command.config.name.toLowerCase()] = {
                ...command,
                source: "ผู้ใช้",
              };
              console.log(`📦 โหลดคำสั่งผู้ใช้ ${user}: ${command.config.name}`);
            }
          }
        });
      }
    }
  }

  return allCommands;
}

const events = {};
if (fs.existsSync("./events")) {
  fs.readdirSync("./events").forEach((file) => {
    if (file.endsWith(".js")) {
      const eventCommand = require(`./events/${file}`);
      if (eventCommand.config && eventCommand.config.eventType) {
        eventCommand.config.eventType.forEach((type) => {
          if (!events[type]) events[type] = [];
          events[type].push(eventCommand);
        });
        console.log(`🔔 โหลดเหตุการณ์: ${file}`);
      }
    }
  });
}

function generateBotData(user) {
  const userBots = botSessions[user] || {};
  const totalBots = Object.keys(userBots).length;
  return {
    botTableBody: totalBots > 0
      ? Object.keys(userBots)
          .map(
            (token) => `
      <tr>
        <td><div class="bot-name"><i class="fa-solid fa-robot"></i> ${userBots[token].name}</div></td>
        <td><span class="status-online"><i class="fa-solid fa-circle"></i> ออนไลน์</span></td>
        <td><span class="runtime" data-start-time="${userBots[token].startTime}">00 วัน 00 ชม. 00 นาที 00 วินาที</span></td>
        <td>
          <form class="bot-settings-form" data-token="${encodeURIComponent(token)}">
            <input type="text" class="form-control" name="prefix" value="${userBots[token].prefix}" placeholder="คำนำหน้า" style="width: 50px;">
            <input type="number" class="form-control" name="cooldown" value="${userBots[token].cooldown}" min="0" max="10" placeholder="คูลดาวน์" style="width: 70px;">
            <select class="form-control" name="commandSource" style="width: 120px;">
              <option value="system" ${userBots[token].commandSource === "system" ? "selected" : ""}>ระบบ</option>
              <option value="user" ${userBots[token].commandSource === "user" ? "selected" : ""}>ผู้ใช้</option>
              <option value="both" ${userBots[token].commandSource === "both" ? "selected" : ""}>ทั้งหมด</option>
            </select>
            <button type="submit" class="btn btn-primary btn-sm"><i class="fa-solid fa-save"></i></button>
          </form>
        </td>
        <td><button class="btn btn-danger btn-sm delete-bot-btn" data-token="${encodeURIComponent(token)}"><i class="fa-solid fa-trash me-1"></i></button></td>
      </tr>
      `
          )
          .join("")
      : `<tr><td colspan="5" class="text-center">ไม่มีบอทที่กำลังทำงาน</td></tr>`,
    totalBots,
    onlineBots: totalBots,
    activeBots: totalBots,
  };
}

async function startBot(appState, token, botName, startTime, user, cooldown, prefix, commandSource) {
  try {
    const api = await login({ appState: appState.appState });
    const botInfo = {
      api,
      name: botName,
      startTime,
      prefix: prefix || "/",
      cooldown: cooldown || 0,
      commandSource: commandSource || "both",
      lastUsed: {},
    };
    if (!botSessions[user]) botSessions[user] = {};
    botSessions[user][token] = botInfo;

    console.log(chalk.green(`✅ ${botName} เริ่มทำงานแล้ว`));

    api.listenMqtt(async (err, event) => {
      if (err) {
        console.error(chalk.red(`❌ ข้อผิดพลาดสำหรับ ${botName}: ${err}`));
        return;
      }

      if (events[event.type]) {
        for (const eventCommand of events[event.type]) {
          try {
            await eventCommand.run({ api, event });
          } catch (error) {
            console.error(chalk.red(`❌ ข้อผิดพลาดในเหตุการณ์ ${event.type}: ${error}`));
          }
        }
      }

      if (event.type === "message" || event.type === "message_reply") {
        const message = event.body || "";
        if (!message.startsWith(botInfo.prefix)) return;

        const commandName = message.slice(botInfo.prefix.length).split(" ")[0].toLowerCase();
        const args = message.slice(botInfo.prefix.length + commandName.length).trim().split(/ +/);

        const commands = loadCommands(user, botInfo.commandSource);
        const command = commands[commandName];

        if (!command) {
          const notFoundMessage = users[user].notFoundMessage || "❗ ไม่พบคำสั่ง";
          return api.sendMessage(notFoundMessage, event.threadID, event.messageID);
        }

        const now = Date.now();
        if (botInfo.lastUsed[commandName] && now - botInfo.lastUsed[commandName] < botInfo.cooldown * 1000) {
          const remaining = Math.ceil((botInfo.cooldown * 1000 - (now - botInfo.lastUsed[commandName])) / 1000);
          return api.sendMessage(`กรุณารอ ${remaining} วินาทีก่อนใช้คำสั่งนี้`, event.threadID, event.messageID);
        }

        try {
          await command.run({ api, event, args });
          botInfo.lastUsed[commandName] = now;
          console.log(chalk.blue(`ℹ️ ${botName} ใช้คำสั่ง: ${commandName} (${command.source})`));
        } catch (error) {
          console.error(chalk.red(`❌ ข้อผิดพลาดในคำสั่ง ${commandName}: ${error}`));
          api.sendMessage(`❌ เกิดข้อผิดพลาด: ${error.message}`, event.threadID, event.messageID);
        }
      }
    });
  } catch (err) {
    console.error(chalk.red(`❌ ไม่สามารถเริ่ม ${botName}: ${err}`));
    if (botSessions[user] && botSessions[user][token]) {
      delete botSessions[user][token];
    }
  }
}

// Ensure cookies.json exists before loading
const cookiesPath = path.join(__dirname, 'cookies.json');
if (!fs.existsSync(cookiesPath)) {
  fs.writeFileSync(cookiesPath, '[]', 'utf-8');
  console.error(chalk.red('❌ ไม่พบไฟล์ cookies.json: สร้างไฟล์เปล่าแล้ว กรุณาเพิ่มคุกกี้ในไฟล์นี้แล้วรันใหม่'));
  process.exit(1);
}

// Load bot configs (including saved appState cookies) from JSON file
const botConfigs = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
botConfigs.forEach(cfg => {
  const { user, appState, prefix = '/', cooldown = 0, commandSource = 'both', name } = cfg;
  const token = JSON.stringify({ appState });
  const botName = name || `บอท_${user}`;
  const startTime = Date.now();
  // Start the bot with saved cookies
  startBot({ appState }, token, botName, startTime, user, cooldown, prefix, commandSource);
});

console.log(chalk.yellow(figlet.textSync("BotMaster", { horizontalLayout: "full" })));
console.log(chalk.green(`✅ บอททั้งหมดเริ่มทำงานแล้ว`));