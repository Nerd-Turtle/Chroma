export type UserRole = "admin";

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
};

export type AuthUser = {
  id: string;
  username: string;
  role: UserRole;
};

export type SessionRecord = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type AppSettings = {
  timezone: string;
  language: string;
};
