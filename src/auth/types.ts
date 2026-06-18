export type LocalUser = {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  role: string;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export const SESSION_COOKIE_NAME = "projectego_session";
