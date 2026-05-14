import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.stubEnv('JWT_SECRET', 'test-access-secret-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
vi.stubEnv('JWT_REFRESH_SECRET', 'test-refresh-secret-64-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
vi.stubEnv('JWT_ACCESS_EXPIRES', '15m');
vi.stubEnv('JWT_REFRESH_EXPIRES', '30d');

const {
  registerUser,
  loginUser,
  refreshTokens,
  logoutUser,
  clearRefreshTokenStore,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
} = await import('./auth.service.js');

const { UserModel } = await import('../users/user.model.js');

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  clearRefreshTokenStore();
});

const validInput = {
  username: 'testuser',
  nickname: 'Test User',
  email: 'test@example.com',
  phone: '0912345678',
  password: 'Password123',
  tosAccepted: true as const,
  tosVersion: '1.0',
};

// ─── registerUser ─────────────────────────────────────────────────────────────

describe('registerUser', () => {
  it('dang ky thanh cong tra ve user va tokens', async () => {
    const result = await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });

    expect(result.user.username).toBe('testuser');
    expect(result.user.nickname).toBe('Test User');
    expect(result.user.email).toBe('test@example.com');
    expect(result.user.phone).toBe('0912345678');
    expect(result.user.roles).toEqual(['customer']);
    expect(result.user.isActive).toBe(true);
    expect(result.user.tosAcceptedAt).toBeTruthy();
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    // Tuyet doi khong tra passwordHash ra ngoai
    expect((result.user as any).passwordHash).toBeUndefined();
    // fcmTokens khong can tra ve client
    expect((result.user as any).fcmTokens).toBeUndefined();
  });

  it('ConflictError khi username da ton tai', async () => {
    await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });

    await expect(
      registerUser(
        { ...validInput, email: 'other@example.com', phone: '0987654321' },
        { ip: '127.0.0.1', tosVersion: '1.0' }
      )
    ).rejects.toThrow(ConflictError);
  });

  it('ConflictError khi email da ton tai', async () => {
    await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });

    await expect(
      registerUser(
        { ...validInput, username: 'otherusr', phone: '0987654321' },
        { ip: '127.0.0.1', tosVersion: '1.0' }
      )
    ).rejects.toThrow(ConflictError);
  });

  it('ConflictError khi phone da ton tai', async () => {
    await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });

    await expect(
      registerUser(
        { ...validInput, username: 'otherusr', email: 'other@example.com' },
        { ip: '127.0.0.1', tosVersion: '1.0' }
      )
    ).rejects.toThrow(ConflictError);
  });

  it('luu tosAcceptedAt va tosVersion dung', async () => {
    const result = await registerUser(
      { ...validInput, tosVersion: '2.0' },
      { ip: '127.0.0.1', tosVersion: '2.0' }
    );
    expect(result.user.tosVersion).toBe('2.0');
    expect(result.user.tosAcceptedAt).toBeTruthy();
  });
});

// ─── loginUser ────────────────────────────────────────────────────────────────

describe('loginUser', () => {
  beforeEach(async () => {
    await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });
  });

  it('dang nhap bang username thanh cong', async () => {
    const result = await loginUser({ identifier: 'testuser', password: 'Password123' });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.username).toBe('testuser');
    expect((result.user as any).passwordHash).toBeUndefined();
  });

  it('dang nhap bang email thanh cong', async () => {
    const result = await loginUser({ identifier: 'test@example.com', password: 'Password123' });
    expect(result.accessToken).toBeTruthy();
  });

  it('dang nhap bang phone thanh cong', async () => {
    const result = await loginUser({ identifier: '0912345678', password: 'Password123' });
    expect(result.accessToken).toBeTruthy();
  });

  it('UnauthorizedError khi sai password', async () => {
    await expect(
      loginUser({ identifier: 'testuser', password: 'SaiMatKhau' })
    ).rejects.toThrow(UnauthorizedError);
  });

  it('UnauthorizedError khi user khong ton tai', async () => {
    await expect(
      loginUser({ identifier: 'khongtontai', password: 'Password123' })
    ).rejects.toThrow(UnauthorizedError);
  });

  it('ForbiddenError khi tai khoan bi khoa', async () => {
    await UserModel.findOneAndUpdate({ username: 'testuser' }, { isActive: false });

    await expect(
      loginUser({ identifier: 'testuser', password: 'Password123' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('tra ve accessToken va refreshToken khac nhau', async () => {
    const result = await loginUser({ identifier: 'testuser', password: 'Password123' });
    expect(result.accessToken).not.toBe(result.refreshToken);
  });
});

// ─── refreshTokens ────────────────────────────────────────────────────────────

describe('refreshTokens', () => {
  it('tra ve token pair moi khac token cu', async () => {
    const { refreshToken: oldToken } = await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });

    const result = await refreshTokens(oldToken);

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    // Token moi phai khac token cu (jti rotation)
    expect(result.refreshToken).not.toBe(oldToken);
  });

  it('UnauthorizedError khi dung lai refresh token da rotate', async () => {
    const { refreshToken: oldToken } = await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });

    await refreshTokens(oldToken); // su dung lan 1 -> token bi xoa khoi store

    // Dung lai token cu -> phai fail
    await expect(refreshTokens(oldToken)).rejects.toThrow(UnauthorizedError);
  });

  it('token moi co the duoc dung tiep tuc', async () => {
    const { refreshToken: token1 } = await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });

    const { refreshToken: token2 } = await refreshTokens(token1);
    const { refreshToken: token3 } = await refreshTokens(token2);

    expect(token3).toBeTruthy();
    expect(token3).not.toBe(token2);
    expect(token3).not.toBe(token1);
  });

  it('UnauthorizedError khi refresh token gia mao', async () => {
    await expect(
      refreshTokens('day.la.token.gia.mao')
    ).rejects.toThrow(UnauthorizedError);
  });
});

// ─── logoutUser ───────────────────────────────────────────────────────────────

describe('logoutUser', () => {
  it('sau logout refresh token khong con dung duoc', async () => {
    const { refreshToken } = await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });

    await logoutUser(refreshToken);

    await expect(refreshTokens(refreshToken)).rejects.toThrow(UnauthorizedError);
  });

  it('logout nhieu lan khong throw loi', async () => {
    const { refreshToken } = await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });

    await logoutUser(refreshToken);
    await expect(logoutUser(refreshToken)).resolves.not.toThrow();
  });

  it('accessToken cu van hop le sau logout (stateless JWT)', async () => {
    const { accessToken, refreshToken } = await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });

    await logoutUser(refreshToken);

    // Access token la stateless, van verify duoc cho den khi het han
    const { verifyAccessToken } = await import('../../utils/jwt.js');
    const payload = verifyAccessToken(accessToken);
    expect(payload.userId).toBeTruthy();
  });
});

// ─── multi-device ─────────────────────────────────────────────────────────────

describe('multi-device: moi thiet bi co token rieng', () => {
  it('2 thiet bi dang nhap doc lap, logout 1 khong anh huong thiet bi kia', async () => {
    await registerUser(validInput, { ip: '127.0.0.1', tosVersion: '1.0' });

    const device1 = await loginUser({ identifier: 'testuser', password: 'Password123' });
    const device2 = await loginUser({ identifier: 'testuser', password: 'Password123' });

    expect(device1.refreshToken).not.toBe(device2.refreshToken);

    // Logout device 1
    await logoutUser(device1.refreshToken);

    // Device 2 van refresh duoc
    const result = await refreshTokens(device2.refreshToken);
    expect(result.accessToken).toBeTruthy();

    // Device 1 khong refresh duoc
    await expect(refreshTokens(device1.refreshToken)).rejects.toThrow(UnauthorizedError);
  });
});