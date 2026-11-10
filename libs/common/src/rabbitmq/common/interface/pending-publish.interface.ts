export interface PendingPublish {
  finish(error?: Error): void;
}
