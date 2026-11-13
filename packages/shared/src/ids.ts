import { ID_PREFIX } from "./constants";

/** 短 id 够用且短。别换 UUID：前端书签、铃铛水位、外链都引用现有 id。 */
export function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const ids = {
  subject: () => newId(ID_PREFIX.subject),
  task: () => newId(ID_PREFIX.task),
  grade: () => newId(ID_PREFIX.grade),
  note: () => newId(ID_PREFIX.note),
  file: () => newId(ID_PREFIX.file),
  link: () => newId(ID_PREFIX.link),
  knowledge: () => newId(ID_PREFIX.knowledge),
  syncRun: () => newId("r_"),
};
