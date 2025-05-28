

















// Event handler for new messages
client.on("messageCreated", async (message) => {
    if (message.createdById === client.user?.id || message.author?.type === "bot") {
        return; // Ignore bot's own messages or other bots
    }
    if (!message.content || message.content.trim() === "") {
        return; // Ignore empty messages
    }

    const commandPrefix = "/";
    const guildedUserName = message.author?.name || "Unknown User";
    const channelId = message.channelId;
    const userId = message.createdById;
    let hasReplied = false; // Track if a reply has been sent

    // Function to send a single reply and prevent further replies
    const sendSingleReply = async (contentOrPayload) => {
        if (hasReplied) {
            console.warn(`[Warning] Attempted to send multiple replies for message: "${message.content}"`);
            return;
        }
        try {
            await message.reply(contentOrPayload);
            hasReplied = true;
        } catch (replyError) {
            console.error("[Reply Error] Could not send reply to Guilded:", replyError);
        }
    };

    // Send typing indicator (not considered a response)
    try {
        await client.rest.put(`/channels/${channelId}/typing`);
    } catch (typingError) {
        console.warn("[Typing Indicator] Error:", typingError.message);
    }

    // Handle commands
    if (message.content.startsWith(commandPrefix)) {
        const [command, ...args] = message.content.slice(commandPrefix.length).trim().split(/\s+/);
        const lowerCaseCommand = command.toLowerCase();

        // Bot-specific commands
        if (lowerCaseCommand === "activate") {
            if (activeChannels.has(channelId)) {
                await sendSingleReply(ALREADY_ACTIVE_MESSAGE());
            } else {
                activeChannels.add(channelId);
                saveActiveChannels();
                console.log(`Bot activated in channel: ${channelId}`);
                await sendSingleReply(START_MESSAGE_ACTIVATE());
            }
            return; // Stop processing after command
        }

        if (lowerCaseCommand === "deactivate") {
            if (activeChannels.has(channelId)) {
                activeChannels.delete(channelId);
                saveActiveChannels();
                console.log(`Bot deactivated in channel: ${channelId}`);
                await sendSingleReply(DEACTIVATE_MESSAGE());
            } else {
                await sendSingleReply(NOT_ACTIVE_MESSAGE());
            }
            return; // Stop processing after command
        }

        // Shapes API commands
        const commandMap = {
            reset: { shapeCommand: "!reset", requiresArgs: false },
            sleep: { shapeCommand: "!sleep", requiresArgs: false },
            dashboard: { shapeCommand: "!dashboard", requiresArgs: false },
            info: { shapeCommand: "!info", requiresArgs: false },
            web: { shapeCommand: "!web", requiresArgs: true },
            help: { shapeCommand: "!help", requiresArgs: false },
            imagine: { shapeCommand: "!imagine", requiresArgs: true },
            wack: { shapeCommand: "!wack", requiresArgs: false },
        };

        const commandConfig = commandMap[lowerCaseCommand];
        if (commandConfig) {
            if (!activeChannels.has(channelId)) {
                await sendSingleReply(NOT_ACTIVE_MESSAGE());
                return;
            }

            const { shapeCommand, requiresArgs } = commandConfig;
            let fullShapeCommand = shapeCommand;
            if (requiresArgs) {
                const argString = args.join(" ");
                if (!argString) {
                    await sendSingleReply(
                        `Please provide the necessary arguments for \`/${lowerCaseCommand}\`. Example: \`/${lowerCaseCommand} your arguments\``
                    );
                    return;
                }
                fullShapeCommand = `${shapeCommand} ${argString}`;
            }

            console.log(`[Bot Command: /${lowerCaseCommand}] Sending to Shape API: User ${userId}, Channel ${channelId}, Content: "${fullShapeCommand}"`);
            try {
                const shapeResponse = await sendMessageToShape(userId, channelId, fullShapeCommand);
                if (shapeResponse && shapeResponse.trim() !== "") {
                    const replyPayload = formatShapeResponseForGuilded(shapeResponse);
                    if (
                        typeof replyPayload.content === "string" &&
                        (replyPayload.content.startsWith("Sorry,") || replyPayload.content.startsWith("Too many requests"))
                    ) {
                        await sendSingleReply(replyPayload.content);
                    } else {
                        await sendSingleReply(replyPayload);
                    }
                } else {
                    if (shapeCommand === "!reset") {
                        await sendSingleReply(START_MESSAGE_RESET());
                    } else if (SHAPES_COMMANDS_WITH_POTENTIALLY_SILENT_SUCCESS.includes(shapeCommand)) {
                        await sendSingleReply(
                            `The command \`/${lowerCaseCommand}\` has been sent to **${shapeUsername}**. It may have been processed silently.`
                        );
                    } else {
                        await sendSingleReply(
                            `**${shapeUsername}** didn't provide a specific textual response for \`/${lowerCaseCommand}\`. The action might have been completed, or it may require a different interaction.`
                        );
                    }
                }
            } catch (error) {
                console.error(`[Bot Command: /${lowerCaseCommand}] Error during Shapes API call:`, error);
                await sendSingleReply(
                    `Sorry, there was an error processing your \`/${lowerCaseCommand}\` command with **${shapeUsername}**.`
                );
            }
            return; // Stop processing after command
        }

        // Unrecognized command
        if (activeChannels.has(channelId)) {
            await sendSingleReply(
                `Unknown command: \`/${command}\`. Try \`/help\` for assistance with **${shapeUsername}**'s commands.`
            );
        } else {
            await sendSingleReply(
                `Unknown command: \`/${command}\`. Please activate the bot with \`/activate\` to use commands with **${shapeUsername}**.`
            );
        }
        return; // Stop processing after unrecognized command
    }

    // Handle regular messages in active channels
    if (activeChannels.has(channelId)) {
        const originalContent = message.content;
        const contentForShape = `${guildedUserName}: ${originalContent}`;

        console.log(`[Regular Message] User ${userId} (${guildedUserName}) in active channel ${channelId}: "${originalContent}"`);
        console.log(`[Regular Message] Sending to Shape: "${contentForShape}"`);

        try {
            const shapeResponse = await sendMessageToShape(userId, channelId, contentForShape);
            if (shapeResponse && shapeResponse.trim() !== "") {
                const replyPayload = formatShapeResponseForGuilded(shapeResponse);
                if (
                    typeof replyPayload.content === "string" &&
                    (replyPayload.content.startsWith("Sorry,") || replyPayload.content.startsWith("Too many requests"))
                ) {
                    await sendSingleReply(replyPayload.content);
                } else {
                    await sendSingleReply(replyPayload);
                }
            } else {
                console.log("[Regular Message] No valid response from Shapes API or response was empty.");
                // For regular messages, silently ignore empty responses to avoid unnecessary replies
                // If you want to notify the user, uncomment the line below
                // await sendSingleReply(`**${shapeUsername}** didn't send a reply.`);
            }
        } catch (err) {
            console.error("[Regular Message] Error sending message to Shape:", err);
            await sendSingleReply(`Oops, something went wrong while trying to talk to **${shapeUsername}**.`);
        }
    }
    // If channel is not active and it's not a command, no response is sent
});
// Connect to Guilded
client.login(guildedToken);

console.log("Bot starting...");
