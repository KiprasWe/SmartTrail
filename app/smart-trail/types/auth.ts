export type AuthUser = {
  id: string;
  email: string;
  username?: string;
  bio?: string;
  profilePicture?: string;
  createdAt?: string;
  hasOnboarded: boolean;
};
