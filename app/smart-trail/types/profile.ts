export interface UserProfile {
  id: string;
  username: string;
  email: string;
  bio?: string | null;
  createdAt: string;
  hasPassword: boolean;
}

export interface EditForm {
  username: string;
  bio: string;
}
