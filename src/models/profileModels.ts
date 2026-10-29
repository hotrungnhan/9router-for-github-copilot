import type { LanguageModelChatInformation } from 'vscode';
import { Profile } from '../profiles/profileTypes';
import { formatExposedModelId } from '../profiles/modelNamespace';

export interface ProfileModels {
  profile: Profile;
  models: LanguageModelChatInformation[];
  error?: string;
}

/** Preserve profile order and disambiguate model IDs and duplicate display names. */
export function exposeProfileModels(groups: readonly ProfileModels[]): LanguageModelChatInformation[] {
  const nameCounts = new Map<string, number>();
  for (const { models } of groups) {
    for (const model of models) {
      nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1);
    }
  }
  return groups.flatMap(({ profile, models }) => models.map((model) => ({
    ...model,
    id: formatExposedModelId(profile.id, model.id, groups.length > 1),
    name: (nameCounts.get(model.name) ?? 0) > 1 ? `${model.name} (${profile.name})` : model.name,
    detail: profile.name,
    tooltip: `${model.tooltip ? `${model.tooltip}\n\n` : ''}**Provider Profile:** ${profile.name}`,
  })));
}
