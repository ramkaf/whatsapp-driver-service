/** The sender is selected explicitly by session ID; resolution must reject obsolete sessions. */
export interface SendMessageCommand {
  sessionId: string;
  recipient: string;
  content: { text: string };
}

export interface SendMessageResult {
  sessionId: string;
  messageId: string;
}
