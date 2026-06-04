from __future__ import annotations

import json
import os
import re
import sqlite3
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "workrag.sqlite3"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

STOPWORDS = {
    "그리고",
    "또는",
    "에서",
    "으로",
    "에게",
    "하는",
    "한다",
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "있다",
    "해야",
    "대한",
    "문서",
    "업무",
}

WORKFLOW_TITLES = {
    "summary": "문서 요약",
    "email": "메일 답변 초안",
    "tasks": "액션 아이템 추출",
    "api": "외부 API 실행 계획",
}


class ManualDocument(BaseModel):
    name: str
    text: str
    type: str = "manual/text"


class ChatRequest(BaseModel):
    question: str


class AgentRequest(BaseModel):
    workflow: str = "summary"
    command: str


app = FastAPI(title="WorkRAG Agent API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/portfolio-assets", StaticFiles(directory=ROOT_DIR / "portfolio-assets"), name="portfolio-assets")


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "workrag-api",
        "ai_enabled": bool(os.getenv("OPENAI_API_KEY")),
        "model": OPENAI_MODEL if os.getenv("OPENAI_API_KEY") else None,
    }


@app.get("/api/state")
def get_state() -> dict[str, Any]:
    with db() as conn:
        documents = [
            serialize_document(row, chunk_count=get_chunk_count(conn, row["id"]))
            for row in conn.execute("select * from documents order by uploaded_at desc")
        ]
        query_logs = [
            dict(row)
            for row in conn.execute("select * from query_logs order by created_at desc limit 50")
        ]
        automation_logs = [
            dict(row)
            for row in conn.execute("select * from automation_logs order by created_at desc limit 50")
        ]
        chunks = [
            dict(row)
            for row in conn.execute(
                "select id, document_id, doc_name, chunk_index, text from chunks order by created_at desc"
            )
        ]

    return {
        "documents": documents,
        "queryLogs": query_logs,
        "automationLogs": automation_logs,
        "keywords": top_keywords(" ".join(chunk["text"] for chunk in chunks), 18),
        "metrics": build_metrics(documents, query_logs),
    }


@app.post("/api/documents/manual")
def create_manual_document(payload: ManualDocument) -> dict[str, Any]:
    text = normalize_whitespace(payload.text)
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    document = save_document(payload.name.strip() or "직접 입력 문서", payload.type, text.encode("utf-8"), text)
    return {"document": document}


@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...)) -> dict[str, Any]:
    content = await file.read()
    text = extract_file_text(file.filename or "uploaded-file", content)
    document = save_document(file.filename or "uploaded-file", file.content_type or infer_type(file.filename), content, text)
    return {"document": document}


@app.delete("/api/documents/{document_id}")
def delete_document(document_id: str) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("select storage_path from documents where id = ?", (document_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="document not found")
        conn.execute("delete from chunks where document_id = ?", (document_id,))
        conn.execute("delete from documents where id = ?", (document_id,))
        conn.commit()

    storage_path = Path(row["storage_path"])
    if storage_path.exists() and storage_path.is_file():
        storage_path.unlink()
    return {"ok": True}


@app.post("/api/chat")
def chat(payload: ChatRequest) -> dict[str, Any]:
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    with db() as conn:
        doc_count = conn.execute("select count(*) as count from documents").fetchone()["count"]
        results = search_chunks(conn, question, 4)
        answer = compose_answer(question, results, doc_count)
        log_id = str(uuid.uuid4())
        conn.execute(
            """
            insert into query_logs (id, question, confidence, hit_count, created_at)
            values (?, ?, ?, ?, ?)
            """,
            (log_id, question, answer["confidence"], len(results), now_iso()),
        )
        conn.commit()

    return {
        "question": question,
        "answer": answer["content"],
        "confidence": answer["confidence"],
        "citations": answer["citations"],
        "aiUsed": answer.get("ai_used", False),
        "mode": answer.get("mode", "keyword-fallback"),
    }


@app.post("/api/agent/run")
def run_agent(payload: AgentRequest) -> dict[str, Any]:
    command = payload.command.strip()
    if not command:
        raise HTTPException(status_code=400, detail="command is required")
    workflow = payload.workflow if payload.workflow in WORKFLOW_TITLES else "summary"

    with db() as conn:
        chunks = search_chunks(conn, command, 6)
        if not chunks:
            chunks = [
                dict(row)
                for row in conn.execute(
                    "select * from chunks order by created_at desc limit 6"
                )
            ]
        output = build_agent_output(workflow, command, chunks)
        conn.execute(
            """
            insert into automation_logs (id, workflow, command, output, created_at)
            values (?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), WORKFLOW_TITLES[workflow], command, output, now_iso()),
        )
        conn.commit()

    return {"workflow": workflow, "output": output}


@app.delete("/api/reset")
def reset() -> dict[str, Any]:
    with db() as conn:
        conn.execute("delete from automation_logs")
        conn.execute("delete from query_logs")
        conn.execute("delete from chunks")
        conn.execute("delete from documents")
        conn.commit()
    for file_path in UPLOAD_DIR.glob("*"):
        if file_path.is_file():
            file_path.unlink()
    return {"ok": True}


@app.get("/")
def serve_index() -> FileResponse:
    return FileResponse(ROOT_DIR / "index.html")


@app.get("/app.js")
def serve_app_js() -> FileResponse:
    return FileResponse(ROOT_DIR / "app.js")


@app.get("/styles.css")
def serve_styles() -> FileResponse:
    return FileResponse(ROOT_DIR / "styles.css")


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            create table if not exists documents (
                id text primary key,
                name text not null,
                type text not null,
                size integer not null,
                text text not null,
                storage_path text not null,
                uploaded_at text not null
            );

            create table if not exists chunks (
                id text primary key,
                document_id text not null,
                doc_name text not null,
                chunk_index integer not null,
                text text not null,
                tokens text not null,
                created_at text not null,
                foreign key(document_id) references documents(id)
            );

            create table if not exists query_logs (
                id text primary key,
                question text not null,
                confidence integer not null,
                hit_count integer not null,
                created_at text not null
            );

            create table if not exists automation_logs (
                id text primary key,
                workflow text not null,
                command text not null,
                output text not null,
                created_at text not null
            );
            """
        )
        conn.commit()


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def save_document(name: str, doc_type: str, content: bytes, text: str) -> dict[str, Any]:
    doc_id = str(uuid.uuid4())
    clean_text = normalize_whitespace(text)
    if not clean_text:
        clean_text = f"{name}\n\n본문 텍스트를 추출하지 못했습니다. 실제 납품형에서는 OCR/문서 파서를 연결합니다."
    storage_path = UPLOAD_DIR / f"{doc_id}-{safe_filename(name)}"
    storage_path.write_bytes(content)
    chunks = chunk_document(doc_id, name, clean_text)

    with db() as conn:
        conn.execute(
            """
            insert into documents (id, name, type, size, text, storage_path, uploaded_at)
            values (?, ?, ?, ?, ?, ?, ?)
            """,
            (doc_id, name, doc_type or "application/octet-stream", len(content), clean_text, str(storage_path), now_iso()),
        )
        conn.executemany(
            """
            insert into chunks (id, document_id, doc_name, chunk_index, text, tokens, created_at)
            values (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    chunk["id"],
                    doc_id,
                    name,
                    chunk["chunk_index"],
                    chunk["text"],
                    json.dumps(chunk["tokens"], ensure_ascii=False),
                    now_iso(),
                )
                for chunk in chunks
            ],
        )
        conn.commit()
        row = conn.execute("select * from documents where id = ?", (doc_id,)).fetchone()
        return serialize_document(row, len(chunks))


def extract_file_text(filename: str, content: bytes) -> str:
    lower = filename.lower()
    if lower.endswith((".txt", ".md", ".csv", ".json", ".html")):
        return decode_text(content)
    if lower.endswith(".pdf"):
        raw = content.decode("latin1", errors="ignore")
        extracted = extract_pdf_text(raw)
        return extracted or (
            f"PDF 파일명: {filename}\n크기: {len(content)} bytes\n"
            "텍스트 레이어를 찾지 못했습니다. 실제 구축 시 PDF.js 또는 OCR 파이프라인으로 원문을 추출합니다."
        )
    if lower.endswith((".xlsx", ".xls", ".docx", ".hwp")):
        return (
            f"{filename}\n\n"
            "이 파일은 서버에 저장되었고 메타데이터가 색인되었습니다. 현재 MVP는 텍스트 계열 파일과 PDF best-effort 추출을 지원합니다.\n\n"
            "실제 납품형에서는 LibreOffice, Apache Tika, openpyxl, python-docx, OCR을 연결해 본문을 추출합니다."
        )
    return decode_text(content)


def decode_text(content: bytes) -> str:
    for encoding in ("utf-8", "cp949", "latin1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def extract_pdf_text(raw: str) -> str:
    matches = re.findall(r"\(([^()]{3,})\)\s*Tj", raw)
    array_matches = []
    for match in re.findall(r"\[((?:\([^()]*\)\s*){2,})\]\s*TJ", raw):
        array_matches.append("".join(re.findall(r"\(([^()]*)\)", match)))
    text = " ".join(matches + array_matches)
    return normalize_whitespace(re.sub(r"\\([nrtbf()\\])", r"\1", text))


def chunk_document(doc_id: str, doc_name: str, text: str) -> list[dict[str, Any]]:
    paragraphs = [part.strip() for part in re.split(r"\n{2,}", text) if part.strip()] or [text]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if len(current + "\n\n" + paragraph) > 760 and current:
            chunks.append(current)
            current = paragraph
        else:
            current = f"{current}\n\n{paragraph}".strip() if current else paragraph
    if current:
        chunks.append(current)

    return [
        {
            "id": f"{doc_id}-{index}",
            "chunk_index": index + 1,
            "doc_name": doc_name,
            "text": chunk,
            "tokens": tokenize(chunk),
        }
        for index, chunk in enumerate(chunks)
    ]


def search_chunks(conn: sqlite3.Connection, query: str, limit: int) -> list[dict[str, Any]]:
    query_tokens = tokenize(query)
    if not query_tokens:
        return []

    scored = []
    for row in conn.execute("select * from chunks"):
        chunk = dict(row)
        tokens = json.loads(chunk["tokens"])
        token_counts = count_tokens(tokens)
        score = 0.0
        for token in query_tokens:
            if token_counts.get(token):
                score += token_counts[token] * 2.4
            if token in chunk["doc_name"].lower():
                score += 1.3
            if token in chunk["text"].lower():
                score += 0.8
        phrase = query.lower().strip()
        if len(phrase) > 3 and phrase in chunk["text"].lower():
            score += 6
        coverage = len([token for token in query_tokens if token_counts.get(token)]) / len(query_tokens)
        score += coverage * 5
        if score > 0:
            chunk["score"] = score
            chunk["coverage"] = coverage
            scored.append(chunk)
    return sorted(scored, key=lambda item: item["score"], reverse=True)[:limit]


def compose_answer(question: str, results: list[dict[str, Any]], doc_count: int) -> dict[str, Any]:
    if doc_count == 0:
        return {"content": "아직 색인된 문서가 없습니다. 먼저 문서를 업로드하세요.", "confidence": 0, "citations": []}
    if not results or results[0]["score"] < 2:
        return {
            "content": "색인된 문서 안에서 답변 근거를 찾지 못했습니다. 질문을 더 구체화하거나 관련 문서를 추가해야 합니다.",
            "confidence": 18,
            "citations": [],
            "ai_used": False,
            "mode": "no-evidence",
        }

    citations = [
        {
            "docName": result["doc_name"],
            "chunk": result["chunk_index"],
            "score": result["score"],
            "preview": result["text"][:180],
        }
        for result in results[:3]
    ]
    ai_answer = compose_openai_answer(question, results[:4], citations)
    if ai_answer:
        confidence = min(96, round(42 + results[0]["score"] * 7 + results[0].get("coverage", 0) * 30))
        return {
            "content": ai_answer,
            "confidence": confidence,
            "citations": citations,
            "ai_used": True,
            "mode": "openai-rag",
        }

    query_tokens = tokenize(question)
    evidence: list[str] = []
    for result in results[:3]:
        evidence.extend(best_sentences(result["text"], query_tokens, 2))
    unique_evidence = list(dict.fromkeys(evidence))[:5]
    confidence = min(96, round(42 + results[0]["score"] * 7 + results[0].get("coverage", 0) * 30))
    content = "\n".join(
        [
            f"문서 기준으로 보면 {'다음 내용이 핵심입니다.' if unique_evidence else '관련 근거가 일부 확인됩니다.'}",
            *[f"- {sentence}" for sentence in unique_evidence],
            "실무 적용 시에는 답변 하단 출처를 확인한 뒤 고객 응대나 내부 처리에 반영하세요.",
        ]
    )
    return {
        "content": content,
        "confidence": confidence,
        "citations": citations,
        "ai_used": False,
        "mode": "keyword-fallback",
    }


def compose_openai_answer(question: str, results: list[dict[str, Any]], citations: list[dict[str, Any]]) -> str | None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    context = "\n\n".join(
        f"[source:{index + 1}] {result['doc_name']} chunk {result['chunk_index']}\n{result['text']}"
        for index, result in enumerate(results)
    )
    citation_names = ", ".join(
        f"{item['docName']} chunk {item['chunk']}" for item in citations
    )
    prompt = f"""질문:
{question}

검색된 문서 근거:
{context}

사용 가능한 출처:
{citation_names}

답변 조건:
- 반드시 검색된 문서 근거만 사용하세요.
- 근거가 부족하면 부족하다고 말하세요.
- 한국어로 답하세요.
- 핵심 답변을 먼저 쓰고, 필요한 경우 bullet로 정리하세요.
- 마지막 줄에 "근거: ..." 형식으로 사용한 문서명을 적으세요."""

    payload = {
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "developer",
                "content": "You are a RAG assistant for internal company documents. Answer only from provided context.",
            },
            {"role": "user", "content": prompt},
        ],
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
        return None

    if data.get("output_text"):
        return data["output_text"].strip()

    parts: list[str] = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                parts.append(content["text"])
    return "\n".join(parts).strip() or None


def build_agent_output(workflow: str, command: str, chunks: list[dict[str, Any]]) -> str:
    if not chunks:
        return "문서가 없습니다. Agent가 근거 문서를 검색할 수 있도록 먼저 문서를 색인하세요."

    context = "\n\n".join(chunk["text"] for chunk in chunks)
    bullets = summarize_text(context, 6)
    sources = "\n".join(f"- {chunk['doc_name']} #{chunk['chunk_index']}" for chunk in chunks[:4])

    if workflow == "email":
        return f"""Workflow: 메일 답변 초안
Request: {command}

Subject: 문의하신 내용 처리 기준 안내드립니다

안녕하세요. 문의 주신 건은 내부 운영 기준에 따라 아래 순서로 확인하겠습니다.

{chr(10).join(f"- {line}" for line in bullets[:4])}

필요한 추가 정보가 있으면 주문번호, 증빙 이미지, 접수 일시를 함께 전달해 주세요. 담당자가 기준에 맞춰 처리 가능 여부와 예상 소요 시간을 안내드리겠습니다.

Approval Gate:
- 담당자 검토 후 발송
- 민감 정보 포함 여부 확인
- SLA 초과 가능 시 리더 알림

Sources:
{sources}"""

    if workflow == "tasks":
        tasks = "\n".join(
            f"{index + 1}. {line}\n   Owner: 담당자 지정 필요\n   Due: 영업일 기준 검토"
            for index, line in enumerate(bullets[:5])
        )
        return f"""Workflow: 액션 아이템 추출
Request: {command}

Tasks:
{tasks}

Tool Plan:
- Notion: 태스크 데이터베이스에 액션 아이템 생성
- Slack: 담당 채널에 요약 알림 전송
- Admin Log: 실행 결과와 출처 저장

Sources:
{sources}"""

    if workflow == "api":
        payload = {
            "slack_channel": "#ops-alert",
            "event_type": "rag_agent_result",
            "message": " / ".join(bullets[:3]),
            "sources": [chunk["doc_name"] for chunk in chunks[:3]],
        }
        return f"""Workflow: 외부 API 실행 계획
Request: {command}

Decision:
- 입력을 분석해 Slack, Google Sheets, Notion, Gmail 중 필요한 도구를 선택합니다.
- 문서 검색 결과를 근거로 실행 payload를 생성합니다.
- 발송/등록 전 승인 게이트를 둡니다.

Payload Preview:
{json.dumps(payload, ensure_ascii=False, indent=2)}

Audit:
- 상태: simulated
- 재시도: disabled
- 실패 시 관리자 검토 항목 등록

Sources:
{sources}"""

    return f"""Workflow: 문서 요약
Request: {command}

Executive Summary:
{chr(10).join(f"- {line}" for line in bullets)}

Recommended Next Steps:
1. 반복 문의와 SLA 초과 위험 항목을 관리자 대시보드에서 모니터링합니다.
2. 고객 발송 문안은 Agent가 초안을 만들고 담당자가 최종 승인합니다.
3. 운영 데이터는 Sheets 또는 BI 대시보드로 동기화합니다.

Sources:
{sources}"""


def summarize_text(text: str, limit: int) -> list[str]:
    sentences = [sentence.strip() for sentence in split_sentences(text) if len(sentence.strip()) > 16]
    freq = count_tokens(tokenize(text))
    scored = [
        {
            "sentence": re.sub(r"^[*-]\s*", "", sentence),
            "score": sum(freq.get(token, 0) for token in tokenize(sentence)),
        }
        for sentence in sentences
    ]
    return [item["sentence"] for item in sorted(scored, key=lambda item: item["score"], reverse=True)[:limit]]


def best_sentences(text: str, query_tokens: list[str], limit: int) -> list[str]:
    scored = []
    for sentence in split_sentences(text):
        sentence = sentence.strip()
        if len(sentence) <= 12:
            continue
        lower = sentence.lower()
        score = sum(1 for token in query_tokens if token in lower)
        if score:
            scored.append({"sentence": sentence, "score": score})
    return [item["sentence"] for item in sorted(scored, key=lambda item: item["score"], reverse=True)[:limit]]


def split_sentences(text: str) -> list[str]:
    return re.split(r"(?<=[.!?。！？다])\s+|\n+", text)


def tokenize(text: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[\w가-힣]+", text.lower())
        if len(token) > 1 and token not in STOPWORDS
    ]


def count_tokens(tokens: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for token in tokens:
        counts[token] = counts.get(token, 0) + 1
    return counts


def top_keywords(text: str, limit: int) -> list[dict[str, Any]]:
    counts = count_tokens(tokenize(text))
    return [
        {"keyword": keyword, "count": count}
        for keyword, count in sorted(counts.items(), key=lambda item: item[1], reverse=True)[:limit]
    ]


def build_metrics(documents: list[dict[str, Any]], query_logs: list[dict[str, Any]]) -> dict[str, Any]:
    avg_confidence = 0
    if query_logs:
        avg_confidence = round(sum(log["confidence"] for log in query_logs) / len(query_logs))
    return {
        "documents": len(documents),
        "chunks": sum(doc["chunks"] for doc in documents),
        "questions": len(query_logs),
        "avgConfidence": avg_confidence,
    }


def serialize_document(row: sqlite3.Row, chunk_count: int) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "type": row["type"],
        "size": row["size"],
        "uploadedAt": row["uploaded_at"],
        "chunks": chunk_count,
    }


def get_chunk_count(conn: sqlite3.Connection, document_id: str) -> int:
    return conn.execute("select count(*) as count from chunks where document_id = ?", (document_id,)).fetchone()["count"]


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", text.replace("\r", ""))).strip()


def safe_filename(name: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9가-힣._-]+", "_", name).strip("._")
    return safe or "document.txt"


def infer_type(filename: str | None) -> str:
    if not filename or "." not in filename:
        return "application/octet-stream"
    return f"application/{filename.rsplit('.', 1)[-1].lower()}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
