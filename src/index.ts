#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DiscordRelay, RelayMessage } from './discord-relay.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

if (!DISCORD_TOKEN || !CHANNEL_ID) {
  throw new Error('DISCORD_TOKEN and DISCORD_CHANNEL_ID environment variables are required');
}

const relay = new DiscordRelay({
  discordToken: DISCORD_TOKEN,
  channelId: CHANNEL_ID
});

const server = new McpServer({
  name: 'discord-relay',
  version: '1.0.0',
});

// Register the send-message tool
server.tool(
  'send-message',
  'Send a message to Discord, either prompting for a response or sending a notification',
  {
    type: z.enum(['prompt', 'notification']),
    title: z.string(),
    content: z.string(),
    actions: z.array(z.object({
      label: z.string(),
      value: z.string()
    })).optional(),
    timeout: z.number().optional()
  },
  async (message: RelayMessage) => {
    const response = await relay.sendMessage(message);
    
    if (!response.success) {
      return {
        content: [
          {
            type: 'text',
            text: response.error || 'Unknown error occurred'
          }
        ],
        isError: true
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: message.type === 'notification' 
            ? 'Message sent successfully'
            : `Response received: ${response.response}`
        }
      ]
    };
  }
);

async function main() {
  try {
    await relay.initialize();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Discord relay MCP server running on stdio');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle cleanup
process.on('SIGINT', async () => {
  await relay.destroy();
  process.exit(0);
});

main().catch(console.error);
