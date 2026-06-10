# Ecommerce Backend Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ecommerce generation from browser-only IndexedDB history to an async Vercel-backed task flow that returns a task ID immediately, stores generated assets in COS, persists task metadata in a database, and lets the frontend poll task status.

**Architecture:** Keep the existing Vite frontend and Vercel project. `POST /api/ecommerce/generate` validates input, creates a `queued` task, returns `202 + taskId`, and schedules backend work with a runtime background hook. The worker updates the task to `running`, calls the upstream image API, uploads successful outputs to COS, writes terminal status (`completed`, `failed`, or `delivery_failed`), and the frontend polls `GET /api/ecommerce/tasks/:id`.

**Tech Stack:** Vite, React 19, TypeScript, Vercel Node Functions, local Express, OpenAI-compatible provider calls, Tencent COS SDK, Postgres, existing contract scripts.

---

## Backend Decision

- Use the existing Vercel project instead of a separate Node deployment.
- Add server endpoints:
  - `POST /api/ecommerce/generate` creates one queued task group, stores metadata in DB, schedules generation in the backend, and returns the server task ID immediately.
  - `GET /api/ecommerce/tasks/:id` returns one task for frontend polling.
  - `GET /api/ecommerce/tasks?limit=30` returns latest ecommerce task groups from DB.
- Use Vercel `waitUntil()` for the first backendized worker pass. This removes the browser long request and large response body, but is still bounded by Function max duration; a later durability pass can swap the scheduler for a real queue or Vercel Workflow without changing the frontend polling contract.
- Keep old workbench history in `src/historyStore.ts` unchanged.
- Stop using ecommerce IndexedDB from `src/App.tsx`; ecommerce history must come from `/api/ecommerce/tasks`.

## File Structure

- Create `server/ecommerce/types.ts`
  - Shared server-side ecommerce task, image, cost, status, repository, storage, and service input types.
- Create `server/ecommerce/service.ts`
  - Validates request input, creates queued tasks, runs background generation, uploads source/generated images, and updates task metadata.
- Create `server/ecommerce/storage.ts`
  - Implements Tencent COS storage from env vars and a local file storage fallback for local dev.
- Create `server/ecommerce/repository.ts`
  - Implements Postgres repository from env vars and a local JSON repository fallback for local dev.
- Create `server/ecommerce/http.ts`
  - Converts Express/Vercel requests into service calls and consistent JSON responses.
- Create `api/ecommerce/generate.ts`
  - Vercel Function wrapper for task creation.
- Create `api/ecommerce/tasks.ts`
  - Vercel Function wrapper for task listing.
- Create `api/ecommerce/tasks/[id].ts`
  - Vercel Function wrapper for task polling.
- Modify `server/index.ts`
  - Mount the same ecommerce routes for local dev.
- Modify `src/ecommerceHistoryStore.ts`
  - Replace IndexedDB implementation with server API client and server-backed task types.
- Modify `src/App.tsx`
  - Load ecommerce history from server, call server task creation, display `cosUrl`/`imageDataUrl`, and keep workbench history untouched.
- Modify `vercel.json`
  - Exclude `/api/*` from SPA rewrites so Functions can execute.
- Modify `package.json`
  - Add dependencies and focused backend contract scripts.

## Environment Variables

- `DATABASE_URL` or `ECOMMERCE_DATABASE_URL`: Postgres connection string.
- `TENCENT_COS_SECRET_ID`
- `TENCENT_COS_SECRET_KEY`
- `TENCENT_COS_BUCKET`
- `TENCENT_COS_REGION`
- `TENCENT_COS_PUBLIC_BASE_URL` optional CDN/public base URL.
- `ECOMMERCE_LOCAL_DATA_DIR` optional local dev directory for JSON metadata and local object files.

## Tasks

### Task 1: Backend Contract Test

- [ ] Update `scripts/check-ecommerce-backend-contract.ts`.
- [ ] Test service injection with fake storage, fake repository, fake scheduler, fake copy generator, and fake image generator.
- [ ] Assert task creation returns `queued` immediately and does not call copy/image generators inline.
- [ ] Assert HTTP creation returns `202`, `{ taskId, task }`, and schedules exactly one background job.
- [ ] Assert `runEcommerceTask` updates `queued -> running -> completed`.
- [ ] Assert `GET /api/ecommerce/tasks/:id` returns one task for polling.
- [ ] Assert storage upload failure updates task status to `delivery_failed`.
- [ ] Assert source product image and generated images are uploaded with stable ecommerce object keys.
- [ ] Assert persisted task includes `id`, `status`, `cost`, `userId`, `productImage`, `images[].cosUrl`, `images[].objectKey`, models, size, copy, and timestamps.
- [ ] Add `test:ecommerce-backend` to `package.json`.
- [ ] Run `npm run test:ecommerce-backend` and verify it fails because the current backend still waits synchronously.

### Task 2: Backend Service and Adapters

- [ ] Implement server ecommerce types.
- [ ] Implement queued task creation, background task execution, and dependency injection.
- [ ] Implement local file object storage and Tencent COS object storage.
- [ ] Implement local JSON repository and Postgres repository with `create`, `update`, `getById`, and `list`.
- [ ] Implement HTTP helpers and Vercel wrappers.
- [ ] Mount local Express routes.
- [ ] Run `npm run test:ecommerce-backend` until it passes.

### Task 3: Frontend Server History Contract

- [ ] Update `scripts/check-ui-contract.mjs` so ecommerce expects server-backed history, not `saveStoredEcommerceHistory`.
- [ ] Add checks that ecommerce creation uses polling helpers and does not expect final images from the initial `POST`.
- [ ] Update `scripts/check-routing-contract.mjs` so Vercel rewrites exclude `/api/`.
- [ ] Add checks for `/api/ecommerce/tasks/:id` local and Vercel polling route.
- [ ] Run focused tests and verify they fail before frontend/routing changes.

### Task 4: Frontend Switch

- [ ] Replace ecommerce IndexedDB client with server API functions in `src/ecommerceHistoryStore.ts`.
- [ ] Change `src/App.tsx` to call `createStoredEcommerceTask`, poll `loadStoredEcommerceTask(taskId)`, and use `loadStoredEcommerceHistory` for history.
- [ ] Remove ecommerce auto-save effect.
- [ ] Render `image.cosUrl ?? image.imageDataUrl` for history/current results.
- [ ] Keep ZIP download compatible by mapping server images to `HistoryItem` with URL/data URL support.
- [ ] Run focused UI/routing/ecommerce tests until they pass.

### Task 5: Verification

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Start `npm run dev` and verify the app can reach `/api/ecommerce/tasks` locally.
- [ ] Report any required production env vars that are not present locally.

## Self-Review

- Source image COS storage: Task 1 and Task 2.
- Generated image COS storage: Task 1 and Task 2.
- Task metadata DB storage: Task 1 and Task 2.
- Server task ID returned: Task 1, Task 2, and Task 4.
- Frontend history reads server: Task 3 and Task 4.
- Cost/status/future user fields: Task 1 and Task 2.
- Workbench/ecommerce history separation: Task 3 and Task 4.
- Vercel placement decision: Backend Decision and Task 2.
