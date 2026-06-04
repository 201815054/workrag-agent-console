# WorkRAG Agent Console

위시켓 포트폴리오용 `RAG 문서검색 챗봇 + 업무 자동화 Agent + 관리자 대시보드` MVP입니다.

브라우저에서 바로 동작하는 프론트엔드와 FastAPI + SQLite 백엔드를 함께 제공합니다. 배포 환경에서는 FastAPI가 프론트엔드 정적 파일까지 함께 제공합니다.

## 실행

### 1. 백엔드 실행

```bash
./run_backend.sh
```

백엔드는 `http://127.0.0.1:8000`에서 실행됩니다. 이 주소로 접속하면 앱 화면도 함께 열립니다.

OpenAI API를 연결하려면 백엔드 실행 전에 환경변수를 설정합니다.

```bash
export OPENAI_API_KEY="your_api_key"
export OPENAI_MODEL="gpt-4o-mini"
./run_backend.sh
```

API 키가 있으면 화면 상단에 `Server + AI`가 표시되고, `/api/chat`은 검색된 문서 청크를 OpenAI Responses API에 전달해 답변을 생성합니다. API 키가 없으면 `Server mode`로 표시되며 서버 기반 키워드 검색/템플릿 답변으로 동작합니다.

### 2. 프론트엔드만 따로 실행

정적 프론트만 따로 확인하려면 다른 터미널에서:

```bash
python3 -m http.server 4173
```

브라우저에서 `http://127.0.0.1:4173`을 엽니다.

백엔드가 켜져 있으면 화면 상단에 `Server mode` 또는 `Server + AI`가 표시되고, 문서/로그가 SQLite에 저장됩니다. 백엔드가 꺼져 있으면 기존처럼 `Local mode`로 동작합니다.

## 배포

Render 배포 설정을 포함했습니다.

```txt
render.yaml
```

Render에 GitHub 저장소를 연결하면 FastAPI 서버가 프론트엔드와 `/api/*`를 함께 제공합니다. 자세한 절차는 `DEPLOYMENT.md`를 참고하세요.

## 포함 기능

- 문서 업로드 및 색인
- TXT, CSV, MD, JSON, HTML 원문 추출
- PDF best-effort 텍스트 추출
- XLSX, XLS, DOCX 업로드 메타데이터 처리
- 청크 기반 검색
- 출처와 신뢰도 점수를 포함한 RAG 스타일 답변
- 문서 요약, 메일 초안, 액션 아이템 추출, 외부 API 실행 계획 Agent
- 문서/질문/Agent 실행 로그 관리자 대시보드
- 로그 JSON 내보내기
- LocalStorage 기반 상태 저장
- FastAPI API 서버
- SQLite 문서/청크/로그 저장
- 서버 기반 문서 삭제 및 전체 초기화
- 선택형 OpenAI Responses API 연동

## 포트폴리오 이미지

위시켓 업로드용 이미지는 `portfolio-assets/`에 생성합니다.

```bash
python3 scripts/generate_portfolio_images.py
```

- `portfolio-assets/cover-480.png`: 표지 이미지, 480x480px
- `portfolio-assets/01-rag-chat.png`: 문서 검색 챗봇 상세 이미지
- `portfolio-assets/02-agent-workflow.png`: 업무 자동화 Agent 상세 이미지
- `portfolio-assets/03-admin-dashboard.png`: 관리자 대시보드 상세 이미지

## 실제 납품형 확장안

- Frontend: Next.js
- Backend: FastAPI
- DB: PostgreSQL + pgvector
- Document Pipeline: PDF.js, Tika, LibreOffice, OCR, openpyxl, python-docx
- RAG: hybrid search, reranker, citation verifier
- Agent: LangGraph
- API Integration: Slack, Gmail, Google Sheets, Notion
- Admin: 권한 관리, 실패 답변 검수, 지식베이스 버전 관리
