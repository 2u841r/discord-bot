import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import cron from "node-cron";
import moment from "moment-hijri";
import Calendar from "date-bengali-revised";
// import { createClient } from "@supabase/supabase-js";

const userSessions = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const logChannelId = process.env.LOG_CHANNEL_ID;

// Define commands
const commands = [
  {
    name: "zing",
    description: "Check bot latency",
    type: 1,
  },
  {
    name: "date",
    description: "Get current date in different calendars",
    type: 1,
  },
];

// Register commands
async function registerCommands() {
  try {
    const rest = new REST().setToken(TOKEN);
    console.log("Registering commands...");

    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands,
    });

    console.log("Commands registered!");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
}

// Command handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  switch (interaction.commandName) {
    case "zing": {
      const ping = client.ws.ping;
      await interaction.reply(`🏓 Pong! Latency: ${ping}ms`);
      break;
    }

    case "date": {
      const today = new Date();

      const greg = today.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      let cal = new Calendar();
      cal.fromDate(today);
      const bangla = cal.format("dddd D MMMM, Y");

      const hijri = moment().format("iDD iMMMM iYYYY");

      await interaction.reply(
        `**Gregorian:** ${greg}\n**Bangla:** ${bangla}\n**Hijri:** ${hijri}`
      );
      break;
    }
  }
});

// Ready event
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands();
});

// Daily cron job
cron.schedule("0 6 * * *", () => {
  const today = new Date();

  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const bar = days[today.getDay()];
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const monthName = monthNames[today.getMonth()];
  const formattedDate = `${day}/${monthName}/${year}`;

  const gregToday = `${bar} ${formattedDate}`;

  // Hijri date (Bangladesh offset)
  let yesterday = new Date(today.getTime() - 1000 * 60 * 60 * 24);

  function getTodaysArabicDay() {
    const weekdays = [
      "الاحد",
      "الاثنين",
      "الثلاثاء",
      "الاربعاء",
      "الخميس",
      "الجمعة",
      "السبت",
    ];
    return yesterday.getDay() === 6
      ? weekdays[0]
      : weekdays[yesterday.getDay() + 1];
  }

  const todaysArabicDay = getTodaysArabicDay();
  const hijri = moment(yesterday).format("iD / iMMMM / iYYYY");
  const hijriToday = `${todaysArabicDay} ${hijri}`;

  // Bangla date
  let cal = new Calendar();
  cal.fromDate(today);
  const bongabdo = cal.format("dddd D MMMM, Y");

  // Final message
  const message = `## ${gregToday}\n## ${bongabdo}\n## ${hijriToday}`;

  const channel = client.channels.cache.get(logChannelId);
  if (channel) channel.send(message);
});

// voiceStateUpdate
client.on("voiceStateUpdate", async (oldState, newState) => {
  const logChannel = await client.channels.fetch(logChannelId);
  if (!logChannel) return;

  const member = newState.member;
  const displayName = member.user.displayName;

  const currentTime = new Date();
  const time = currentTime.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  // Ensure a record exists
  if (!userSessions.has(displayName)) {
    userSessions.set(displayName, {
      joinTime: null,
      channelName: null,
      totalMs: 0,
    });
  }

  let session = userSessions.get(displayName);

  // ---------------------------
  // USER JOINS A CHANNEL
  // ---------------------------
  if (!oldState.channel && newState.channel) {
    session.joinTime = currentTime.toISOString();
    session.channelName = newState.channel.name;

    const msg = `**${displayName}** has joined **${newState.channel.name}** at ${time}`;
    await logChannel.send(msg);
  }

  // ---------------------------
  // USER SWITCHED CHANNELS
  // ---------------------------
  else if (
    oldState.channel &&
    newState.channel &&
    oldState.channelId !== newState.channelId
  ) {
    const joinTime = new Date(session.joinTime);

    // Duration of the previous channel
    const prevMs = currentTime - joinTime;
    session.totalMs += prevMs;

    const prevSession = new Date(prevMs).toISOString().slice(11, 19);

    const previousChannel = oldState.channel.name;

    // Reset for new channel
    session.joinTime = currentTime.toISOString();
    session.channelName = newState.channel.name;

    const msg = `**${displayName}** switched from **${previousChannel}** to **${newState.channel.name}** at ${time} (previous session: ${prevSession})`;
    await logChannel.send(msg);
  }

  // ---------------------------
  // USER LEFT ALL CHANNELS
  // ---------------------------
  else if (oldState.channel && !newState.channel) {
    if (session.joinTime) {
      const joinTime = new Date(session.joinTime);

      // Final session duration
      const sessionMs = currentTime - joinTime;
      session.totalMs += sessionMs;

      const sessionTime = new Date(sessionMs).toISOString().slice(11, 19);
      const totalTime = new Date(session.totalMs)
        .toISOString()
        .slice(11, 19);

      const msg = `**${displayName}** has left **${session.channelName}** at ${time} (session time: ${sessionTime}, total time: ${totalTime})`;

      // Clear session
      userSessions.delete(displayName);

      await logChannel.send(msg);
    } else {
      // Fallback (should not happen normally)
      const msg = `**${displayName}** has left **${oldState.channel.name}** at ${time}`;
      await logChannel.send(msg);
    }
  }
});


client.login(TOKEN);
