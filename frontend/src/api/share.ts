import { apiClient } from './client';
import type { Node, ShareLink, ShareLinkCreate } from '../types';

export const shareApi = {
  list: () => apiClient.get<ShareLink[]>('/share').then((r) => r.data),
  create: (data: ShareLinkCreate) =>
    apiClient.post<ShareLink>('/share', data).then((r) => r.data),
  revoke: (linkId: string) => apiClient.delete(`/share/${linkId}`),
  // Public (no auth)
  view: (token: string) =>
    apiClient.get<Node[]>(`/share/view/${token}`).then((r) => r.data),
};
