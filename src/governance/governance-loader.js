import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readText(rootDir, relativePath) {
  return readFileSync(join(rootDir, relativePath), 'utf8');
}

function documentIsActive(text) {
  const match = /^Status:\s*([^\r\n]+)/mi.exec(text);
  return !match || String(match[1]).trim().toUpperCase() === 'ACTIVE';
}

function splitSections(text) {
  const lines = String(text || '').split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = { heading:heading[1].trim(), body:[] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections.map(section => ({ ...section, body:section.body.join('\n').trim() }));
}

function compactBody(body) {
  return String(body || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^Type:\s*/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseConstitution(text) {
  if (!documentIsActive(text)) return [];
  return splitSections(text).map(section => {
    const match = /^(C-\d+)\s+—\s+(.+)$/.exec(section.heading);
    if (!match) return null;
    return {
      id:match[1],
      title:match[2].trim(),
      source:'constitution',
      priority:0,
      hard:true,
      text:compactBody(section.body),
    };
  }).filter(Boolean);
}

export function loadRuntimeConstitution(rootDir) {
  const constitutionText = readText(rootDir, 'docs/PRODUCT_CONSTITUTION.md');
  return {
    loadedAt:new Date().toISOString(),
    constitution:parseConstitution(constitutionText),
  };
}

export { parseConstitution, documentIsActive };
