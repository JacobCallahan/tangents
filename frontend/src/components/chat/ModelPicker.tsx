/**
 * ModelPicker — inline dropdown to select the active AI model.
 */

import { useAppStore } from '../../store/appStore';

export function ModelPicker() {
  const { availableModels, selectedModel, setSelectedModel } = useAppStore();

  if (availableModels.length === 0) return null;

  return (
    <select
      value={selectedModel?.id ?? ''}
      onChange={(e) => {
        const model = availableModels.find((m) => m.id === e.target.value);
        if (model) setSelectedModel(model);
      }}
      className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-300 focus:border-primary-500 focus:outline-none"
    >
      {availableModels.map((m) => (
        <option key={m.id} value={m.id}>
          {m.display_name}
        </option>
      ))}
    </select>
  );
}
