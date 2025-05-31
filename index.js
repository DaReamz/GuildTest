// Import required packages
const { Client } = require("guilded.js");
const axios = require("axios");
const pLimit = require("p-limit");
require("dotenv").config({ path: '/home/danbdreamz/ish/ish.env' });
const fs = require('fs').promises; // Use promises version for async I/O
const fsSync = require('fs'); // Keep sync version only for initial load

// --- Configuration ---
const guildedToken = process.env.GUILDED_TOKEN;
const shapesApiKey = process.env.SHAPES_API_KEY;
const shapeUsername = process.env.SHAPE_USERNAME;

const SHAPES_API_BASE_URL = "https://api.shapes.inc/v1";
const SHAPES_MODEL_NAME = `shapesinc/${shapeUsername}`;

// Concurrency limits using p-limit
const SHAPES_API_CONCURRENCY = 3; // Limit concurrent Shapes API calls
const GUILDED_API_CONCURRENCY = 5; // Limit concurrent Guilded API calls
const FILE_IO_CONCURRENCY = 2; // Limit concurrent file operations

const shapesApiLimit = pLimit(SHAPES_API_CONCURRENCY);
const guildedApiLimit = pLimit(GUILDED_API_CONCURRENCY);
const fileIoLimit = pLimit(FILE_IO_CONCURRENCY);

// Memory optimization: Use Map with size limit for known bots
const MAX_KNOWN_BOTS = 1000;
const CLEANUP_THRESHOLD = 1200;

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

// Memory-optimized store for known Shape bots with LRU-like cleanup
let knownShapeBots = new Map(); // Map to track access times
let botAccessOrder = []; // Array to track access order for cleanup

// --- Message Constants (converted to regular functions to avoid closures) ---
const START_MESSAGE_ACTIVATE = `🤖 Hello! I am now active for **${shapeUsername}** in this channel. All messages here will be forwarded.`;
const START_MESSAGE_RESET = `🤖 The long-term memory for **${shapeUsername}** in this channel has been reset for you. You can start a new conversation.`;
const ALREADY_ACTIVE_MESSAGE = `🤖 I am already active in this channel for **${shapeUsername}**.`;
const NOT_ACTIVE_MESSAGE = `🤖 I am not active in this channel. Use \`/activate ${shapeUsername}\` first.`;
const DEACTIVATE_MESSAGE = `🤖 I am no longer active for **${shapeUsername}** in this channel.`;
const INCORRECT_ACTIVATE_MESSAGE = `🤖 To activate me, please use \`/activate ${shapeUsername}\`.`;

// Pre-compile regex patterns to avoid recreating them
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
const WRAPPED_URL_REGEX = /<(https?:\/\/[^>]+)>/g;
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];
const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.wav'];

// Bot patterns for efficient checking
const SHAPE_PATTERNS = [
    'shape',
    'bot',
    '🤖',
    shapeUsername.toLowerCase(),
    'ai',
    'assistant'
];

const BOT_RESPONSE_PATTERNS = [
    'hello! i am now active',
    'i am already active',
    'i am not active',
    'i am no longer active',
    'sorry, there was an error',
    'too many requests',
    'the command has been sent'
];

// --- Helper Functions ---

// Rate-limited async function for loading active channels
async function loadActiveChannels() {
    return fileIoLimit(async () => {
        try {
            if (fsSync.existsSync(channelsFilePath)) {
                const data = await fs.readFile(channelsFilePath, 'utf8');
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
    });
}

// Rate-limited async function for saving active channels
async function saveActiveChannels() {
    return fileIoLimit(async () => {
        try {
            const channelIdsArray = Array.from(activeChannels);
            await fs.writeFile(channelsFilePath, JSON.stringify(channelIdsArray, null, 2));
            console.log(`Active channels saved: ${channelIdsArray.join(', ')}`);
        } catch (error) {
            console.error("Error saving active channels:", error);
        }
    });
}

// Memory-optimized bot detection with cleanup
function cleanupKnownBots() {
    if (knownShapeBots.size > CLEANUP_THRESHOLD) {
        // Remove oldest entries to keep memory usage bounded
        const removeCount = knownShapeBots.size - MAX_KNOWN_BOTS;
        const oldestBots = botAccessOrder.splice(0, removeCount);
        
        for (const botId of oldestBots) {
            knownShapeBots.delete(botId);
        }
        
        console.log(`Cleaned up ${removeCount} old bot entries from memory`);
    }
}

function markAsShapeBot(userId, reason) {
    const now = Date.now();
    
    // Clean up if needed
    if (knownShapeBots.size >= CLEANUP_THRESHOLD) {
        cleanupKnownBots();
    }
    
    // Update or add bot
    if (knownShapeBots.has(userId)) {
        // Move to end of access order
        const index = botAccessOrder.indexOf(userId);
        if (index > -1) {
            botAccessOrder.splice(index, 1);
        }
    }
    
    knownShapeBots.set(userId, now);
    botAccessOrder.push(userId);
    
    console.log(`[Bot Filter] ${reason}: User ${userId}`);
}

function isShapeBot(message) {
    const userId = message.createdById;
    
    // Check if user is already known to be a Shape bot
    if (knownShapeBots.has(userId)) {
        // Update access time efficiently
        const index = botAccessOrder.indexOf(userId);
        if (index > -1) {
            botAccessOrder.splice(index, 1);
            botAccessOrder.push(userId);
        }
        console.log(`[Bot Filter] Known Shape bot detected: ${message.author?.name} (ID: ${userId})`);
        return true;
    }
    
    // Check if message author is marked as bot type
    if (message.author?.type === "bot") {
        markAsShapeBot(userId, "Bot type detected");
        return true;
    }
    
    // Check if message starts with bot emoji (common for Shape responses)
    const content = message.content?.trim();
    if (content?.startsWith('🤖')) {
        markAsShapeBot(userId, "Bot emoji detected in message");
        return true;
    }
    
    // Check common Shape bot patterns in username or display name
    const username = message.author?.name?.toLowerCase() || '';
    const displayName = message.author?.displayName?.toLowerCase() || '';
    
    const isLikelyShape = SHAPE_PATTERNS.some(pattern => 
        username.includes(pattern) || displayName.includes(pattern)
    );
    
    if (isLikelyShape) {
        markAsShapeBot(userId, `Pattern match detected: ${username}, matched pattern in name`);
        return true;
    }
    
    // Check if message content looks like a bot response
    const messageContent = content?.toLowerCase() || '';
    const looksLikeBotResponse = BOT_RESPONSE_PATTERNS.some(pattern => 
        messageContent.includes(pattern)
    );
    
    if (looksLikeBotResponse) {
        markAsShapeBot(userId, `Bot response pattern detected from: ${message.author?.name}`);
        return true;
    }
    
    return false;
}

// Optimized media type detection
function getMediaType(url) {
    if (typeof url !== 'string') return null;
    
    try {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return null;
        }
        
        // More efficient URL parsing - avoid creating URL object if not needed
        const lastSlash = url.lastIndexOf('/');
        const path = lastSlash > -1 ? url.substring(lastSlash + 1).toLowerCase() : url.toLowerCase();
        const pathOnly = path.split('?')[0].split('#')[0];

        if (IMAGE_EXTENSIONS.some(ext => pathOnly.endsWith(ext))) return 'image';
        if (VIDEO_EXTENSIONS.some(ext => pathOnly.endsWith(ext))) return 'video';
        if (AUDIO_EXTENSIONS.some(ext => pathOnly.endsWith(ext))) return 'audio';
        return null;
    } catch (e) {
        return null;
    }
}

// Optimized image URL extraction
function extractImageUrls(text) {
    if (typeof text !== 'string') return [];
    
    const imageUrls = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
        // Reset regex lastIndex to ensure proper matching
        WRAPPED_URL_REGEX.lastIndex = 0;
        URL_REGEX.lastIndex = 0;
        
        // Check for URLs wrapped in angle brackets
        let wrappedMatch;
        while ((wrappedMatch = WRAPPED_URL_REGEX.exec(line)) !== null) {
            const url = wrappedMatch[1];
            if (getMediaType(url) === 'image') {
                imageUrls.push(url);
            }
        }
        
        // Check for plain URLs
        let plainMatch;
        while ((plainMatch = URL_REGEX.exec(line)) !== null) {
            const url = plainMatch[0];
            if (getMediaType(url) === 'image') {
                imageUrls.push(url);
            }
        }
    }
    
    // Use Set for deduplication then convert back to array
    return [...new Set(imageUrls)];
}

// Optimized response formatting
function formatShapeResponseForGuilded(shapeResponse) {
    if (typeof shapeResponse !== 'string' || shapeResponse.trim() === "") {
        return { content: shapeResponse };
    }

    // Extract all image URLs from the response
    const imageUrls = extractImageUrls(shapeResponse);
    
    if (imageUrls.length === 0) {
        return { content: shapeResponse };
    }

    // Create embeds for all found images
    const embeds = imageUrls.map(url => ({ image: { url } }));
    
    // Clean up the content by removing wrapped URLs that are now embedded
    let cleanedContent = shapeResponse;
    for (const url of imageUrls) {
        // Escape special regex characters more efficiently
        const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleanedContent = cleanedContent.replace(new RegExp(`<${escapedUrl}>`, 'g'), '');
        cleanedContent = cleanedContent.replace(new RegExp(`^${escapedUrl}$`, 'gm'), '');
    }
    
    // Clean up extra whitespace and empty lines
    cleanedContent = cleanedContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '')
        .join('\n')
        .trim();

    // Return appropriate format based on whether there's remaining content
    if (cleanedContent === "") {
        return { embeds };
    } else {
        return { content: cleanedContent, embeds };
    }
}

// Rate-limited function with proper error handling and timeout
async function sendMessageToShape(userId, channelId, content) {
    return shapesApiLimit(async () => {
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
                    markAsShapeBot(userId, "Shape bot based on API response");
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
    });
}

// Rate-limited typing indicator function
async function sendTypingIndicator(channelId) {
    return guildedApiLimit(async () => {
        try {
            await client.rest.put(`/channels/${channelId}/typing`);
        } catch (error) {
            console.warn("[Typing Indicator] Error:", error?.message);
            // Don't throw - typing indicator failures shouldn't break the flow
        }
    });
}

// Rate-limited message reply function
async function sendReply(message, payload) {
    return guildedApiLimit(async () => {
        try {
            await message.reply(payload);
        } catch (error) {
            console.error("[Reply] Error sending reply:", error);
            throw error; // Re-throw to handle at higher level
        }
    });
}

// Optimized command processing with better async handling and rate limiting
async function processShapeApiCommand(guildedMessage, guildedCommandName, baseShapeCommand, requiresArgs = false, commandArgs = []) {
    const channelId = guildedMessage.channelId;
    const userId = guildedMessage.createdById;

    if (!activeChannels.has(channelId)) {
        await sendReply(guildedMessage, NOT_ACTIVE_MESSAGE);
        return;
    }

    let fullShapeCommand = baseShapeCommand;
    if (requiresArgs) {
        const argString = commandArgs.join(" ");
        if (!argString) {
            await sendReply(guildedMessage, `Please provide the necessary arguments for \`/${guildedCommandName}\`. Example: \`/${guildedCommandName} your arguments\``);
            return;
        }
        fullShapeCommand = `${baseShapeCommand} ${argString}`;
    }

    console.log(`[Bot Command: /${guildedCommandName}] Sending to Shape API: User ${userId}, Channel ${channelId}, Content: "${fullShapeCommand}"`);
    
    // Send typing indicator (non-blocking)
    await sendTypingIndicator(channelId);

    try {
        const shapeResponse = await sendMessageToShape(userId, channelId, fullShapeCommand);

        if (shapeResponse?.content?.trim() !== "") {
            const replyPayload = formatShapeResponseForGuilded(shapeResponse.content);
            if (typeof replyPayload.content === 'string' && (replyPayload.content.startsWith("Sorry,") || replyPayload.content.startsWith("Too many requests"))) {
                await sendReply(guildedMessage, replyPayload.content);
            } else {
                await sendReply(guildedMessage, replyPayload);
            }
        } else {
            if (baseShapeCommand === "!reset") {
                await sendReply(guildedMessage, START_MESSAGE_RESET);
            } else if (["!sleep", "!wack"].includes(baseShapeCommand)) {
                await sendReply(guildedMessage, `The command \`/${guildedCommandName}\` has been sent to **${shapeUsername}**. It may have been processed silently.`);
            } else {
                await sendReply(guildedMessage, `**${shapeUsername}** didn't provide a specific textual response for \`/${guildedCommandName}\`. The action might have been completed, or it may require a different interaction.`);
            }
        }
    } catch (error) {
        console.error(`[Bot Command: /${guildedCommandName}] Error during Shapes API call or Guilded reply:`, error);
        await sendReply(guildedMessage, `Sorry, there was an error processing your \`/${guildedCommandName}\` command with **${shapeUsername}**.`);
    }
}

// --- Main Bot Logic ---

// Async initialization
async function initializeBot() {
    await loadActiveChannels();
    
    client.on("ready", () => {
        console.log(`Bot logged in as ${client.user?.name}!`);
        console.log(`Ready to process messages for Shape: ${shapeUsername} (Model: ${SHAPES_MODEL_NAME}).`);
        console.log(`Active channels on startup: ${Array.from(activeChannels).join(', ') || 'None'}`);
        console.log(`Concurrency limits - Shapes API: ${SHAPES_API_CONCURRENCY}, Guilded API: ${GUILDED_API_CONCURRENCY}, File I/O: ${FILE_IO_CONCURRENCY}`);
    });

    client.on("messageCreated", async (message) => {
        try {
            // Add comprehensive logging for debugging
            console.log(`[Message Debug] Received message from: ${message.author?.name} (ID: ${message.createdById}), Type: ${message.author?.type}, Content: "${message.content?.substring(0, 50)}..."`);
            
            // Ignore messages from this bot
            if (message.createdById === client.user?.id) {
                console.log(`[Bot Filter] Ignoring message from self: ${client.user?.name}`);
                return;
            }
            
            // Ignore messages from other Shape bots - CRITICAL CHECK
            if (isShapeBot(message)) {
                console.log(`[Bot Filter] *** BLOCKING MESSAGE FROM SHAPE BOT *** ${message.author?.name} (ID: ${message.createdById})`);
                return;
            }
            
            // Ignore empty messages
            if (!message.content?.trim()) {
                console.log(`[Bot Filter] Ignoring empty message from: ${message.author?.name}`);
                return;
            }

            const commandPrefix = "/";
            const guildedUserName = message.author?.name || "Unknown User";
            const channelId = message.channelId;

            console.log(`[Message Processing] Processing message from human user: ${guildedUserName} in channel: ${channelId}`);

            // Handle commands
            if (message.content.startsWith(commandPrefix)) {
                const [command, ...args] = message.content.slice(commandPrefix.length).trim().split(/\s+/);
                const lowerCaseCommand = command.toLowerCase();

                // Bot-specific commands
                if (lowerCaseCommand === "activate") {
                    if (args[0] !== shapeUsername) {
                        return sendReply(message, INCORRECT_ACTIVATE_MESSAGE);
                    }
                    
                    if (activeChannels.has(channelId)) {
                        return sendReply(message, ALREADY_ACTIVE_MESSAGE);
                    }
                    
                    activeChannels.add(channelId);
                    // Use async save with rate limiting
                    await saveActiveChannels();
                    console.log(`Bot activated in channel: ${channelId}`);
                    return sendReply(message, START_MESSAGE_ACTIVATE);
                }

                if (lowerCaseCommand === "deactivate") {
                    if (!activeChannels.has(channelId)) {
                        return sendReply(message, NOT_ACTIVE_MESSAGE);
                    }
                    
                    activeChannels.delete(channelId);
                    // Use async save with rate limiting
                    await saveActiveChannels();
                    console.log(`Bot deactivated in channel: ${channelId}`);
                    return sendReply(message, DEACTIVATE_MESSAGE);
                }

                // Only process other commands in active channels
                if (!activeChannels.has(channelId)) {
                    return sendReply(message, NOT_ACTIVE_MESSAGE);
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

            // Handle typing indicator with rate limiting
            await sendTypingIndicator(channelId);

            try {
                const shapeResponse = await sendMessageToShape(userId, channelId, contentForShape);

                if (shapeResponse?.content?.trim()) {
                    const replyPayload = formatShapeResponseForGuilded(shapeResponse.content);
                    if (typeof replyPayload.content === 'string' && (replyPayload.content.startsWith("Sorry,") || replyPayload.content.startsWith("Too many requests"))) {
                        await sendReply(message, replyPayload.content);
                    } else {
                        await sendReply(message, replyPayload);
                    }
                } else {
                    console.log("[Regular Message] No valid response from Shapes API or response was empty.");
                }
            } catch (err) {
                console.error("[Regular Message] Error sending message to Shape or response to Guilded:", err);
                try {
                    await sendReply(message, "Oops, something went wrong while trying to talk to the Shape.");
                } catch (replyError) {
                    console.error("Could not send error message to Guilded:", replyError);
                }
            }
        } catch (error) {
            console.error("[Message Handler] Unexpected error in message processing:", error);
        }
    });

    client.on("error", (error) => {
        console.error("An error occurred in the Guilded Client:", error);
    });

    // Graceful shutdown handling with rate limiting
    process.on('SIGINT', async () => {
        console.log('Received SIGINT, shutting down gracefully...');
        await saveActiveChannels();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('Received SIGTERM, shutting down gracefully...');
        await saveActiveChannels();
        process.exit(0);
    });

    // Periodic cleanup of bot memory (every 30 minutes)
    setInterval(() => {
        if (knownShapeBots.size > MAX_KNOWN_BOTS) {
            cleanupKnownBots();
        }
    }, 30 * 60 * 1000);

    // Log p-limit queue status every 5 minutes for monitoring
    setInterval(() => {
        console.log(`[Concurrency Monitor] Active/Pending - Shapes API: ${shapesApiLimit.activeCount}/${shapesApiLimit.pendingCount}, Guilded API: ${guildedApiLimit.activeCount}/${guildedApiLimit.pendingCount}, File I/O: ${fileIoLimit.activeCount}/${fileIoLimit.pendingCount}`);
    }, 5 * 60 * 1000);

    await client.login(guildedToken);
    console.log("Bot starting...");
}

// Start the bot
initializeBot().catch(error => {
    console.error("Failed to initialize bot:", error);
    process.exit(1);
});