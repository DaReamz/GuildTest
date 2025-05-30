// Import required packages
const { Client } = require("guilded.js");
const axios = require("axios");
require("dotenv").config( { path: 'C:\KURO\Guild\blob\main\KURO.env' } );
const fs = require('fs');

// --- Configuration ---
const guildedToken = process.env.GUILDED_TOKEN;
const shapesApiKey = process.env.SHAPES_API_KEY;
const shapeUsername = process.env.SHAPE_USERNAME;

const SHAPES_API_BASE_URL = "https://api.shapes.inc/v1";
const SHAPES_MODEL_NAME = `shapesinc/${shapeUsername}`;

if (!guildedToken || !shapesApiKey || !shapeUsername) {
    console.error(
        "Error: Please ensure that GUILDED_TOKEN, SHAPES_API_KEY, and SHAPE_USERNAME are set in your .env file."
    );
    process.exit(1);
}

// Initialize Guilded Client
const client = new Client({ token: guildedToken });

// File path for storing active channels
const channelsFilePath = './active_channels.json';

// In-memory store for active channels (Channel IDs)
let activeChannels = new Set();

// In-memory store for known Shape bots (User IDs that have been identified as Shapes)
let knownShapeBots = new Set();

// --- Message Constants ---
const START_MESSAGE_ACTIVATE = () => `🤖 Hello! I am now active for **${shapeUsername}** in this channel. All messages here will be forwarded.`;
const START_MESSAGE_RESET = () => `🤖 The long-term memory for **${shapeUsername}** in this channel has been reset for you. You can start a new conversation.`;
const ALREADY_ACTIVE_MESSAGE = () => `🤖 I am already active in this channel for **${shapeUsername}**.`;
const NOT_ACTIVE_MESSAGE = () => `🤖 I am not active in this channel. Use \`/activate ${shapeUsername}\` first.`;
const DEACTIVATE_MESSAGE = () => `🤖 I am no longer active for **${shapeUsername}** in this channel.`;
const INCORRECT_ACTIVATE_MESSAGE = () => `🤖 To activate me, please use \`/activate ${shapeUsername}\`.`;

// --- Helper Functions ---

function loadActiveChannels() {
    try {
        if (fs.existsSync(channelsFilePath)) {
            const data = fs.readFileSync(channelsFilePath, 'utf8');
            const loadedChannelIds = JSON.parse(data);
            if (Array.isArray(loadedChannelIds)) {
                activeChannels = new Set(loadedChannelIds);
                console.log(`Active channels loaded: ${loadedChannelIds.join(', ')}`);
            } else {
                console.warn("Invalid format in active_channels.json. Starting with empty channels.");
                activeChannels = new Set();
            }
        } else {
            console.log("No active_channels.json found. Starting with empty channels.");
            activeChannels = new Set();
        }
    } catch (error) {
        console.error("Error loading active channels:", error);
        activeChannels = new Set();
    }
}

function saveActiveChannels() {
    try {
        const channelIdsArray = Array.from(activeChannels);
        fs.writeFileSync(channelsFilePath, JSON.stringify(channelIdsArray, null, 2));
        console.log(`Active channels saved: ${channelIdsArray.join(', ')}`);
    } catch (error) {
        console.error("Error saving active channels:", error);
    }
}

function isShapeBot(message) {
    // Check if user is already known to be a Shape bot
    if (knownShapeBots.has(message.createdById)) {
        return true;
    }
    
    // Check if message author is marked as bot type
    if (message.author?.type === "bot") {
        knownShapeBots.add(message.createdById);
        return true;
    }
    
    // Check common Shape bot patterns in username or display name
    const username = message.author?.name?.toLowerCase() || '';
    const displayName = message.author?.displayName?.toLowerCase() || '';
    
    const shapePatterns = [
        'shape',
        'bot',
        '🤖',
        shapeUsername.toLowerCase()
    ];
    
    const isLikelyShape = shapePatterns.some(pattern => 
        username.includes(pattern) || displayName.includes(pattern)
    );
    
    if (isLikelyShape) {
        knownShapeBots.add(message.createdById);
        console.log(`Identified potential Shape bot: ${username} (ID: ${message.createdById})`);
        return true;
    }
    
    return false;
}

function getMediaType(url) {
    if (typeof url !== 'string') return null;
    try {
        if (!url.toLowerCase().startsWith('http://') && !url.toLowerCase().startsWith('https://')) {
            return null;
        }
        const parsedUrl = new URL(url);
        const path = parsedUrl.pathname.toLowerCase();
        const pathOnly = path.split('?')[0].split('#')[0];

        if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].some(ext => pathOnly.endsWith(ext))) return 'image';
        if (['.mp4', '.webm', '.mov'].some(ext => pathOnly.endsWith(ext))) return 'video';
        if (['.mp3', '.ogg', '.wav'].some(ext => pathOnly.endsWith(ext))) return 'audio';
        return null;
    } catch (e) {
        return null;
    }
}

function formatShapeResponseForGuilded(shapeResponse) {
    if (typeof shapeResponse !== 'string' || shapeResponse.trim() === "") {
        return { content: shapeResponse };
    }

    const lines = shapeResponse.split('\n');
    let mediaUrl = null;
    let contentLines = [];
    let mediaUrlFoundAndProcessed = false;

    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        const unwrappedLine = line.startsWith('<') && line.endsWith('>')
                            ? line.substring(1, line.length - 1)
                            : line;
        
        const mediaType = getMediaType(unwrappedLine);

        if (mediaType) {
            mediaUrl = unwrappedLine;
            if (i === lines.length - 1) {
                contentLines = lines.slice(0, i);
            } else {
                contentLines = lines.filter((_, index) => index !== i);
            }
            mediaUrlFoundAndProcessed = true;
            break; 
        }
    }

    let messageContent = shapeResponse;
    const embeds = [];

    if (mediaUrlFoundAndProcessed) {
        messageContent = contentLines.join('\n').trim();
        const mediaType = getMediaType(mediaUrl);

        if (mediaType === 'image' && mediaUrl) {
            embeds.push({ image: { url: mediaUrl } });
            if (messageContent === "") {
                return { embeds };
            }
            return { content: messageContent, embeds };
        } else if ((mediaType === 'audio' || mediaType === 'video') && mediaUrl) {
            if (messageContent === "") {
                messageContent = mediaUrl;
            } else {
                messageContent += '\n' + mediaUrl;
            }
            return { content: messageContent };
        }
        if (messageContent === "" && mediaUrl) {
             return { content: mediaUrl };
        }
        return { content: messageContent };
    }

    return { content: shapeResponse };
}

async function sendMessageToShape(userId, channelId, content) {
    console.log(`[Shapes API] Sending message to ${SHAPES_MODEL_NAME}: User ${userId}, Channel ${channelId}, Content: "${content}"`);
    try {
        const response = await axios.post(
            `${SHAPES_API_BASE_URL}/chat/completions`,
            {
                model: SHAPES_MODEL_NAME,
                messages: [{ role: "user", content: content }],
            },
            {
                headers: {
                    Authorization: `Bearer ${shapesApiKey}`,
                    "Content-Type": "application/json",
                    "X-User-Id": userId,
                    "X-Channel-Id": channelId,
                },
                timeout: 60000,
            }
        );

        if (response.data?.choices?.length > 0) {
            const shapeResponseContent = response.data.choices[0].message.content;
            const isBot = response.data.choices[0].message.isBot || false;
            
            console.log(`[Shapes API] Response received: "${shapeResponseContent}", isBot: ${isBot}`);
            
            // If the response indicates this is from a bot, mark the user as a Shape bot
            if (isBot) {
                knownShapeBots.add(userId);
                console.log(`Marked user ${userId} as Shape bot based on API response`);
            }
            
            return {
                content: shapeResponseContent,
                isBot: isBot
            };
        }
        console.warn("[Shapes API] Unexpected response structure or empty choices:", response.data);
        return { content: "", isBot: false };
    } catch (error) {
        console.error("[Shapes API] Error during communication:", error.response ? error.response.data : error.message);
        if (error.code === 'ECONNABORTED' || error.message.toLowerCase().includes('timeout')) {
            return { content: "Sorry, the request to the Shape timed out.", isBot: false };
        }
        if (error.response?.status === 429) {
            return { content: "Too many requests to the Shapes API. Please try again later.", isBot: false };
        }
        throw error;
    }
}

async function processShapeApiCommand(guildedMessage, guildedCommandName, baseShapeCommand, requiresArgs = false, commandArgs = []) {
    const channelId = guildedMessage.channelId;
    const userId = guildedMessage.createdById;

    if (!activeChannels.has(channelId)) {
        await guildedMessage.reply(NOT_ACTIVE_MESSAGE());
        return;
    }

    let fullShapeCommand = baseShapeCommand;
    if (requiresArgs) {
        const argString = commandArgs.join(" ");
        if (!argString) {
            await guildedMessage.reply(`Please provide the necessary arguments for \`/${guildedCommandName}\`. Example: \`/${guildedCommandName} your arguments\``);
            return;
        }
        fullShapeCommand = `${baseShapeCommand} ${argString}`;
    }

    console.log(`[Bot Command: /${guildedCommandName}] Sending to Shape API: User ${userId}, Channel ${channelId}, Content: "${fullShapeCommand}"`);
    
    try {
        await client.rest.put(`/channels/${channelId}/typing`);
    } catch (typingError) {
        console.warn(`[Typing Indicator] Error for /${guildedCommandName}:`, typingError.message);
    }

    try {
        const shapeResponse = await sendMessageToShape(userId, channelId, fullShapeCommand);

        if (shapeResponse?.content?.trim() !== "") {
            const replyPayload = formatShapeResponseForGuilded(shapeResponse.content);
            if (typeof replyPayload.content === 'string' && (replyPayload.content.startsWith("Sorry,") || replyPayload.content.startsWith("Too many requests"))) {
                await guildedMessage.reply(replyPayload.content);
            } else {
                await guildedMessage.reply(replyPayload);
            }
        } else {
            if (baseShapeCommand === "!reset") {
                await guildedMessage.reply(START_MESSAGE_RESET());
            } else if (["!sleep", "!wack"].includes(baseShapeCommand)) {
                await guildedMessage.reply(`The command \`/${guildedCommandName}\` has been sent to **${shapeUsername}**. It may have been processed silently.`);
            } else {
                await guildedMessage.reply(`**${shapeUsername}** didn't provide a specific textual response for \`/${guildedCommandName}\`. The action might have been completed, or it may require a different interaction.`);
            }
        }
    } catch (error) {
        console.error(`[Bot Command: /${guildedCommandName}] Error during Shapes API call or Guilded reply:`, error);
        await guildedMessage.reply(`Sorry, there was an error processing your \`/${guildedCommandName}\` command with **${shapeUsername}**.`);
    }
}

// --- Main Bot Logic ---

loadActiveChannels();

client.on("ready", () => {
    console.log(`Bot logged in as ${client.user?.name}!`);
    console.log(`Ready to process messages for Shape: ${shapeUsername} (Model: ${SHAPES_MODEL_NAME}).`);
    console.log(`Active channels on startup: ${Array.from(activeChannels).join(', ') || 'None'}`);
});

client.on("messageCreated", async (message) => {
    // Ignore messages from this bot
    if (message.createdById === client.user?.id) {
        return;
    }
    
    // Ignore messages from other Shape bots
    if (isShapeBot(message)) {
        console.log(`[Bot Filter] Ignoring message from Shape bot: ${message.author?.name} (ID: ${message.createdById})`);
        return;
    }
    
    // Ignore empty messages
    if (!message.content?.trim()) {
        return;
    }

    const commandPrefix = "/";
    const guildedUserName = message.author?.name || "Unknown User";
    const channelId = message.channelId;

    // Handle commands
    if (message.content.startsWith(commandPrefix)) {
        const [command, ...args] = message.content.slice(commandPrefix.length).trim().split(/\s+/);
        const lowerCaseCommand = command.toLowerCase();

        // Bot-specific commands
        if (lowerCaseCommand === "activate") {
            if (args[0] !== shapeUsername) {
                return message.reply(INCORRECT_ACTIVATE_MESSAGE());
            }
            
            if (activeChannels.has(channelId)) {
                return message.reply(ALREADY_ACTIVE_MESSAGE());
            }
            
            activeChannels.add(channelId);
            saveActiveChannels();
            console.log(`Bot activated in channel: ${channelId}`);
            return message.reply(START_MESSAGE_ACTIVATE());
        }

        if (lowerCaseCommand === "deactivate") {
            if (!activeChannels.has(channelId)) {
                return message.reply(NOT_ACTIVE_MESSAGE());
            }
            
            activeChannels.delete(channelId);
            saveActiveChannels();
            console.log(`Bot deactivated in channel: ${channelId}`);
            return message.reply(DEACTIVATE_MESSAGE());
        }

        // Only process other commands in active channels
        if (!activeChannels.has(channelId)) {
            return message.reply(NOT_ACTIVE_MESSAGE());
        }

        // Shapes API commands
        switch (lowerCaseCommand) {
            case "reset":
                return processShapeApiCommand(message, "reset", "!reset");
            case "sleep":
                return processShapeApiCommand(message, "sleep", "!sleep");
            case "dashboard":
                return processShapeApiCommand(message, "dashboard", "!dashboard");
            case "info":
                return processShapeApiCommand(message, "info", "!info");
            case "web":
                return processShapeApiCommand(message, "web", "!web", true, args);
            case "help":
                return processShapeApiCommand(message, "help", "!help");
            case "imagine":
                return processShapeApiCommand(message, "imagine", "!imagine", true, args);
            case "wack":
                return processShapeApiCommand(message, "wack", "!wack");
            default:
                // Ignore unknown commands in active channels
                return;
        }
    }

    // Only process regular messages in active channels
    if (!activeChannels.has(channelId)) {
        return;
    }

    // Process regular messages in active channels
    const originalContent = message.content;
    const userId = message.createdById;
    const contentForShape = `${guildedUserName}: ${originalContent}`;

    console.log(`[Regular Message] User ${userId} (${guildedUserName}) in active channel ${channelId}: "${originalContent}"`);
    console.log(`[Regular Message] Sending to Shape: "${contentForShape}"`);

    try {
        await client.rest.put(`/channels/${channelId}/typing`);
    } catch (typingError) {
        console.warn("[Typing Indicator] Error sending typing indicator:", typingError.message);
    }

    try {
        const shapeResponse = await sendMessageToShape(userId, channelId, contentForShape);

        if (shapeResponse?.content?.trim()) {
            const replyPayload = formatShapeResponseForGuilded(shapeResponse.content);
            if (typeof replyPayload.content === 'string' && (replyPayload.content.startsWith("Sorry,") || replyPayload.content.startsWith("Too many requests"))) {
                await message.reply(replyPayload.content);
            } else {
                await message.reply(replyPayload);
            }
        } else {
            console.log("[Regular Message] No valid response from Shapes API or response was empty.");
        }
    } catch (err) {
        console.error("[Regular Message] Error sending message to Shape or response to Guilded:", err);
        try {
            await message.reply("Oops, something went wrong while trying to talk to the Shape.");
        } catch (replyError) {
            console.error("Could not send error message to Guilded:", replyError);
        }
    }
});

client.on("error", (error) => {
    console.error("An error occurred in the Guilded Client:", error);
});

client.login(guildedToken);
console.log("Bot starting...");