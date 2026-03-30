import { apiClient } from './client';
import type { Chat, ChatCreate, ChatUpdate, GraphResponse, SummarizeNodeRequest, SummarizeNodeResponse } from '../types';

export const chatsApi = {
  list: () => apiClient.get<Chat[]>('/chats').then((r) => r.data),

  create: (data: ChatCreate) => apiClient.post<Chat>('/chats', data).then((r) => r.data),

  get: (chatId: string) => apiClient.get<Chat>(`/chats/${chatId}`).then((r) => r.data),

  update: (chatId: string, data: ChatUpdate) =>
    apiClient.patch<Chat>(`/chats/${chatId}`, data).then((r) => r.data),

  delete: (chatId: string) => apiClient.delete(`/chats/${chatId}`),

  getGraph: (chatId: string) =>
    apiClient.get<GraphResponse>(`/chats/${chatId}/graph`).then((r) => r.data),

  deleteNode: (chatId: string, nodeId: string) =>
    apiClient.delete(`/chats/${chatId}/nodes/${nodeId}`),

  summarizeNode: (chatId: string, nodeId: string, data: SummarizeNodeRequest) =>
    apiClient
      .post<SummarizeNodeResponse>(`/chats/${chatId}/nodes/${nodeId}/summarize`, data)
      .then((r) => r.data),
};
