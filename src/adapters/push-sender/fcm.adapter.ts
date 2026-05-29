import { messaging } from '../../config/firebase.js';
import type { MulticastMessage } from 'firebase-admin/messaging';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  // Android: chọn NotificationChannel (đã tạo native với custom sound) để chuông
  // tuỳ chỉnh kêu khi màn hình tắt / app chạy nền. sound = tên file trong res/raw.
  channelId?: string;
  sound?: string;
}

export interface PushResult {
  successCount: number;
  invalidTokens: string[];
}

export const PushSender = {
  async send(fcmTokens: string[], payload: PushPayload): Promise<PushResult> {
    if (!fcmTokens.length) {
      return { successCount: 0, invalidTokens: [] };
    }

    const message: MulticastMessage = {
      tokens: fcmTokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data,
      android: {
        priority: 'high',
        notification: {
          sound: payload.sound ?? 'default',
          channelId: payload.channelId,
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
    };

    const response = await messaging.sendEachForMulticast(message);

    const invalidTokens: string[] = [];
    response.responses.forEach((res, idx) => {
      if (!res.success) {
        const code = res.error?.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(fcmTokens[idx]);
        }
      }
    });

    return { successCount: response.successCount, invalidTokens };
  },
};