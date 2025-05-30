function getMediaType(url) {
    if (typeof url !== 'string' || !url.trim()) return null;
    
    try {
        // Handle both wrapped and unwrapped URLs
        const cleanUrl = url.trim();
        const unwrappedUrl = cleanUrl.startsWith('<') && cleanUrl.endsWith('>') 
            ? cleanUrl.substring(1, cleanUrl.length - 1) 
            : cleanUrl;
        
        // More flexible URL validation
        if (!unwrappedUrl.toLowerCase().startsWith('http://') && 
            !unwrappedUrl.toLowerCase().startsWith('https://')) {
            return null;
        }
        
        const parsedUrl = new URL(unwrappedUrl);
        const path = parsedUrl.pathname.toLowerCase();
        
        // Remove query parameters and fragments for extension checking
        const pathOnly = path.split('?')[0].split('#')[0];
        
        // More comprehensive image extensions
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tiff', '.ico'];
        const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv'];
        const audioExtensions = ['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.flac'];
        
        if (imageExtensions.some(ext => pathOnly.endsWith(ext))) return 'image';
        if (videoExtensions.some(ext => pathOnly.endsWith(ext))) return 'video';
        if (audioExtensions.some(ext => pathOnly.endsWith(ext))) return 'audio';
        
        // Check for common image hosting patterns even without extensions
        const imageHostPatterns = [
            'imgur.com',
            'i.imgur.com',
            'cdn.discordapp.com',
            'media.discordapp.net',
            'i.redd.it',
            'preview.redd.it'
        ];
        
        if (imageHostPatterns.some(pattern => parsedUrl.hostname.includes(pattern))) {
            return 'image';
        }
        
        return null;
    } catch (e) {
        console.error(`[Media Type] Error parsing URL "${url}":`, e.message);
        return null;
    }
}

function formatShapeResponseForGuilded(shapeResponse) {
    if (typeof shapeResponse !== 'string' || shapeResponse.trim() === "") {
        return { content: shapeResponse || "" };
    }

    console.log(`[Format Debug] Original response: "${shapeResponse}"`);

    const lines = shapeResponse.split('\n');
    let mediaUrl = null;
    let contentLines = [];
    let mediaUrlFoundAndProcessed = false;

    // Look for media URLs in the response
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Handle both wrapped and unwrapped URLs
        const unwrappedLine = line.startsWith('<') && line.endsWith('>')
                            ? line.substring(1, line.length - 1)
                            : line;
        
        const mediaType = getMediaType(unwrappedLine);
        console.log(`[Format Debug] Checking line ${i}: "${line}" -> unwrapped: "${unwrappedLine}" -> mediaType: ${mediaType}`);

        if (mediaType) {
            mediaUrl = unwrappedLine;
            console.log(`[Format Debug] Found ${mediaType} URL: "${mediaUrl}"`);
            
            // Remove the media URL line from content
            if (i === lines.length - 1) {
                contentLines = lines.slice(0, i);
            } else {
                contentLines = lines.filter((_, index) => index !== i);
            }
            mediaUrlFoundAndProcessed = true;
            break; 
        }
    }

    // If no media found, return as-is
    if (!mediaUrlFoundAndProcessed) {
        console.log(`[Format Debug] No media found, returning original content`);
        return { content: shapeResponse };
    }

    let messageContent = contentLines.join('\n').trim();
    const mediaType = getMediaType(mediaUrl);
    
    console.log(`[Format Debug] Media processing - Type: ${mediaType}, URL: "${mediaUrl}", Content: "${messageContent}"`);

    // Validate the image URL before embedding
    if (mediaType === 'image' && mediaUrl) {
        // Test if the URL is accessible (basic validation)
        try {
            new URL(mediaUrl); // This will throw if URL is malformed
            
            // Optional: Validate the URL actually points to an image
            // Uncomment the next few lines if you want strict validation
            /*
            const isValidImage = await validateImageUrl(mediaUrl);
            if (!isValidImage) {
                console.warn(`[Format Debug] URL validation failed for: "${mediaUrl}"`);
                // Fall back to including URL in content
                if (messageContent === "") {
                    return { content: mediaUrl };
                }
                return { content: `${messageContent}\n${mediaUrl}` };
            }
            */
            
            const embeds = [{ 
                image: { 
                    url: mediaUrl 
                } 
            }];
            
            console.log(`[Format Debug] Created image embed for: "${mediaUrl}"`);
            
            if (messageContent === "") {
                return { embeds };
            }
            return { content: messageContent, embeds };
            
        } catch (urlError) {
            console.error(`[Format Debug] Invalid image URL "${mediaUrl}":`, urlError.message);
            // Fall back to including URL in content
            if (messageContent === "") {
                return { content: mediaUrl };
            }
            return { content: `${messageContent}\n${mediaUrl}` };
        }
    } 
    
    // Handle video/audio or fallback
    if ((mediaType === 'audio' || mediaType === 'video') && mediaUrl) {
        if (messageContent === "") {
            return { content: mediaUrl };
        }
        return { content: `${messageContent}\n${mediaUrl}` };
    }
    
    // Fallback: include the URL in content
    if (mediaUrl) {
        if (messageContent === "") {
            return { content: mediaUrl };
        }
        return { content: `${messageContent}\n${mediaUrl}` };
    }

    return { content: messageContent || shapeResponse };
}

// Add this function to validate image URLs
async function validateImageUrl(url) {
    try {
        const response = await axios.head(url, { 
            timeout: 5000,
            validateStatus: (status) => status < 400 
        });
        
        const contentType = response.headers['content-type'];
        const isImage = contentType && contentType.startsWith('image/');
        
        console.log(`[URL Validation] URL: ${url}, Content-Type: ${contentType}, Valid: ${isImage}`);
        return isImage;
    } catch (error) {
        console.error(`[URL Validation] Failed to validate ${url}:`, error.message);
        return false;
    }
}