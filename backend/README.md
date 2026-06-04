# WorkRAG FastAPI Backend

문서 저장, SQLite 색인, 키워드 검색, 질문 로그, Agent 실행 로그를 담당하는 MVP 백엔드입니다.

## 실행

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

OpenAI 답변 생성을 켜려면 실행 전에:

```bash
export OPENAI_API_KEY="your_api_key"
export OPENAI_MODEL="gpt-4o-mini"
uvicorn main:app --reload --port 8000
```

`OPENAI_API_KEY`가 없으면 서버 기반 키워드 검색 fallback으로 동작합니다.

## API

- `GET /api/health`
- `GET /api/state`
- `POST /api/documents/manual`
- `POST /api/documents/upload`
- `DELETE /api/documents/{document_id}`
- `POST /api/chat`
- `POST /api/agent/run`
- `DELETE /api/reset`

데이터는 `backend/data/workrag.sqlite3`에 저장됩니다.
