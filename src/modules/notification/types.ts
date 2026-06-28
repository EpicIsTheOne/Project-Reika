export type NotificationTone = 'info' | 'success' | 'warning';

export interface AppNotification {
  id: string;
  tone: NotificationTone;
  title: string;
  body: string;
}
