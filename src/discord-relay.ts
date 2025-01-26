import { Client, TextChannel, Message, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';

export interface RelayConfig {
  discordToken: string;
  channelId: string;
}

export interface RelayMessage {
  type: 'prompt' | 'notification';
  title: string;
  content: string;
  actions?: Array<{
    label: string;
    value: string;
  }>;
  timeout?: number;
}

export interface RelayResponse {
  success: boolean;
  error?: string;
  response?: string;
}

export class DiscordRelay {
  private client: Client;
  private config: RelayConfig;
  private responseMap: Map<string, {
    resolve: (response: RelayResponse) => void;
    timer?: NodeJS.Timeout;
  }>;

  constructor(config: RelayConfig) {
    this.config = config;
    this.client = new Client({
      intents: ['Guilds', 'GuildMessages', 'MessageContent']
    });
    this.responseMap = new Map();
  }

  async initialize(): Promise<void> {
    try {
      await this.client.login(this.config.discordToken);
      this.setupResponseHandling();
      console.error('Discord relay initialized successfully');
    } catch (error) {
      throw new Error(`Failed to initialize Discord client: ${error}`);
    }
  }

  async sendMessage(message: RelayMessage): Promise<RelayResponse> {
    try {
      const channel = await this.client.channels.fetch(this.config.channelId);
      if (!channel || !(channel instanceof TextChannel)) {
        throw new Error('Invalid channel or channel not found');
      }

      const embed = new EmbedBuilder()
        .setTitle(message.title)
        .setDescription(message.content)
        .setColor(message.type === 'notification' ? 0x00ff00 : 0x0099ff)
        .setTimestamp();

      const components = [];
      if (message.actions && message.actions.length > 0) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        message.actions.forEach((action, index) => {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`action_${index}`)
              .setLabel(action.label)
              .setStyle(ButtonStyle.Primary)
          );
        });
        components.push(row);
      }

      const discordMessage = await channel.send({
        embeds: [embed],
        components: components
      });

      if (message.type === 'notification') {
        return { success: true };
      }

      return new Promise((resolve) => {
        this.responseMap.set(discordMessage.id, {
          resolve,
          timer: message.timeout ? setTimeout(() => {
            this.clearResponse(discordMessage.id);
            resolve({ 
              success: false, 
              error: 'Response timeout' 
            });
          }, message.timeout) : undefined
        });
      });
    } catch (error) {
      return {
        success: false,
        error: `Failed to send message: ${error}`
      };
    }
  }

  private setupResponseHandling() {
    this.client.on('messageCreate', (message: Message) => {
      if (message.channel.id !== this.config.channelId || message.author.bot) {
        return;
      }

      // Find the most recent message that's waiting for a response
      const entries = Array.from(this.responseMap.entries());
      const lastEntry = entries[entries.length - 1];
      
      if (lastEntry) {
        const [messageId, handler] = lastEntry;
        this.clearResponse(messageId);
        handler.resolve({
          success: true,
          response: message.content
        });
      }
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;

      const messageId = interaction.message.id;
      const handler = this.responseMap.get(messageId);
      
      if (handler) {
        const actionIndex = parseInt(interaction.customId.split('_')[1]);
        const message = interaction.message;
        const embed = message.embeds[0];
        
        if (embed && message.components) {
          const actions = message.components[0].components
            .filter(comp => comp.type === 2) // Button type
            .map((comp: any) => ({
              label: comp.label,
              value: comp.customId
            }));

          if (actions[actionIndex]) {
            this.clearResponse(messageId);
            handler.resolve({
              success: true,
              response: actions[actionIndex].label
            });
          }
        }

        await interaction.deferUpdate();
      }
    });
  }

  private clearResponse(messageId: string) {
    const handler = this.responseMap.get(messageId);
    if (handler?.timer) {
      clearTimeout(handler.timer);
    }
    this.responseMap.delete(messageId);
  }

  async destroy() {
    this.client.destroy();
  }
}
