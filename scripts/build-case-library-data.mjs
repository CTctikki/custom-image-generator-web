import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("../public/cases.json", import.meta.url));
const indexPath = fileURLToPath(new URL("../public/cases-index.json", import.meta.url));
const promptsDirPath = fileURLToPath(new URL("../public/case-prompts/", import.meta.url));
const legacyPromptsPath = fileURLToPath(new URL("../public/case-prompts.json", import.meta.url));

const source = JSON.parse(readFileSync(sourcePath, "utf8"));

const indexPayload = {
  repository: source.repository,
  totalCases: source.totalCases,
  categories: source.categories,
  styles: source.styles,
  scenes: source.scenes,
  cases: source.cases.map((caseItem) => ({
    id: caseItem.id,
    title: caseItem.title,
    image: caseItem.image,
    imageAlt: caseItem.imageAlt,
    sourceLabel: caseItem.sourceLabel,
    sourceUrl: caseItem.sourceUrl,
    promptPreview: caseItem.promptPreview,
    category: caseItem.category,
    styles: caseItem.styles,
    scenes: caseItem.scenes,
    featured: caseItem.featured,
    githubUrl: caseItem.githubUrl
  }))
};

writeFileSync(indexPath, JSON.stringify(indexPayload));
rmSync(legacyPromptsPath, { force: true });
rmSync(promptsDirPath, { force: true, recursive: true });
mkdirSync(promptsDirPath, { recursive: true });

for (const caseItem of source.cases) {
  writeFileSync(join(promptsDirPath, `${caseItem.id}.txt`), caseItem.prompt);
}

const promptFiles = readdirSync(promptsDirPath).filter((name) => name.endsWith(".txt"));
console.log(`Wrote ${indexPayload.cases.length} case index rows and ${promptFiles.length} prompt files.`);
