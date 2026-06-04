const STORAGE_KEY = "workrag-agent-state-v1";
const AUTH_KEY = "workrag-agent-auth-v1";
const API_BASE =
  window.WORKRAG_API_BASE ||
  (["localhost", "127.0.0.1", ""].includes(window.location.hostname)
    ? "http://127.0.0.1:8000/api"
    : "/api");

const demoDocuments = [
  {
    name: "고객 상담 운영 매뉴얼.md",
    type: "text/markdown",
    text: `고객 상담 운영 매뉴얼

환불 문의는 주문번호, 결제일, 상품 수령 여부를 먼저 확인한다. 단순 변심 환불은 수령 후 7일 이내 접수 건만 가능하며 왕복 배송비는 고객 부담이다.

제품 하자 또는 오배송은 사진 증빙을 받은 뒤 상담원이 교환 또는 환불을 선택하도록 안내한다. 하자 접수는 영업일 기준 1일 이내 1차 답변을 완료해야 한다.

상담 SLA는 일반 문의 24시간 이내, 결제 오류 4시간 이내, 배송 사고 8시간 이내다. SLA 초과 가능성이 있으면 팀 리더에게 자동 알림을 남긴다.

반복 문의는 FAQ 후보로 등록하고 매주 금요일 운영 회의에서 검토한다.`,
  },
  {
    name: "월간 매출 리포트.csv",
    type: "text/csv",
    text: `월,채널,매출,문의수,전환율
2026-01,자사몰,43800000,1280,3.8
2026-02,자사몰,47200000,1325,4.1
2026-03,오픈마켓,39100000,980,3.2
2026-04,자사몰,52900000,1510,4.5
2026-05,오픈마켓,44700000,1120,3.6

요약: 4월 자사몰 매출이 가장 높았고 문의수도 증가했다. 전환율 개선 원인은 재구매 쿠폰 캠페인과 상담 응답 속도 개선으로 추정된다.`,
  },
  {
    name: "업무 자동화 연동 명세.txt",
    type: "text/plain",
    text: `업무 자동화 연동 명세

Slack 연동은 SLA 초과 위험, 신규 대량 문의, 일일 매출 요약 이벤트를 채널에 전송한다. Google Sheets 연동은 상담 로그와 매출 데이터를 행 단위로 추가한다.

Notion 연동은 회의록에서 담당자, 마감일, 액션 아이템을 추출해 태스크 데이터베이스에 생성한다. Gmail 연동은 고객 답변 초안을 생성하되 발송은 담당자 승인 후 처리한다.

Agent 워크플로우는 입력 분석, 문서 검색, 도구 선택, 결과 검증, 실행 로그 저장 순서로 동작한다. 실패 시에는 재시도하지 않고 관리자에게 검토 항목으로 남긴다.`,
  },
];

const workflows = [
  {
    id: "summary",
    title: "문서 요약",
    description: "업로드된 문서를 핵심 정책, 수치, 실행 항목으로 압축합니다.",
  },
  {
    id: "email",
    title: "메일 답변 초안",
    description: "상담 문서와 규정을 근거로 고객 응대 메일을 작성합니다.",
  },
  {
    id: "tasks",
    title: "액션 아이템 추출",
    description: "회의록이나 명세에서 담당 업무, 마감, 알림 대상을 뽑습니다.",
  },
  {
    id: "api",
    title: "외부 API 실행 계획",
    description: "Slack, Gmail, Sheets, Notion 연동 순서를 감사 로그와 함께 만듭니다.",
  },
];

const stopwords = new Set([
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
]);

let state = loadState();
let activeWorkflow = "summary";
let latestAgentOutput = "";
let apiOnline = false;
let aiOnline = false;
let currentUser = null;
let activeSessionId = null;

const els = {
  navItems: document.querySelectorAll(".nav-item"),
  views: {
    chat: document.querySelector("#chatView"),
    agent: document.querySelector("#agentView"),
    admin: document.querySelector("#adminView"),
  },
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  manualTitle: document.querySelector("#manualTitle"),
  manualText: document.querySelector("#manualText"),
  addManualBtn: document.querySelector("#addManualBtn"),
  loadDemoBtn: document.querySelector("#loadDemoBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  roleBadge: document.querySelector("#roleBadge"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  logoutBtn: document.querySelector("#logoutBtn"),
  adminDemoBtn: document.querySelector("#adminDemoBtn"),
  userDemoBtn: document.querySelector("#userDemoBtn"),
  demoLoginActions: document.querySelector("#demoLoginActions"),
  currentUserBox: document.querySelector("#currentUserBox"),
  sessionList: document.querySelector("#sessionList"),
  newSessionBtn: document.querySelector("#newSessionBtn"),
  manualVisibility: document.querySelector("#manualVisibility"),
  chatMessages: document.querySelector("#chatMessages"),
  chatForm: document.querySelector("#chatForm"),
  questionInput: document.querySelector("#questionInput"),
  confidenceBadge: document.querySelector("#confidenceBadge"),
  docCountBadge: document.querySelector("#docCountBadge"),
  workflowList: document.querySelector("#workflowList"),
  agentCommand: document.querySelector("#agentCommand"),
  runAgentBtn: document.querySelector("#runAgentBtn"),
  copyAgentBtn: document.querySelector("#copyAgentBtn"),
  agentOutput: document.querySelector("#agentOutput"),
  agentStatus: document.querySelector("#agentStatus"),
  metricGrid: document.querySelector("#metricGrid"),
  documentTable: document.querySelector("#documentTable"),
  queryLog: document.querySelector("#queryLog"),
  keywordCloud: document.querySelector("#keywordCloud"),
  automationLog: document.querySelector("#automationLog"),
  chunkCountBadge: document.querySelector("#chunkCountBadge"),
  exportBtn: document.querySelector("#exportBtn"),
  apiModeBadge: document.querySelector("#apiModeBadge"),
  accessAdminPanel: document.querySelector("#accessAdminPanel"),
  userTable: document.querySelector("#userTable"),
  permissionDocumentSelect: document.querySelector("#permissionDocumentSelect"),
  permissionUserSelect: document.querySelector("#permissionUserSelect"),
  grantAccessBtn: document.querySelector("#grantAccessBtn"),
  emptyTemplate: document.querySelector("#emptyStateTemplate"),
};

boot();

async function boot() {
  bindEvents();
  renderWorkflows();
  apiOnline = await checkApi();
  if (apiOnline) await restoreAuth();
  await syncFromApi();
  ensureWelcomeMessage();
  renderAll();
}

function bindEvents() {
  els.navItems.forEach((item) => {
    item.addEventListener("click", () => switchView(item.dataset.view));
  });

  els.fileInput.addEventListener("change", (event) => {
    ingestFiles([...event.target.files]);
    event.target.value = "";
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragging");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    ingestFiles([...event.dataTransfer.files]);
  });

  els.addManualBtn.addEventListener("click", async () => {
    const title = els.manualTitle.value.trim() || "직접 입력 문서";
    const text = els.manualText.value.trim();
    if (!text) return;
    await addDocument({ name: title, type: "manual/text", text, visibility: els.manualVisibility.value });
    els.manualTitle.value = "";
    els.manualText.value = "";
  });

  els.loadDemoBtn.addEventListener("click", async () => {
    for (const document of demoDocuments) {
      await addDocument(document);
    }
  });

  els.resetBtn.addEventListener("click", async () => {
    const confirmed = window.confirm("문서, 질문 로그, Agent 실행 이력을 모두 삭제할까요?");
    if (!confirmed) return;
    if (apiOnline) {
      if (currentUser?.role !== "admin") {
        window.alert("전체 초기화는 관리자만 사용할 수 있습니다.");
        return;
      }
      await apiFetch("/reset", { method: "DELETE" });
    }
    state = createEmptyState();
    persist();
    await syncFromApi();
    ensureWelcomeMessage();
    renderAll();
  });

  els.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = els.questionInput.value.trim();
    if (!question) return;
    await askQuestion(question);
    els.questionInput.value = "";
  });

  els.runAgentBtn.addEventListener("click", runAgent);
  els.copyAgentBtn.addEventListener("click", copyAgentOutput);
  els.exportBtn.addEventListener("click", exportLogs);
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await login(els.loginEmail.value, els.loginPassword.value);
  });
  els.adminDemoBtn.addEventListener("click", () => login("admin@workrag.demo", "admin1234"));
  els.userDemoBtn.addEventListener("click", () => login("user@workrag.demo", "user1234"));
  els.logoutBtn.addEventListener("click", logout);
  els.newSessionBtn.addEventListener("click", createNewSession);
  els.grantAccessBtn.addEventListener("click", grantDocumentAccess);
}

function switchView(view) {
  els.navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  Object.entries(els.views).forEach(([key, element]) => {
    element.classList.toggle("active-view", key === view);
  });
  if (view === "admin") renderAdmin();
}

async function ingestFiles(files) {
  if (apiOnline && !requireLoggedIn()) return;
  for (const file of files) {
    if (apiOnline) {
      const form = new FormData();
      form.append("file", file);
      await apiFetch("/documents/upload", { method: "POST", body: form });
      await syncFromApi();
      renderAll();
      continue;
    }
    const text = await extractFileText(file);
    addDocument({
      name: file.name,
      type: file.type || inferType(file.name),
      size: file.size,
      text,
    });
  }
}

async function extractFileText(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".pdf")) {
    const buffer = await file.arrayBuffer();
    const raw = new TextDecoder("latin1").decode(buffer);
    const extracted = extractPdfText(raw);
    return (
      extracted ||
      `PDF 파일명: ${file.name}\n크기: ${formatBytes(file.size)}\n브라우저 데모에서 텍스트 레이어를 찾지 못했습니다. 실제 구축 시 PDF.js 또는 서버 OCR 파이프라인으로 원문을 추출합니다.`
    );
  }

  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".docx")) {
    return `${file.name}

이 파일은 업로드 메타데이터로 색인되었습니다. 이 정적 MVP는 TXT/CSV/MD/JSON/HTML 원문 추출과 PDF best-effort 추출을 지원합니다.

실제 납품형 구성에서는 서버에서 LibreOffice, unstructured, Apache Tika, python-docx, openpyxl, OCR을 연결해 DOCX/XLSX/PDF 본문을 추출합니다.`;
  }

  return file.text();
}

function extractPdfText(raw) {
  const matches = [...raw.matchAll(/\(([^()]{3,})\)\s*Tj/g)].map((match) => match[1]);
  const arrayMatches = [...raw.matchAll(/\[((?:\([^()]*\)\s*){2,})\]\s*TJ/g)]
    .map((match) => [...match[1].matchAll(/\(([^()]*)\)/g)].map((part) => part[1]).join(""));
  return [...matches, ...arrayMatches]
    .map((value) => value.replace(/\\([nrtbf()\\])/g, "$1").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function addDocument(input) {
  const cleanText = normalizeWhitespace(input.text || "");
  if (!cleanText) return;

  if (apiOnline) {
    if (!requireLoggedIn()) return;
    await apiFetch("/documents/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        type: input.type || "manual/text",
        text: cleanText,
        visibility: input.visibility || "team",
      }),
    });
    await syncFromApi();
    renderAll();
    return;
  }

  const doc = {
    id: createId(),
    name: input.name,
    type: input.type || "text/plain",
    size: input.size || new Blob([cleanText]).size,
    text: cleanText,
    uploadedAt: new Date().toISOString(),
  };
  doc.chunks = chunkDocument(doc);
  state.documents.unshift(doc);
  persist();
  renderAll();
}

function chunkDocument(doc) {
  const paragraphs = doc.text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs.length ? paragraphs : [doc.text]) {
    if ((current + "\n\n" + paragraph).length > 760 && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);

  return chunks.map((text, index) => ({
    id: `${doc.id}-${index}`,
    docId: doc.id,
    docName: doc.name,
    index: index + 1,
    text,
    tokens: tokenize(text),
  }));
}

async function askQuestion(question) {
  if (apiOnline) {
    if (!requireLoggedIn()) return;
    state.chat.push({ role: "user", content: question, createdAt: new Date().toISOString() });
    try {
      const response = await apiFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, session_id: activeSessionId }),
      });
      activeSessionId = response.sessionId || activeSessionId;
      state.chat.push({
        role: "assistant",
        content: response.answer,
        citations: response.citations,
        confidence: response.confidence,
        mode: response.mode,
        aiUsed: response.aiUsed,
        createdAt: new Date().toISOString(),
      });
      await syncFromApi({ keepChat: true });
    } catch (error) {
      state.chat.push({
        role: "assistant",
        content: `서버 질의 중 오류가 발생했습니다: ${error.message}`,
        citations: [],
        confidence: 0,
        createdAt: new Date().toISOString(),
      });
    }
    renderAll();
    return;
  }

  const results = searchChunks(question, 4);
  const answer = composeAnswer(question, results);

  state.chat.push({ role: "user", content: question, createdAt: new Date().toISOString() });
  state.chat.push({
    role: "assistant",
    content: answer.content,
    citations: answer.citations,
    confidence: answer.confidence,
    createdAt: new Date().toISOString(),
  });
  state.queryLogs.unshift({
    id: createId(),
    question,
    confidence: answer.confidence,
    hitCount: results.length,
    createdAt: new Date().toISOString(),
  });
  persist();
  renderAll();
}

function searchChunks(query, limit = 5) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const chunks = state.documents.flatMap((doc) => doc.chunks || []);
  const scored = chunks.map((chunk) => {
    const tokenCounts = countTokens(chunk.tokens);
    let score = 0;
    for (const token of queryTokens) {
      if (tokenCounts[token]) score += tokenCounts[token] * 2.4;
      if (chunk.docName.toLowerCase().includes(token)) score += 1.3;
      if (chunk.text.toLowerCase().includes(token)) score += 0.8;
    }
    const phrase = query.toLowerCase().trim();
    if (phrase.length > 3 && chunk.text.toLowerCase().includes(phrase)) score += 6;
    const coverage = queryTokens.filter((token) => tokenCounts[token]).length / queryTokens.length;
    score += coverage * 5;
    return { ...chunk, score, coverage };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function composeAnswer(question, results) {
  if (state.documents.length === 0) {
    return {
      content: "아직 색인된 문서가 없습니다. 먼저 문서를 업로드하거나 데모 문서를 불러오세요.",
      citations: [],
      confidence: 0,
    };
  }

  if (results.length === 0 || results[0].score < 2) {
    return {
      content:
        "색인된 문서 안에서 답변 근거를 찾지 못했습니다. 질문을 더 구체화하거나 관련 문서를 추가해야 합니다.",
      citations: [],
      confidence: 18,
    };
  }

  const queryTokens = tokenize(question);
  const evidence = results
    .slice(0, 3)
    .map((result) => bestSentences(result.text, queryTokens, 2))
    .flat()
    .filter(Boolean);

  const uniqueEvidence = [...new Set(evidence)].slice(0, 5);
  const confidence = Math.min(96, Math.round(42 + results[0].score * 7 + results[0].coverage * 30));

  const content = [
    `문서 기준으로 보면 ${uniqueEvidence.length ? "다음 내용이 핵심입니다." : "관련 근거가 일부 확인됩니다."}`,
    ...uniqueEvidence.map((sentence) => `- ${sentence}`),
    "실무 적용 시에는 답변 하단 출처를 확인한 뒤 고객 응대나 내부 처리에 반영하세요.",
  ].join("\n");

  return {
    content,
    confidence,
    citations: results.slice(0, 3).map((result) => ({
      docName: result.docName,
      chunk: result.index,
      score: result.score,
      preview: result.text.slice(0, 180),
    })),
  };
}

function bestSentences(text, queryTokens, limit) {
  return text
    .split(/(?<=[.!?。！？다])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 12)
    .map((sentence) => {
      const lower = sentence.toLowerCase();
      const score = queryTokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
      return { sentence, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.sentence);
}

async function runAgent() {
  const command = els.agentCommand.value.trim() || defaultAgentCommand(activeWorkflow);
  if (apiOnline) {
    if (!requireLoggedIn()) return;
    const response = await apiFetch("/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: activeWorkflow, command }),
    });
    latestAgentOutput = response.output;
    els.agentOutput.textContent = response.output;
    els.agentStatus.textContent = "Done";
    await syncFromApi();
    renderAdmin();
    return;
  }

  const relevant = searchChunks(command, 6);
  const docs = relevant.length ? relevant : state.documents.flatMap((doc) => doc.chunks || []).slice(0, 6);
  const output = buildAgentOutput(activeWorkflow, command, docs);
  latestAgentOutput = output;
  els.agentOutput.textContent = output;
  els.agentStatus.textContent = "Done";

  state.automationLogs.unshift({
    id: createId(),
    workflow: workflows.find((item) => item.id === activeWorkflow)?.title || activeWorkflow,
    command,
    createdAt: new Date().toISOString(),
  });
  persist();
  renderAdmin();
}

function buildAgentOutput(workflow, command, chunks) {
  if (state.documents.length === 0) {
    return "문서가 없습니다. Agent가 근거 문서를 검색할 수 있도록 먼저 문서를 색인하세요.";
  }

  const context = chunks.map((chunk) => chunk.text).join("\n\n");
  const bullets = summarizeText(context, 6);
  const sources = chunks.slice(0, 4).map((chunk) => `- ${chunk.docName} #${chunk.index}`).join("\n");

  if (workflow === "email") {
    return `Workflow: 메일 답변 초안
Request: ${command}

Subject: 문의하신 내용 처리 기준 안내드립니다

안녕하세요. 문의 주신 건은 내부 운영 기준에 따라 아래 순서로 확인하겠습니다.

${bullets.slice(0, 4).map((line) => `- ${line}`).join("\n")}

필요한 추가 정보가 있으면 주문번호, 증빙 이미지, 접수 일시를 함께 전달해 주세요. 담당자가 기준에 맞춰 처리 가능 여부와 예상 소요 시간을 안내드리겠습니다.

Approval Gate:
- 담당자 검토 후 발송
- 민감 정보 포함 여부 확인
- SLA 초과 가능 시 리더 알림

Sources:
${sources}`;
  }

  if (workflow === "tasks") {
    return `Workflow: 액션 아이템 추출
Request: ${command}

Tasks:
${bullets
  .slice(0, 5)
  .map((line, index) => `${index + 1}. ${line}\n   Owner: 담당자 지정 필요\n   Due: 영업일 기준 검토`)
  .join("\n")}

Tool Plan:
- Notion: 태스크 데이터베이스에 액션 아이템 생성
- Slack: 담당 채널에 요약 알림 전송
- Admin Log: 실행 결과와 출처 저장

Sources:
${sources}`;
  }

  if (workflow === "api") {
    return `Workflow: 외부 API 실행 계획
Request: ${command}

Decision:
- 입력을 분석해 Slack, Google Sheets, Notion, Gmail 중 필요한 도구를 선택합니다.
- 문서 검색 결과를 근거로 실행 payload를 생성합니다.
- 발송/등록 전 승인 게이트를 둡니다.

Payload Preview:
{
  "slack_channel": "#ops-alert",
  "event_type": "rag_agent_result",
  "message": ${JSON.stringify(bullets.slice(0, 3).join(" / "))},
  "sources": ${JSON.stringify(chunks.slice(0, 3).map((chunk) => chunk.docName))}
}

Audit:
- 상태: simulated
- 재시도: disabled
- 실패 시 관리자 검토 항목 등록

Sources:
${sources}`;
  }

  return `Workflow: 문서 요약
Request: ${command}

Executive Summary:
${bullets.map((line) => `- ${line}`).join("\n")}

Recommended Next Steps:
1. 반복 문의와 SLA 초과 위험 항목을 관리자 대시보드에서 모니터링합니다.
2. 고객 발송 문안은 Agent가 초안을 만들고 담당자가 최종 승인합니다.
3. 운영 데이터는 Sheets 또는 BI 대시보드로 동기화합니다.

Sources:
${sources}`;
}

function summarizeText(text, limit) {
  const sentences = text
    .split(/(?<=[.!?。！？다])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 16);
  const freq = countTokens(tokenize(text));
  return sentences
    .map((sentence) => ({
      sentence,
      score: tokenize(sentence).reduce((sum, token) => sum + (freq[token] || 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.sentence.replace(/^[*-]\s*/, ""));
}

function copyAgentOutput() {
  if (!latestAgentOutput) return;
  navigator.clipboard?.writeText(latestAgentOutput);
  els.agentStatus.textContent = "Copied";
}

function exportLogs() {
  const payload = {
    exportedAt: new Date().toISOString(),
    documents: state.documents.map(({ id, name, type, size, uploadedAt, chunks }) => ({
      id,
      name,
      type,
      size,
      uploadedAt,
      chunks: Array.isArray(chunks) ? chunks.length : Number(chunks || 0),
    })),
    queryLogs: state.queryLogs,
    automationLogs: state.automationLogs,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `workrag-logs-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderAll() {
  renderAuth();
  renderSessions();
  renderChat();
  renderCounts();
  renderAdmin();
}

function renderChat() {
  els.chatMessages.innerHTML = "";
  for (const message of state.chat) {
    const bubble = document.createElement("article");
    bubble.className = `message ${message.role}`;
    const content = document.createElement("p");
    content.textContent = message.content;
    bubble.append(content);

    if (message.citations?.length) {
      const list = document.createElement("div");
      list.className = "citation-list";
      message.citations.forEach((citation) => {
        const item = document.createElement("div");
        item.className = "citation";
        item.textContent = `${citation.docName} · chunk ${citation.chunk} · score ${citation.score.toFixed(1)} - ${citation.preview}`;
        list.append(item);
      });
      bubble.append(list);
    }

    if (typeof message.confidence === "number") {
      const meta = document.createElement("span");
      meta.className = "meta";
      const mode = message.aiUsed ? "OpenAI RAG" : message.mode || "local";
      meta.textContent = `confidence ${message.confidence}% · ${mode}`;
      bubble.append(meta);
    }

    els.chatMessages.append(bubble);
  }
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  const lastAnswer = [...state.chat].reverse().find((message) => message.role === "assistant" && typeof message.confidence === "number");
  els.confidenceBadge.textContent = lastAnswer ? `${lastAnswer.confidence}% confidence` : "대기중";
  els.confidenceBadge.classList.toggle("muted", !lastAnswer);
}

function renderCounts() {
  const chunkCount = state.documents.reduce((sum, doc) => sum + getChunkCount(doc), 0);
  els.docCountBadge.textContent = `${state.documents.length} docs`;
  els.chunkCountBadge.textContent = `${chunkCount} chunks`;
  els.apiModeBadge.textContent = apiOnline ? (aiOnline ? "Server + AI" : "Server mode") : "Local mode";
  els.apiModeBadge.classList.toggle("muted", !apiOnline);
}

function renderWorkflows() {
  els.workflowList.innerHTML = "";
  workflows.forEach((workflow) => {
    const card = document.createElement("button");
    card.className = "workflow-card";
    card.type = "button";
    card.innerHTML = `<strong>${workflow.title}</strong><p>${workflow.description}</p>`;
    card.addEventListener("click", () => {
      activeWorkflow = workflow.id;
      document.querySelectorAll(".workflow-card").forEach((item) => item.classList.remove("selected"));
      card.classList.add("selected");
      els.agentCommand.value = defaultAgentCommand(workflow.id);
    });
    if (workflow.id === activeWorkflow) card.classList.add("selected");
    els.workflowList.append(card);
  });
  els.agentCommand.value = defaultAgentCommand(activeWorkflow);
}

function renderAdmin() {
  const chunkCount = state.documents.reduce((sum, doc) => sum + getChunkCount(doc), 0);
  const avgConfidence = average(state.queryLogs.map((item) => item.confidence));
  const metrics = [
    ["문서", state.documents.length],
    ["청크", chunkCount],
    ["질문", state.queryLogs.length],
    ["평균 신뢰도", `${Math.round(avgConfidence || 0)}%`],
  ];

  els.metricGrid.innerHTML = metrics.map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`).join("");
  renderDocuments();
  renderLogs();
  renderKeywords();
  renderUsers();
  renderPermissionControls();
}

function renderDocuments() {
  els.documentTable.innerHTML = "";
  if (state.documents.length === 0) {
    els.documentTable.append(renderEmptyState("색인된 문서가 없습니다.", "업로드 또는 데모 문서를 사용하세요."));
    return;
  }

  state.documents.forEach((doc) => {
    const row = document.createElement("article");
    row.className = "doc-row";
    const canAdminDoc = currentUser?.role === "admin" || doc.ownerId === currentUser?.id;
    row.innerHTML = `<div class="doc-row-header"><strong>${escapeHtml(doc.name)}</strong>${canAdminDoc ? '<button class="icon-button" title="삭제" type="button">×</button>' : ""}</div><small>${doc.type} · ${formatBytes(doc.size)} · ${getChunkCount(doc)} chunks · ${doc.visibility || "team"} · ${formatDate(doc.uploadedAt)}</small>`;
    if (canAdminDoc) {
      const actions = document.createElement("div");
      actions.className = "doc-meta-actions";
      actions.innerHTML = `<select aria-label="공개 범위"><option value="team">팀 전체 공개</option><option value="private">나만/허용 사용자</option></select><span class="status-pill muted">owner</span>`;
      const select = actions.querySelector("select");
      select.value = doc.visibility || "team";
      select.addEventListener("change", async () => {
        await apiFetch(`/documents/${doc.id}/visibility`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility: select.value }),
        });
        await syncFromApi();
        renderAll();
      });
      row.append(actions);
    }
    row.querySelector("button")?.addEventListener("click", async () => {
      if (apiOnline) {
        await apiFetch(`/documents/${doc.id}`, { method: "DELETE" });
        await syncFromApi();
      } else {
        state.documents = state.documents.filter((item) => item.id !== doc.id);
        persist();
      }
      renderAll();
    });
    els.documentTable.append(row);
  });
}

function renderUsers() {
  els.accessAdminPanel.classList.toggle("hidden", currentUser?.role !== "admin");
  els.userTable.innerHTML = "";
  if (currentUser?.role !== "admin") return;
  state.users.forEach((user) => {
    const row = document.createElement("article");
    row.className = "doc-row";
    row.innerHTML = `<strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)} · ${user.role} · ${formatDate(user.createdAt)}</small>`;
    els.userTable.append(row);
  });
}

function renderPermissionControls() {
  if (currentUser?.role !== "admin") return;
  els.permissionDocumentSelect.innerHTML = "";
  els.permissionUserSelect.innerHTML = "";
  state.documents.forEach((doc) => {
    const option = document.createElement("option");
    option.value = doc.id;
    option.textContent = doc.name;
    els.permissionDocumentSelect.append(option);
  });
  state.users
    .filter((user) => user.role !== "admin")
    .forEach((user) => {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = `${user.name} (${user.email})`;
      els.permissionUserSelect.append(option);
    });
}

function renderLogs() {
  els.queryLog.innerHTML = "";
  if (state.queryLogs.length === 0) {
    els.queryLog.append(renderEmptyState("질문 로그가 없습니다.", "문서 검색에서 질문을 실행하세요."));
  } else {
    state.queryLogs.slice(0, 8).forEach((log) => {
      const item = document.createElement("article");
      item.className = "log-item";
      item.innerHTML = `<strong>${escapeHtml(log.question)}</strong><small>confidence ${log.confidence}% · hits ${log.hitCount} · ${formatDate(log.createdAt)}</small>`;
      els.queryLog.append(item);
    });
  }

  els.automationLog.innerHTML = "";
  if (state.automationLogs.length === 0) {
    els.automationLog.append(renderEmptyState("Agent 실행 이력이 없습니다.", "자동화 Agent를 실행하세요."));
  } else {
    state.automationLogs.slice(0, 8).forEach((log) => {
      const item = document.createElement("article");
      item.className = "log-item";
      item.innerHTML = `<strong>${escapeHtml(log.workflow)}</strong><small>${escapeHtml(log.command)} · ${formatDate(log.createdAt)}</small>`;
      els.automationLog.append(item);
    });
  }
}

function renderKeywords() {
  const keywords = state.keywords?.length
    ? state.keywords.map((item) => [item.keyword, item.count])
    : Object.entries(countTokens(tokenize(state.documents.map((doc) => doc.text || "").join("\n"))))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 18);

  els.keywordCloud.innerHTML = "";
  if (keywords.length === 0) {
    els.keywordCloud.append(renderEmptyState("키워드가 없습니다.", "문서 색인 후 자동 집계됩니다."));
    return;
  }
  keywords.forEach(([keyword, count]) => {
    const item = document.createElement("span");
    item.className = "keyword";
    item.textContent = `${keyword} ${count}`;
    els.keywordCloud.append(item);
  });
}

function renderEmptyState(title, description) {
  const node = els.emptyTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("strong").textContent = title;
  node.querySelector("span").textContent = description;
  return node;
}

function defaultAgentCommand(workflow) {
  const map = {
    summary: "업로드된 문서에서 운영 리스크와 핵심 정책을 요약해줘",
    email: "환불 문의 고객에게 보낼 답변 메일 초안을 만들어줘",
    tasks: "문서에서 담당자가 처리해야 할 액션 아이템을 뽑아줘",
    api: "SLA 초과 위험이 있을 때 Slack과 Google Sheets에 남기는 자동화 계획을 만들어줘",
  };
  return map[workflow] || map.summary;
}

function tokenize(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopwords.has(token));
}

function countTokens(tokens) {
  return tokens.reduce((acc, token) => {
    acc[token] = (acc[token] || 0) + 1;
    return acc;
  }, {});
}

function normalizeWhitespace(text) {
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function inferType(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? `application/${ext}` : "text/plain";
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function checkApi() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) return false;
    const data = await response.json();
    aiOnline = Boolean(data.ai_enabled);
    return true;
  } catch {
    aiOnline = false;
    return false;
  }
}

async function syncFromApi(options = {}) {
  if (!apiOnline || !getToken()) return;
  let apiState;
  try {
    apiState = await apiFetch("/state");
  } catch (error) {
    if (String(error.message).includes("401")) logout(false);
    return;
  }
  const chat = state.chat;
  state = {
    ...createEmptyState(),
    currentUser: apiState.currentUser || null,
    documents: apiState.documents || [],
    queryLogs: (apiState.queryLogs || []).map(normalizeQueryLog),
    automationLogs: (apiState.automationLogs || []).map(normalizeAutomationLog),
    sessions: apiState.sessions || [],
    users: apiState.users || [],
    keywords: apiState.keywords || [],
    chat,
  };
  currentUser = apiState.currentUser || currentUser;
  persist();
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function restoreAuth() {
  const saved = loadAuth();
  if (!saved?.token) return;
  try {
    const response = await apiFetch("/auth/me");
    currentUser = response.user;
  } catch {
    clearAuth();
    currentUser = null;
  }
}

async function login(email, password) {
  if (!apiOnline) {
    window.alert("서버 모드에서만 로그인을 사용할 수 있습니다.");
    return;
  }
  const response = await apiFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  saveAuth(response.token);
  currentUser = response.user;
  state.chat = [];
  activeSessionId = null;
  await syncFromApi();
  ensureWelcomeMessage();
  renderAll();
}

function logout(render = true) {
  clearAuth();
  currentUser = null;
  activeSessionId = null;
  state = createEmptyState();
  ensureWelcomeMessage();
  if (render) renderAll();
}

async function createNewSession() {
  if (!apiOnline || !currentUser) {
    activeSessionId = null;
    state.chat = [];
    ensureWelcomeMessage();
    renderAll();
    return;
  }
  const response = await apiFetch("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "새 대화" }),
  });
  activeSessionId = response.session.id;
  state.chat = [];
  ensureWelcomeMessage();
  await syncFromApi();
  renderAll();
}

async function loadSession(sessionId) {
  activeSessionId = sessionId;
  const response = await apiFetch(`/sessions/${sessionId}/messages`);
  state.chat = response.messages.map((message) => ({
    role: message.role,
    content: message.content,
    citations: message.citations || [],
    confidence: message.confidence,
    mode: message.mode,
    createdAt: message.createdAt,
  }));
  ensureWelcomeMessage();
  renderAll();
}

async function grantDocumentAccess() {
  const documentId = els.permissionDocumentSelect.value;
  const userId = els.permissionUserSelect.value;
  if (!documentId || !userId) return;
  await apiFetch(`/documents/${documentId}/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, permission: "read" }),
  });
  await syncFromApi();
  renderAll();
}

function renderAuth() {
  const isLoggedIn = Boolean(currentUser);
  els.loginForm.classList.toggle("hidden", !apiOnline || isLoggedIn);
  els.demoLoginActions.classList.toggle("hidden", !apiOnline || isLoggedIn);
  els.logoutBtn.classList.toggle("hidden", !isLoggedIn);
  els.currentUserBox.classList.toggle("hidden", !isLoggedIn);
  els.currentUserBox.innerHTML = isLoggedIn
    ? `<strong>${escapeHtml(currentUser.name)}</strong><small>${escapeHtml(currentUser.email)} · ${currentUser.role}</small>`
    : "";
  els.roleBadge.textContent = isLoggedIn ? `${currentUser.role}` : "Guest";
  els.resetBtn.classList.toggle("hidden", apiOnline && currentUser?.role !== "admin");
}

function requireLoggedIn() {
  if (currentUser) return true;
  window.alert("데모 계정으로 로그인한 뒤 사용할 수 있습니다.");
  return false;
}

function renderSessions() {
  els.sessionList.innerHTML = "";
  if (!apiOnline || !currentUser) {
    els.sessionList.append(renderEmptyState("로그인이 필요합니다.", "대화방 히스토리는 서버 모드에서 저장됩니다."));
    return;
  }
  if (!state.sessions?.length) {
    els.sessionList.append(renderEmptyState("대화방이 없습니다.", "질문하면 자동으로 대화방이 생성됩니다."));
    return;
  }
  state.sessions.forEach((session) => {
    const item = document.createElement("button");
    item.className = `session-item ${session.id === activeSessionId ? "active" : ""}`;
    item.type = "button";
    item.innerHTML = `<strong>${escapeHtml(session.title)}</strong><small>${formatDate(session.updatedAt)}</small>`;
    item.addEventListener("click", () => loadSession(session.id));
    els.sessionList.append(item);
  });
}

function saveAuth(token) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ token }));
}

function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch {
    return null;
  }
}

function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

function getToken() {
  return loadAuth()?.token || "";
}

function ensureWelcomeMessage() {
  if (state.chat.length > 0) return;
  state.chat.push({
    role: "assistant",
    content:
      "문서를 업로드하거나 데모 문서를 불러온 뒤 질문하세요. 답변에는 검색된 문서 출처와 신뢰도 점수가 함께 표시됩니다.",
    createdAt: new Date().toISOString(),
    citations: [],
  });
}

function getChunkCount(doc) {
  if (Array.isArray(doc.chunks)) return doc.chunks.length;
  return Number(doc.chunks || 0);
}

function normalizeQueryLog(log) {
  return {
    id: log.id,
    question: log.question,
    confidence: log.confidence,
    hitCount: log.hitCount ?? log.hit_count ?? 0,
    createdAt: log.createdAt ?? log.created_at,
  };
}

function normalizeAutomationLog(log) {
  return {
    id: log.id,
    workflow: log.workflow,
    command: log.command,
    output: log.output,
    createdAt: log.createdAt ?? log.created_at,
  };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState();
    const parsed = JSON.parse(raw);
    return {
      currentUser: parsed.currentUser || null,
      documents: parsed.documents || [],
      chat: parsed.chat || [],
      queryLogs: parsed.queryLogs || [],
      automationLogs: parsed.automationLogs || [],
      sessions: parsed.sessions || [],
      users: parsed.users || [],
      keywords: parsed.keywords || [],
    };
  } catch {
    return createEmptyState();
  }
}

function createEmptyState() {
  return {
    currentUser: null,
    documents: [],
    chat: [],
    queryLogs: [],
    automationLogs: [],
    sessions: [],
    users: [],
    keywords: [],
  };
}
