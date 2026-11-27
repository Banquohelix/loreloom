import type { WorldConfig } from './types';

/**
 * Generates a ready-to-paste Markdown instruction prompt tailored to a World's
 * exact EntityTypes and property fields so Gemini, ChatGPT, and Claude produce
 * zero-triage lore notes and properly named concept art.
 */
export function generateWorldPromptFramework(world: WorldConfig): string {
  const typeIds = world.entityTypes.map((t) => t.id).join(' | ');
  const worldTag = world.slug.replace(/[^a-z0-9-]+/g, '-');

  const typeBullets = world.entityTypes
    .map((t) => `- \`${t.id}\` — ${t.pluralName}`)
    .join('\n');

  const fieldSections = world.entityTypes
    .filter((t) => t.fields.length > 0)
    .map((t) => {
      const fields = t.fields
        .map((f) => {
          const hint =
            f.fieldType === 'select' && f.options && f.options.length > 0
              ? f.options.join(' | ')
              : `<${f.fieldType}>`;
          return `  - \`- **${f.label}:** ${hint}\``;
        })
        .join('\n');
      return `- **\`${t.id}\` (${t.pluralName})**:\n${fields}`;
    })
    .join('\n');

  const sampleTypes = world.entityTypes.filter((t) => t.id !== 'page').slice(0, 3);
  const sampleFilenames =
    sampleTypes.length > 0
      ? sampleTypes.map((t) => `  - \`${t.id}_example_name.md\``).join('\n')
      : '  - `character_example_name.md`';

  return `# Loreloom AI Output Framework — ${world.name}

> **How to use:** Paste this into your **Gemini Gem**, **ChatGPT Project Instructions**, or **Claude Project Instructions** for **${world.name}**. Every note and image filename generated will auto-sort via Loreloom's **Intake Folder Sync** with zero manual triage.

---

## 1. World Context
- **World:** ${world.name}
- **Medium:** ${world.medium.replace('-', ' ')}${world.subtitle ? `\n- **Overview:** ${world.subtitle}` : ''}

## 2. Lore Notes (\`.md\` or \`.txt\`)

Always start every lore document with this YAML frontmatter block using one of these exact \`type\` values:

${typeBullets}

\`\`\`markdown
---
title: <Entry Name>
type: <${typeIds}>
tags: [${worldTag}, <2-4 concise lowercase tags>]
---
\`\`\`

### Property Fields by Entity Type
Include matching \`- **Field:** Value\` bullets near the top of the note so Loreloom auto-populates the Inspector:

${fieldSections}

### Cross-Linking & Filenames
- Link related entries using \`[[Entry Title]]\` so Loreloom builds backlinks automatically.
- Save files with a clean type-prefixed filename:
${sampleFilenames}

---

## 3. Concept Art & Image Filenames

Prefix saved images with one of these tags so Loreloom auto-sorts them into the right Concept Art Gallery category:

- \`char_<name>.png\` → **Characters**
- \`env_<name>.png\` → **Environments**
- \`map_<name>.png\` → **Maps**
- \`prop_<name>.png\` → **Props** (weapons, items, vehicles, emblems)
- \`mood_<name>.png\` → **Mood** (colorscripts, lighting, references)
`;
}
