import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const runGenerateStart = app.indexOf("const runGenerate = async () => {");
assert(runGenerateStart !== -1, "Generation submit handler must exist.");

const createPlanIndex = app.indexOf("const taskInputs = createGenerationPlan", runGenerateStart);
assert(createPlanIndex !== -1, "Generation submit handler must create a generation plan.");

const lockDeclarationIndex = app.indexOf("generationLockRef");
const lockGuardIndex = app.indexOf("if (generationLockRef.current)", runGenerateStart);
const lockSetIndex = app.indexOf("generationLockRef.current = true", runGenerateStart);
const finallyIndex = app.indexOf("} finally {", runGenerateStart);
const lockReleaseIndex = app.indexOf("generationLockRef.current = false", finallyIndex);

assert(lockDeclarationIndex !== -1, "Generation flow must keep a synchronous submit lock ref.");
assert(
  lockGuardIndex !== -1 && lockGuardIndex < createPlanIndex,
  "Generation submit handler must check the synchronous lock before creating tasks."
);
assert(
  lockSetIndex !== -1 && lockSetIndex < createPlanIndex,
  "Generation submit handler must acquire the synchronous lock before creating tasks."
);
assert(
  lockReleaseIndex !== -1 && lockReleaseIndex > finallyIndex,
  "Generation submit handler must release the synchronous lock in a finally block."
);

console.log("Generation submit lock checks passed.");
