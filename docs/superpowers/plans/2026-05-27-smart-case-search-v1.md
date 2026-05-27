# 智能案例搜索第一版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给现有生图网站新增第一版智能案例搜索：独立 FastAPI 服务用本地 `bge-base-zh-v1.5` 搜公共案例，React 前端优先调用语义搜索，失败时退回现有关键词搜索。

**Architecture:** 后端新增 `search-service`，负责读取 `public/cases-index.json` 和 `public/case-prompts.json`、生成 embedding、维护内存向量索引、提供 `/health` 和 `/search`。前端新增一个小型 smart search client，并在现有案例库搜索框上接入 debounced 请求、结果排序和降级状态。

**Tech Stack:** Python FastAPI、sentence-transformers、NumPy、pytest、React 19、Vite、TypeScript、Node contract scripts。

---

## 文件结构

- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\requirements.txt`
  - Python 搜索服务依赖。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\pytest.ini`
  - pytest 路径和环境。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\README.md`
  - 本地启动、模型路径、API 示例。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\__init__.py`
  - Python 包标记。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\settings.py`
  - 环境变量解析。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\schemas.py`
  - 请求和响应模型。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\case_data.py`
  - 案例文件读取、检索文本拼接、数据指纹。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\embedding.py`
  - BGE 模型包装和向量归一化。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\search_index.py`
  - embedding 缓存、内存向量索引、排序。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\main.py`
  - FastAPI app、CORS、`/health`、`/search`。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\tests\test_case_data.py`
  - 案例读取和文本拼接测试。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\tests\test_search_index.py`
  - 向量排序、分类过滤、空查询测试。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\tests\test_api.py`
  - FastAPI 接口测试。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\src\caseSmartSearch.ts`
  - 前端搜索 API client。
- Create: `E:\CodexWork\中转站\custom-image-generator-web\scripts\check-case-smart-search-contract.mjs`
  - 前端智能搜索契约检查。
- Modify: `E:\CodexWork\中转站\custom-image-generator-web\src\App.tsx`
  - 搜索状态、请求 effect、语义结果排序、降级 UI。
- Modify: `E:\CodexWork\中转站\custom-image-generator-web\src\styles.css`
  - 搜索状态 badge 和移动端布局。
- Modify: `E:\CodexWork\中转站\custom-image-generator-web\package.json`
  - 增加 `test:case-smart-search` 并接入 `npm run test`。
- Modify: `E:\CodexWork\中转站\custom-image-generator-web\.gitignore`
  - 忽略搜索服务本地缓存和 Python 虚拟环境。

## Task 1: 后端案例数据读取

**Files:**
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\requirements.txt`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\pytest.ini`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\__init__.py`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\settings.py`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\schemas.py`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\case_data.py`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\tests\test_case_data.py`

- [ ] **Step 1: 写依赖和 pytest 配置**

`requirements.txt`:

```text
fastapi==0.115.6
uvicorn[standard]==0.34.0
sentence-transformers==3.3.1
numpy==2.2.1
pydantic==2.10.4
pydantic-settings==2.7.0
pytest==8.3.4
httpx==0.28.1
```

`pytest.ini`:

```ini
[pytest]
pythonpath = .
testpaths = tests
```

- [ ] **Step 2: 写失败测试：能从案例 JSON 拼出搜索文档**

`tests/test_case_data.py`:

```python
import json
from pathlib import Path

from app.case_data import load_case_documents


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def test_load_case_documents_merges_index_and_full_prompt(tmp_path: Path) -> None:
    index_path = tmp_path / "cases-index.json"
    prompts_path = tmp_path / "case-prompts.json"
    write_json(
        index_path,
        {
            "totalCases": 1,
            "categories": ["Products & E-commerce"],
            "cases": [
                {
                    "id": 101,
                    "title": "高级香水海报",
                    "category": "Products & E-commerce",
                    "styles": ["premium", "minimal"],
                    "scenes": ["studio"],
                    "sourceLabel": "demo",
                    "promptPreview": "黑色背景上的香水瓶",
                }
            ],
        },
    )
    write_json(prompts_path, {"prompts": {"101": "完整提示词：玻璃香水瓶，柔光，商业摄影"}})

    documents = load_case_documents(index_path, prompts_path)

    assert len(documents) == 1
    assert documents[0].id == 101
    assert documents[0].category == "Products & E-commerce"
    assert "高级香水海报" in documents[0].search_text
    assert "完整提示词" in documents[0].search_text
    assert documents[0].fingerprint
```

- [ ] **Step 3: 运行测试，确认先失败**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web\search-service
python -m pytest tests/test_case_data.py -q
```

Expected: FAIL，错误包含 `No module named 'app.case_data'`。

- [ ] **Step 4: 写最小实现**

`app/schemas.py`:

```python
from pydantic import BaseModel, Field


class CaseDocument(BaseModel):
    id: int
    category: str
    search_text: str
    fingerprint: str


class SearchRequest(BaseModel):
    query: str = Field(default="")
    category: str = Field(default="全部")
    topK: int = Field(default=24, ge=1, le=60)


class SearchResult(BaseModel):
    id: int
    score: float


class SearchResponse(BaseModel):
    results: list[SearchResult]
```

`app/case_data.py`:

```python
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from app.schemas import CaseDocument


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _case_fingerprint(case_item: dict[str, Any], prompt: str) -> str:
    payload = json.dumps(
        {
            "id": case_item.get("id"),
            "title": case_item.get("title", ""),
            "category": case_item.get("category", ""),
            "styles": case_item.get("styles", []),
            "scenes": case_item.get("scenes", []),
            "sourceLabel": case_item.get("sourceLabel", ""),
            "promptPreview": case_item.get("promptPreview", ""),
            "prompt": prompt,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_case_documents(index_path: Path, prompts_path: Path) -> list[CaseDocument]:
    index_payload = _read_json(index_path)
    prompt_payload = _read_json(prompts_path)
    prompts = prompt_payload.get("prompts", {})
    documents: list[CaseDocument] = []

    for case_item in index_payload.get("cases", []):
        case_id = int(case_item["id"])
        prompt = str(prompts.get(str(case_id), ""))
        parts = [
            str(case_item.get("id", "")),
            str(case_item.get("title", "")),
            str(case_item.get("category", "")),
            str(case_item.get("sourceLabel", "")),
            " ".join(case_item.get("styles") or []),
            " ".join(case_item.get("scenes") or []),
            str(case_item.get("promptPreview", "")),
            prompt,
        ]
        search_text = "\n".join(part for part in parts if part.strip())
        documents.append(
            CaseDocument(
                id=case_id,
                category=str(case_item.get("category", "")),
                search_text=search_text,
                fingerprint=_case_fingerprint(case_item, prompt),
            )
        )

    return documents
```

- [ ] **Step 5: 运行测试，确认通过**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web\search-service
python -m pytest tests/test_case_data.py -q
```

Expected: `1 passed`。

- [ ] **Step 6: 提交 Task 1**

```powershell
git -C E:\CodexWork\中转站\custom-image-generator-web add -- search-service/requirements.txt search-service/pytest.ini search-service/app/__init__.py search-service/app/schemas.py search-service/app/case_data.py search-service/tests/test_case_data.py
git -C E:\CodexWork\中转站\custom-image-generator-web commit -m "feat: add case search data loader"
```

## Task 2: 后端向量索引和搜索排序

**Files:**
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\embedding.py`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\search_index.py`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\tests\test_search_index.py`

- [ ] **Step 1: 写失败测试：向量排序、分类过滤、空查询**

`tests/test_search_index.py`:

```python
import numpy as np

from app.schemas import CaseDocument
from app.search_index import CaseSearchIndex


class FakeEmbedder:
    def encode(self, texts: list[str]) -> np.ndarray:
        vectors = []
        for text in texts:
            if "香水" in text or "产品" in text:
                vectors.append([1.0, 0.0, 0.0])
            elif "头像" in text:
                vectors.append([0.0, 1.0, 0.0])
            else:
                vectors.append([0.0, 0.0, 1.0])
        return np.asarray(vectors, dtype=np.float32)


def make_index() -> CaseSearchIndex:
    documents = [
        CaseDocument(id=1, category="Products & E-commerce", search_text="香水 产品 海报", fingerprint="a"),
        CaseDocument(id=2, category="Characters & People", search_text="女性 头像 写真", fingerprint="b"),
        CaseDocument(id=3, category="Products & E-commerce", search_text="鞋子 电商 白底图", fingerprint="c"),
    ]
    return CaseSearchIndex(documents=documents, embedder=FakeEmbedder())


def test_search_ranks_semantic_matches_first() -> None:
    index = make_index()

    results = index.search("高级产品海报", category="全部", top_k=2)

    assert [item.id for item in results] == [1, 3]
    assert results[0].score >= results[1].score


def test_search_filters_category_before_ranking() -> None:
    index = make_index()

    results = index.search("产品头像", category="Characters & People", top_k=5)

    assert [item.id for item in results] == [2]


def test_search_empty_query_returns_empty_list() -> None:
    index = make_index()

    assert index.search("   ", category="全部", top_k=5) == []
```

- [ ] **Step 2: 运行测试，确认先失败**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web\search-service
python -m pytest tests/test_search_index.py -q
```

Expected: FAIL，错误包含 `No module named 'app.search_index'`。

- [ ] **Step 3: 写 embedding 包装和搜索索引**

`app/embedding.py`:

```python
from __future__ import annotations

import numpy as np
from sentence_transformers import SentenceTransformer


def normalize_vectors(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vectors / norms


class BgeEmbedder:
    def __init__(self, model_path: str) -> None:
        self.model_path = model_path
        self.model = SentenceTransformer(model_path)

    def encode(self, texts: list[str]) -> np.ndarray:
        vectors = self.model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return np.asarray(vectors, dtype=np.float32)
```

`app/search_index.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

from app.embedding import normalize_vectors
from app.schemas import CaseDocument, SearchResult


class Embedder(Protocol):
    def encode(self, texts: list[str]) -> np.ndarray:
        ...


@dataclass
class CaseSearchIndex:
    documents: list[CaseDocument]
    embedder: Embedder

    def __post_init__(self) -> None:
        if self.documents:
            vectors = self.embedder.encode([item.search_text for item in self.documents])
            self.case_vectors = normalize_vectors(vectors.astype(np.float32))
        else:
            self.case_vectors = np.empty((0, 0), dtype=np.float32)

    def search(self, query: str, category: str, top_k: int) -> list[SearchResult]:
        normalized_query = query.strip()
        if not normalized_query or not self.documents:
            return []

        query_vector = normalize_vectors(self.embedder.encode([normalized_query]).astype(np.float32))[0]
        category_filter = category.strip()
        candidates = [
            index
            for index, document in enumerate(self.documents)
            if category_filter in {"", "全部"} or document.category == category_filter
        ]
        if not candidates:
            return []

        scores = self.case_vectors[candidates] @ query_vector
        ranked = sorted(zip(candidates, scores.tolist()), key=lambda item: item[1], reverse=True)
        return [
            SearchResult(id=self.documents[index].id, score=round(float(score), 6))
            for index, score in ranked[: max(1, min(top_k, 60))]
        ]
```

- [ ] **Step 4: 运行测试，确认通过**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web\search-service
python -m pytest tests/test_search_index.py -q
```

Expected: `3 passed`。

- [ ] **Step 5: 提交 Task 2**

```powershell
git -C E:\CodexWork\中转站\custom-image-generator-web add -- search-service/app/embedding.py search-service/app/search_index.py search-service/tests/test_search_index.py
git -C E:\CodexWork\中转站\custom-image-generator-web commit -m "feat: add semantic case search index"
```

## Task 3: FastAPI 服务接口

**Files:**
- Modify: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\settings.py`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\app\main.py`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\tests\test_api.py`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\search-service\README.md`
- Modify: `E:\CodexWork\中转站\custom-image-generator-web\.gitignore`

- [ ] **Step 1: 写失败测试：health、search、空查询**

`tests/test_api.py`:

```python
import numpy as np
from fastapi.testclient import TestClient

from app.main import create_app
from app.schemas import CaseDocument
from app.search_index import CaseSearchIndex


class FakeEmbedder:
    def encode(self, texts: list[str]) -> np.ndarray:
        return np.asarray([[1.0, 0.0] if "产品" in text else [0.0, 1.0] for text in texts], dtype=np.float32)


def make_client() -> TestClient:
    index = CaseSearchIndex(
        documents=[
            CaseDocument(id=11, category="Products & E-commerce", search_text="产品 海报", fingerprint="a"),
            CaseDocument(id=12, category="Characters & People", search_text="头像 人物", fingerprint="b"),
        ],
        embedder=FakeEmbedder(),
    )
    return TestClient(create_app(search_index=index, model_name="fake-bge"))


def test_health_returns_model_and_case_count() -> None:
    client = make_client()

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "model": "fake-bge", "caseCount": 2}


def test_search_returns_ranked_results() -> None:
    client = make_client()

    response = client.post("/search", json={"query": "产品海报", "category": "全部", "topK": 1})

    assert response.status_code == 200
    assert response.json()["results"] == [{"id": 11, "score": 1.0}]


def test_search_empty_query_returns_empty_results() -> None:
    client = make_client()

    response = client.post("/search", json={"query": " ", "category": "全部", "topK": 5})

    assert response.status_code == 200
    assert response.json() == {"results": []}
```

- [ ] **Step 2: 运行测试，确认先失败**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web\search-service
python -m pytest tests/test_api.py -q
```

Expected: FAIL，错误包含 `No module named 'app.main'`。

- [ ] **Step 3: 写 settings 和 FastAPI app**

`app/settings.py`:

```python
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    bge_model_path: str = "/models/bge-base-zh-v1.5"
    case_index_path: Path = Path("../public/cases-index.json")
    case_prompts_path: Path = Path("../public/case-prompts.json")
    allowed_origins: str = "http://127.0.0.1:5174,https://image.ctikki.com"
    port: int = 8790

    @property
    def origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]
```

`app/main.py`:

```python
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.case_data import load_case_documents
from app.embedding import BgeEmbedder
from app.schemas import SearchRequest, SearchResponse
from app.search_index import CaseSearchIndex
from app.settings import Settings


def create_app(search_index: CaseSearchIndex | None = None, model_name: str | None = None) -> FastAPI:
    settings = Settings()
    app = FastAPI(title="Image Studio Smart Case Search")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    app.state.search_index = search_index
    app.state.model_name = model_name or settings.bge_model_path

    @app.on_event("startup")
    def load_index_on_startup() -> None:
        if app.state.search_index is not None:
            return
        documents = load_case_documents(settings.case_index_path, settings.case_prompts_path)
        embedder = BgeEmbedder(settings.bge_model_path)
        app.state.search_index = CaseSearchIndex(documents=documents, embedder=embedder)
        app.state.model_name = settings.bge_model_path

    @app.get("/health")
    def health() -> dict[str, object]:
        index: CaseSearchIndex = app.state.search_index
        return {"ok": True, "model": app.state.model_name, "caseCount": len(index.documents)}

    @app.post("/search", response_model=SearchResponse)
    def search(request: SearchRequest) -> SearchResponse:
        index: CaseSearchIndex = app.state.search_index
        return SearchResponse(results=index.search(request.query, request.category, request.topK))

    return app


app = create_app()
```

- [ ] **Step 4: 写 README 和 gitignore**

`search-service/README.md`:

````markdown
# 智能案例搜索服务

本服务给 Image Studio 的公共案例库提供语义搜索。它读取前端项目里的 `public/cases-index.json` 和 `public/case-prompts.json`，使用本地 `bge-base-zh-v1.5` 生成向量并返回相似案例 ID。

## 本地启动

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web\search-service
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
$env:BGE_MODEL_PATH="E:\models\bge-base-zh-v1.5"
$env:CASE_INDEX_PATH="E:\CodexWork\中转站\custom-image-generator-web\public\cases-index.json"
$env:CASE_PROMPTS_PATH="E:\CodexWork\中转站\custom-image-generator-web\public\case-prompts.json"
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8790
```

## 搜索

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8790/search -ContentType application/json -Body '{"query":"高级感产品海报","category":"全部","topK":24}'
```
````

`.gitignore` 增加：

```gitignore
# Python search service
search-service/.venv/
search-service/.cache/
search-service/__pycache__/
search-service/**/__pycache__/
search-service/.pytest_cache/
```

- [ ] **Step 5: 运行后端测试，确认通过**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web\search-service
python -m pytest -q
```

Expected: `6 passed`。

- [ ] **Step 6: 提交 Task 3**

```powershell
git -C E:\CodexWork\中转站\custom-image-generator-web add -- .gitignore search-service/app/settings.py search-service/app/main.py search-service/tests/test_api.py search-service/README.md
git -C E:\CodexWork\中转站\custom-image-generator-web commit -m "feat: expose smart case search api"
```

## Task 4: 前端搜索 API client

**Files:**
- Create: `E:\CodexWork\中转站\custom-image-generator-web\src\caseSmartSearch.ts`
- Create: `E:\CodexWork\中转站\custom-image-generator-web\scripts\check-case-smart-search-contract.mjs`
- Modify: `E:\CodexWork\中转站\custom-image-generator-web\package.json`

- [ ] **Step 1: 写失败契约检查**

`scripts/check-case-smart-search-contract.mjs`:

```javascript
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../src/caseSmartSearch.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(client.includes("VITE_CASE_SEARCH_API_URL"), "Smart search client must read VITE_CASE_SEARCH_API_URL.");
assert(client.includes("AbortSignal"), "Smart search client must support request cancellation.");
assert(client.includes("searchSmartCases"), "Smart search client must export searchSmartCases.");
assert(app.includes("smartCaseSearchStatus"), "App must track smart search status.");
assert(app.includes("semantic"), "App must distinguish semantic results from keyword fallback.");
assert(app.includes("keyword"), "App must keep keyword fallback.");
assert(packageJson.includes("test:case-smart-search"), "package.json must expose the smart search contract check.");

console.log("Smart case search contract checks passed.");
```

- [ ] **Step 2: 修改 package 测试脚本**

`package.json` 中把 `test` 改成包含智能搜索检查：

```json
"test": "npm run test:ui-contract && npm run test:generation-submit-lock && npm run test:routing-contract && npm run test:history-storage-contract && npm run test:zip-archive && npm run test:error-copy && npm run test:openai-image-size && npm run test:generation-plan && npm run test:case-library && npm run test:case-library-performance && npm run test:case-smart-search",
"test:case-smart-search": "node scripts/check-case-smart-search-contract.mjs"
```

- [ ] **Step 3: 运行契约检查，确认先失败**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web
npm run test:case-smart-search
```

Expected: FAIL，错误包含 `ENOENT` 或 `Smart search client must read VITE_CASE_SEARCH_API_URL`。

- [ ] **Step 4: 写前端 client**

`src/caseSmartSearch.ts`:

```typescript
export type SmartCaseSearchMode = "semantic" | "keyword";

export interface SmartCaseSearchRequest {
  query: string;
  category: string;
  topK?: number;
  signal?: AbortSignal;
}

export interface SmartCaseSearchResult {
  id: number;
  score: number;
}

export interface SmartCaseSearchResponse {
  results: SmartCaseSearchResult[];
}

const SMART_SEARCH_API_URL = (import.meta.env.VITE_CASE_SEARCH_API_URL ?? "").replace(/\/+$/, "");

export function isSmartCaseSearchConfigured() {
  return SMART_SEARCH_API_URL.length > 0;
}

export async function searchSmartCases({
  query,
  category,
  topK = 24,
  signal
}: SmartCaseSearchRequest): Promise<SmartCaseSearchResponse> {
  if (!isSmartCaseSearchConfigured()) {
    throw new Error("SMART_CASE_SEARCH_NOT_CONFIGURED");
  }

  const response = await fetch(`${SMART_SEARCH_API_URL}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, category, topK }),
    signal
  });

  if (!response.ok) {
    throw new Error("SMART_CASE_SEARCH_FAILED");
  }

  const payload = (await response.json()) as SmartCaseSearchResponse;
  return {
    results: Array.isArray(payload.results)
      ? payload.results
          .map((item) => ({ id: Number(item.id), score: Number(item.score) }))
          .filter((item) => Number.isFinite(item.id) && Number.isFinite(item.score))
      : []
  };
}
```

- [ ] **Step 5: 运行契约检查，确认 client 部分通过**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web
npm run test:case-smart-search
```

Expected: 仍可能 FAIL，因为 `App.tsx` 尚未接入 `smartCaseSearchStatus`；client 相关断言通过。

- [ ] **Step 6: 提交 Task 4**

```powershell
git -C E:\CodexWork\中转站\custom-image-generator-web add -- package.json scripts/check-case-smart-search-contract.mjs src/caseSmartSearch.ts
git -C E:\CodexWork\中转站\custom-image-generator-web commit -m "feat: add smart case search client"
```

## Task 5: 前端接入智能搜索和降级

**Files:**
- Modify: `E:\CodexWork\中转站\custom-image-generator-web\src\App.tsx`
- Modify: `E:\CodexWork\中转站\custom-image-generator-web\src\styles.css`

- [ ] **Step 1: 修改 imports 和状态**

在 `src\App.tsx` 的 imports 增加：

```typescript
import { isSmartCaseSearchConfigured, searchSmartCases, type SmartCaseSearchMode, type SmartCaseSearchResult } from "./caseSmartSearch";
```

在案例库 state 附近增加：

```typescript
const [smartCaseSearchResults, setSmartCaseSearchResults] = useState<SmartCaseSearchResult[]>([]);
const [smartCaseSearchStatus, setSmartCaseSearchStatus] = useState<"idle" | "loading" | "semantic" | "keyword">("idle");
const [smartCaseSearchMode, setSmartCaseSearchMode] = useState<SmartCaseSearchMode>("keyword");
const smartCaseSearchRequestRef = useRef(0);
```

- [ ] **Step 2: 拆出本地关键词过滤**

在 `filteredCaseLibrary` 前增加：

```typescript
const keywordFilteredCaseLibrary = useMemo(() => {
  const query = caseLibraryQuery.trim().toLowerCase();
  return caseLibraryItems.filter((caseItem) => {
    const matchesCategory = selectedCaseCategory === ALL_CASE_CATEGORY || caseItem.category === selectedCaseCategory;
    const haystack =
      `${caseItem.id} ${caseItem.title} ${caseItem.category} ${caseItem.sourceLabel} ${caseItem.tags.join(" ")} ${caseItem.promptPreview}`.toLowerCase();
    return matchesCategory && (!query || haystack.includes(query));
  });
}, [caseLibraryItems, caseLibraryQuery, selectedCaseCategory]);
```

- [ ] **Step 3: 增加语义搜索 effect**

在 `keywordFilteredCaseLibrary` 后增加：

```typescript
useEffect(() => {
  const query = caseLibraryQuery.trim();
  if (!query || !isSmartCaseSearchConfigured()) {
    setSmartCaseSearchResults([]);
    setSmartCaseSearchStatus(query ? "keyword" : "idle");
    setSmartCaseSearchMode("keyword");
    return;
  }

  const requestId = smartCaseSearchRequestRef.current + 1;
  smartCaseSearchRequestRef.current = requestId;
  const controller = new AbortController();
  setSmartCaseSearchStatus("loading");

  const timer = window.setTimeout(() => {
    searchSmartCases({
      query,
      category: selectedCaseCategory,
      topK: 48,
      signal: controller.signal
    })
      .then((payload) => {
        if (smartCaseSearchRequestRef.current !== requestId) {
          return;
        }
        setSmartCaseSearchResults(payload.results);
        setSmartCaseSearchStatus("semantic");
        setSmartCaseSearchMode("semantic");
      })
      .catch(() => {
        if (smartCaseSearchRequestRef.current !== requestId) {
          return;
        }
        setSmartCaseSearchResults([]);
        setSmartCaseSearchStatus("keyword");
        setSmartCaseSearchMode("keyword");
      });
  }, 260);

  return () => {
    window.clearTimeout(timer);
    controller.abort();
  };
}, [caseLibraryQuery, selectedCaseCategory]);
```

- [ ] **Step 4: 改 `filteredCaseLibrary` 为语义优先、关键词兜底**

替换原 `filteredCaseLibrary`：

```typescript
const filteredCaseLibrary = useMemo(() => {
  if (smartCaseSearchMode !== "semantic" || smartCaseSearchResults.length === 0) {
    return keywordFilteredCaseLibrary;
  }

  const caseById = new Map(caseLibraryItems.map((caseItem) => [caseItem.id, caseItem]));
  return smartCaseSearchResults
    .map((result) => caseById.get(result.id))
    .filter((caseItem): caseItem is CaseLibraryItem => Boolean(caseItem));
}, [caseLibraryItems, keywordFilteredCaseLibrary, smartCaseSearchMode, smartCaseSearchResults]);
```

- [ ] **Step 5: 搜索框旁增加状态 badge**

在 `.case-library-toolbar` 里的 `case-count` 前后加入轻量状态。建议放在搜索框和数量之间：

```tsx
<span className={`case-search-mode is-${smartCaseSearchStatus}`}>
  {smartCaseSearchStatus === "loading"
    ? "智能搜索中"
    : smartCaseSearchStatus === "semantic"
      ? "语义匹配"
      : "关键词搜索"}
</span>
```

- [ ] **Step 6: 增加样式**

`src/styles.css` 在 `.case-count` 前增加：

```css
.case-search-mode {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 760;
  padding: 5px 9px;
  white-space: nowrap;
}

.case-search-mode.is-loading {
  color: var(--accent);
  background: var(--accent-soft);
}

.case-search-mode.is-semantic {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
```

- [ ] **Step 7: 运行前端智能搜索契约检查**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web
npm run test:case-smart-search
```

Expected: `Smart case search contract checks passed.`

- [ ] **Step 8: 提交 Task 5**

```powershell
git -C E:\CodexWork\中转站\custom-image-generator-web add -- src/App.tsx src/styles.css
git -C E:\CodexWork\中转站\custom-image-generator-web commit -m "feat: connect smart search to case library"
```

## Task 6: 全量验证和本地运行

**Files:**
- Modify only if verification exposes a concrete defect in files already changed by Tasks 1-5.

- [ ] **Step 1: 运行后端测试**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web\search-service
python -m pytest -q
```

Expected: all backend tests pass。

- [ ] **Step 2: 运行前端测试**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web
npm run test
```

Expected: all existing contract/performance tests pass。

- [ ] **Step 3: 构建前端**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web
npm run build
```

Expected: Vite build and server TypeScript build pass。

- [ ] **Step 4: 本地启动搜索服务**

Run after the model exists locally:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web\search-service
$env:BGE_MODEL_PATH="E:\models\bge-base-zh-v1.5"
$env:CASE_INDEX_PATH="E:\CodexWork\中转站\custom-image-generator-web\public\cases-index.json"
$env:CASE_PROMPTS_PATH="E:\CodexWork\中转站\custom-image-generator-web\public\case-prompts.json"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8790
```

Expected: service starts and `/health` returns `ok: true`。

- [ ] **Step 5: 本地启动前端并验证降级**

Run:

```powershell
cd E:\CodexWork\中转站\custom-image-generator-web
$env:VITE_CASE_SEARCH_API_URL="http://127.0.0.1:8790"
npm run dev:web
```

Expected:

- 搜索服务在线时，案例库搜索显示“语义匹配”。
- 停掉搜索服务后，同一个搜索框自动显示“关键词搜索”并继续出结果。
- 复制 prompt 和套用到工作台可用。

- [ ] **Step 6: 最终状态检查**

Run:

```powershell
git -C E:\CodexWork\中转站\custom-image-generator-web status --short
```

Expected: 只剩用户原本未提交的无关改动，或没有未提交改动。不要回滚用户已有改动。
