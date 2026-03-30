import { apiClient } from './client';
import type {
  ModelSource,
  ModelSourceCreate,
  ModelSourceModel,
  ModelSourceModelCreate,
  ModelSourceUpdate,
  UserSettings,
  UserSettingsUpdate,
} from '../types';

export const settingsApi = {
  // User settings
  getSettings: () => apiClient.get<UserSettings>('/settings/me').then((r) => r.data),
  updateSettings: (data: UserSettingsUpdate) =>
    apiClient.patch<UserSettings>('/settings/me', data).then((r) => r.data),

  // Model sources
  listSources: () => apiClient.get<ModelSource[]>('/settings/sources').then((r) => r.data),
  createSource: (data: ModelSourceCreate) =>
    apiClient.post<ModelSource>('/settings/sources', data).then((r) => r.data),
  updateSource: (sourceId: string, data: ModelSourceUpdate) =>
    apiClient.patch<ModelSource>(`/settings/sources/${sourceId}`, data).then((r) => r.data),
  deleteSource: (sourceId: string) => apiClient.delete(`/settings/sources/${sourceId}`),
  refreshModels: (sourceId: string) =>
    apiClient
      .post<ModelSourceModel[]>(`/settings/sources/${sourceId}/refresh`)
      .then((r) => r.data),

  // Models within a source
  listSourceModels: (sourceId: string) =>
    apiClient
      .get<ModelSourceModel[]>(`/settings/sources/${sourceId}/models`)
      .then((r) => r.data),
  addSourceModel: (sourceId: string, data: ModelSourceModelCreate) =>
    apiClient
      .post<ModelSourceModel>(`/settings/sources/${sourceId}/models`, data)
      .then((r) => r.data),
  deleteSourceModel: (sourceId: string, modelId: string) =>
    apiClient.delete(`/settings/sources/${sourceId}/models/${modelId}`),
};
