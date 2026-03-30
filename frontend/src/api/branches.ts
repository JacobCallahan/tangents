import { apiClient } from './client';
import type {
  Branch,
  BranchCreate,
  BranchUpdate,
  CompressRequest,
  CompressResponse,
  CopyNodeResponse,
  MergeRequest,
  MergeResponse,
  Node,
} from '../types';

export const branchesApi = {
  list: (chatId: string) =>
    apiClient.get<Branch[]>(`/chats/${chatId}/branches`).then((r) => r.data),

  create: (chatId: string, data: BranchCreate) =>
    apiClient.post<Branch>(`/chats/${chatId}/branches`, data).then((r) => r.data),

  get: (chatId: string, branchId: string) =>
    apiClient.get<Branch>(`/chats/${chatId}/branches/${branchId}`).then((r) => r.data),

  update: (chatId: string, branchId: string, data: BranchUpdate) =>
    apiClient.patch<Branch>(`/chats/${chatId}/branches/${branchId}`, data).then((r) => r.data),

  delete: (chatId: string, branchId: string) =>
    apiClient.delete(`/chats/${chatId}/branches/${branchId}`),

  getHistory: (chatId: string, branchId: string, nodeId?: string) =>
    apiClient
      .get<Node[]>(`/chats/${chatId}/branches/${branchId}/history`, {
        params: nodeId ? { node_id: nodeId } : undefined,
      })
      .then((r) => r.data),

  merge: (chatId: string, data: MergeRequest) =>
    apiClient
      .post<MergeResponse>(`/chats/${chatId}/branches/merge`, data)
      .then((r) => r.data),

  compress: (chatId: string, branchId: string, data: CompressRequest) =>
    apiClient
      .post<CompressResponse>(`/chats/${chatId}/branches/${branchId}/compress`, data)
      .then((r) => r.data),

  copyNode: (chatId: string, branchId: string, nodeId: string) =>
    apiClient
      .post<CopyNodeResponse>(`/chats/${chatId}/branches/${branchId}/copy/${nodeId}`)
      .then((r) => r.data),

  /**
   * Returns the base URL for the SSE stream so the caller can open an
   * EventSource connection directly (EventSource doesn't support custom headers,
   * so credentials are passed as a query param in dev).
   */
  getMessageStreamUrl: (chatId: string, branchId: string) =>
    `/api/chats/${chatId}/branches/${branchId}/messages`,
};
