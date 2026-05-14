// backend/src/modules/auth/auth.schema.ts
import { z } from 'zod';

// Normalize phone VN: "0912345678" hoặc "+84912345678" → "0912345678"
const normalizePhone = (raw: string) => {
  const trimmed = raw.trim().replace(/\s+/g, '');
  if (trimmed.startsWith('+84')) return '0' + trimmed.slice(3);
  return trimmed;
};

export const RegisterSchema = z.object({
  username: z
    .string()
    .min(3, 'Username tối thiểu 3 ký tự')
    .max(30, 'Username tối đa 30 ký tự')
    .regex(/^[a-z0-9_.]+$/, 'Username chỉ gồm a-z, 0-9, dấu _ và .'),
  nickname: z.string().min(1).max(50).trim(),
  email: z.string().email('Email không hợp lệ').toLowerCase().trim(),
  phone: z
    .string()
    .transform(normalizePhone)
    .refine((p) => /^0\d{9}$/.test(p), 'Số điện thoại không hợp lệ (VD: 0912345678)'),
  password: z
    .string()
    .min(8, 'Mật khẩu tối thiểu 8 ký tự')
    .max(100),
  tosAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Bạn phải đồng ý với Điều khoản dịch vụ' }),
  }),
  tosVersion: z.string().default('1.0'),
});

export const LoginSchema = z.object({
  // Cho phép đăng nhập bằng username HOẶC email HOẶC phone
  identifier: z.string().min(1, 'Vui lòng nhập username, email hoặc số điện thoại'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const UpdateFcmTokenSchema = z.object({
  fcmToken: z.string().min(1),
});

export const AcceptTosSchema = z.object({
  version: z.string().default('1.0'),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;