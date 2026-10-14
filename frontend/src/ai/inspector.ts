import type { ProjectDocument } from '../domain/document';

export interface Finding {
  level: 'warn' | 'info';
  objectId: string | null;
  message: string;
}

/**
 * AI Inspector rules. Deterministic checks on the shared document: no model call, no credits.
 * Each finding is a plain statement the user can verify.
 */
export function inspectDocument(doc: ProjectDocument): Finding[] {
  const findings: Finding[] = [];
  const objects = doc.objectOrder.map((id) => doc.objects[id]).filter((o): o is NonNullable<typeof o> => !!o);
  if (objects.length === 0) {
    findings.push({ level: 'info', objectId: null, message: 'The scene is empty.' });
    return findings;
  }
  const names = new Map<string, number>();
  for (const o of objects) names.set(o.name.toLowerCase(), (names.get(o.name.toLowerCase()) ?? 0) + 1);
  for (const o of objects) {
    if ((names.get(o.name.toLowerCase()) ?? 0) > 1) {
      findings.push({ level: 'warn', objectId: o.id, message: `"${o.name}" has a duplicate name. Rename it to find it easily.` });
    }
    if (!o.visible) {
      findings.push({ level: 'info', objectId: o.id, message: `"${o.name}" is hidden and will not render or export.` });
    }
    const maxScale = Math.max(...o.scale);
    const minScale = Math.min(...o.scale);
    if (maxScale > 20 || minScale < 0.05) {
      findings.push({ level: 'warn', objectId: o.id, message: `"${o.name}" has an extreme scale (${o.scale.map((n) => n.toFixed(2)).join(' × ')}).` });
    }
    const dist = Math.hypot(...o.position);
    if (dist > 50) {
      findings.push({ level: 'warn', objectId: o.id, message: `"${o.name}" is ${dist.toFixed(0)} units from the origin.` });
    }
    if (o.metalness > 0.8 && o.roughness < 0.2) {
      findings.push({ level: 'info', objectId: o.id, message: `"${o.name}" is almost a perfect mirror; check it reflects what you expect.` });
    }
  }
  if (objects.every((o) => !o.visible)) {
    findings.push({ level: 'warn', objectId: null, message: 'Every object is hidden.' });
  }
  return findings;
}
