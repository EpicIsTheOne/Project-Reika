export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  speaker: string;
  text: string;
  timestamp: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  agentId: string;
  messageCount: number;
  updatedAt: string;
}
