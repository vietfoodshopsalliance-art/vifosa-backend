// backend/src/modules/users/user.types.ts

export type UserRole = 'customer' | 'store_owner' | 'mod' | 'admin' | 'shipper';

export interface IUser {
  _id: string;
  username: string;       // unique, lowercase, không đổi được
  nickname: string;
  email: string;          // unique, normalized lowercase
  phone: string;          // unique, normalized "0xxxxxxxxx"
  passwordHash: string;
  roles: UserRole[];
  avatar?: string;
  isActive: boolean;
  isSuspicious: boolean;
  badReportCounter: number;
  bankAccountForRefund?: {
    number: string;
    bank: string;
    holder: string;
  } | null;
  notificationPrefs: {
    orderUpdates: boolean;
    promotions: boolean;
    social: boolean;
  };
  fcmTokens: string[];
  tosAcceptedAt?: Date;
  tosVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Gắn vào Fastify request sau khi qua middleware
export interface AuthPayload {
  userId: string;
  roles: UserRole[];
}