export class EmptySkillLibrary {
  list() { return []; }
  get(_id) { return null; }
  has(_id) { return false; }
}

export function normalizeSkillLibrary(value) {
  if (!value) return new EmptySkillLibrary();
  for (const method of ['list','get','has']) {
    if (typeof value[method] !== 'function') throw new Error(`INVALID_SKILL_LIBRARY:${method}`);
  }
  return value;
}
