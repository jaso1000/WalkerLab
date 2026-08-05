// Admin-only user-management calls (web only - native has no login/backend
// concept at all, see AuthContext.tsx). Only ever imported from
// app/settings/users.tsx.
import { apiFetch } from './backendApi';

export interface AppUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export function listUsers(): Promise<AppUser[]> {
  return apiFetch<AppUser[]>('/api/auth/users');
}

export function createUser(username: string, password: string): Promise<AppUser> {
  return apiFetch<AppUser>('/api/auth/users', { method: 'POST', body: { username, password } });
}

export function deleteUser(id: string): Promise<void> {
  return apiFetch(`/api/auth/users/${id}`, { method: 'DELETE' });
}
