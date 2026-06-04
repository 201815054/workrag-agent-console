from __future__ import annotations

from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "portfolio-assets"
FONT_DIRS = [
    Path("/mnt/c/Windows/Fonts"),
    Path("/usr/share/fonts/truetype/noto"),
    Path("/usr/share/fonts/truetype/dejavu"),
]

COLORS = {
    "bg": "#f6f7f9",
    "ink": "#20242a",
    "muted": "#66707d",
    "line": "#dde3ea",
    "surface": "#ffffff",
    "sidebar": "#172026",
    "accent": "#0e7c7b",
    "accent_dark": "#095f61",
    "blue": "#3454d1",
    "orange": "#c76d22",
    "cream": "#fff8f1",
    "yellow": "#f4b860",
    "green_bg": "#e5f4f1",
}


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    candidates = {
        "regular": ["NotoSansKR-Regular.ttf", "malgun.ttf", "DejaVuSans.ttf"],
        "medium": ["NotoSansKR-Medium.ttf", "malgun.ttf", "DejaVuSans.ttf"],
        "bold": ["NotoSansKR-Bold.ttf", "malgunbd.ttf", "DejaVuSans-Bold.ttf"],
        "mono": ["DejaVuSansMono.ttf", "NotoSansKR-Regular.ttf"],
    }[name]
    for directory in FONT_DIRS:
        for candidate in candidates:
            path = directory / candidate
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


F = {
    "eyebrow": font("bold", 12),
    "small": font("regular", 13),
    "body": font("regular", 15),
    "body_bold": font("bold", 15),
    "h3": font("bold", 18),
    "h2": font("bold", 24),
    "h1": font("bold", 30),
    "cover_title": font("bold", 28),
    "mono": font("mono", 12),
}


def rounded(draw: ImageDraw.ImageDraw, box, radius=8, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw: ImageDraw.ImageDraw, xy, value, fill="ink", font_key="body", anchor=None):
    draw.text(xy, value, fill=COLORS.get(fill, fill), font=F[font_key], anchor=anchor)


def multiline(draw: ImageDraw.ImageDraw, xy, value, fill="ink", font_key="body", max_chars=42, line_gap=7):
    x, y = xy
    for paragraph in value.split("\n"):
        lines = wrap(paragraph, width=max_chars) or [""]
        for line in lines:
            draw.text((x, y), line, fill=COLORS.get(fill, fill), font=F[font_key])
            y += F[font_key].size + line_gap
    return y


def pill(draw, xy, label, fill="green_bg", ink="accent_dark", pad_x=10, height=28):
    x, y = xy
    bbox = draw.textbbox((0, 0), label, font=F["eyebrow"])
    width = bbox[2] - bbox[0] + pad_x * 2
    rounded(draw, (x, y, x + width, y + height), radius=14, fill=COLORS[fill])
    draw.text((x + pad_x, y + 7), label, fill=COLORS[ink], font=F["eyebrow"])
    return width


def shadow_card(draw, box, radius=8, fill="surface"):
    x1, y1, x2, y2 = box
    rounded(draw, (x1 + 4, y1 + 7, x2 + 4, y2 + 7), radius=radius, fill="#dbe2e8")
    rounded(draw, box, radius=radius, fill=COLORS[fill], outline=COLORS["line"])


def draw_sidebar(draw, width, height, compact=False):
    rounded(draw, (0, 0, width, height), radius=0, fill=COLORS["sidebar"])
    rounded(draw, (22, 24, 62, 64), radius=8, fill=COLORS["yellow"])
    text(draw, (42, 34), "W", fill=COLORS["sidebar"], font_key="body_bold", anchor="ma")
    if not compact:
        text(draw, (74, 24), "WorkRAG", fill="#ffffff", font_key="body_bold")
        text(draw, (74, 45), "Agent Console", fill="#b9c4cc", font_key="small")
    nav = [("Q", "문서 검색"), ("A", "자동화 Agent"), ("D", "관리자")]
    y = 104
    for i, (icon, label) in enumerate(nav):
        active = i == 0
        if active:
            rounded(draw, (18, y - 8, width - 18, y + 34), radius=8, fill="#26323b", outline="#3d4a54")
        text(draw, (30, y), icon, fill="yellow", font_key="body_bold")
        if not compact:
            text(draw, (58, y), label, fill="#f8fafc" if active else "#d9e2e8", font_key="body")
        y += 52


def draw_chat_panel(draw, box, show_large=True):
    shadow_card(draw, box)
    x1, y1, x2, y2 = box
    text(draw, (x1 + 22, y1 + 20), "RAG Chat", fill="accent_dark", font_key="eyebrow")
    text(draw, (x1 + 22, y1 + 42), "출처 기반 답변", font_key="h3")
    pill(draw, (x2 - 154, y1 + 22), "96% confidence")

    rounded(draw, (x1 + 26, y1 + 88, x2 - 28, y1 + 140), radius=8, fill="#e8f1ff")
    multiline(draw, (x1 + 42, y1 + 104), "환불 SLA와 Slack 알림 기준 알려줘", max_chars=32 if show_large else 24)

    answer_bottom = y2 - 82 if show_large else y2 - 88
    rounded(draw, (x1 + 26, y1 + 158, x2 - 28, answer_bottom), radius=8, fill="#ffffff", outline=COLORS["line"])
    y = y1 + 176
    answer_text = (
        "문서 기준 핵심:\nSLA 24시간 · Slack 알림"
        if show_large
        else "문서 기준 핵심:\n- SLA 24시간 이내\n- Slack 알림 전송"
    )
    y = multiline(
        draw,
        (x1 + 42, y),
        answer_text,
        max_chars=34 if show_large else 24,
    )
    text(draw, (x1 + 42, y + 8), "confidence 96% · OpenAI RAG", fill="muted", font_key="small")

    c_y = answer_bottom + 18
    rounded(draw, (x1 + 26, c_y, x2 - 28, y2 - 28), radius=8, fill=COLORS["cream"])
    draw.rectangle((x1 + 26, c_y, x1 + 30, y2 - 28), fill=COLORS["orange"])
    multiline(
        draw,
        (x1 + 44, c_y + 12),
        "고객 상담 운영 매뉴얼.md · chunk 1 · score 9.7",
        fill="#4b3a2b",
        font_key="small",
        max_chars=34 if show_large else 24,
    )


def draw_upload_panel(draw, box):
    shadow_card(draw, box)
    x1, y1, x2, y2 = box
    text(draw, (x1 + 20, y1 + 18), "Knowledge Base", fill="accent_dark", font_key="eyebrow")
    text(draw, (x1 + 20, y1 + 40), "문서 업로드", font_key="h3")
    pill(draw, (x2 - 90, y1 + 20), "3 docs")
    rounded(draw, (x1 + 22, y1 + 88, x2 - 22, y1 + 225), radius=8, fill="#fbfcfd", outline="#a9b8c5", width=2)
    rounded(draw, (x1 + 112, y1 + 112, x1 + 154, y1 + 154), radius=8, fill="#e8eef5")
    text(draw, (x1 + 133, y1 + 123), "UP", fill="blue", font_key="body_bold", anchor="ma")
    text(draw, (x1 + 44, y1 + 170), "PDF/엑셀/텍스트 업로드", font_key="body_bold")
    text(draw, (x1 + 44, y1 + 196), "서버 저장 · 청크 색인", fill="muted", font_key="small")
    rounded(draw, (x1 + 22, y1 + 246, x2 - 22, y2 - 24), radius=8, fill="#ffffff", outline=COLORS["line"])
    text(draw, (x1 + 38, y1 + 262), "직접 입력", font_key="body_bold")
    text(draw, (x1 + 38, y1 + 290), "상담 매뉴얼 / 정책 문서", fill="muted", font_key="small")
    rounded(draw, (x1 + 38, y2 - 74, x2 - 38, y2 - 34), radius=8, fill=COLORS["accent"])
    text(draw, ((x1 + x2) // 2, y2 - 62), "문서 색인", fill="#ffffff", font_key="body_bold", anchor="ma")


def make_cover():
    img = Image.new("RGB", (480, 480), COLORS["bg"])
    draw = ImageDraw.Draw(img)
    draw_sidebar(draw, 112, 480, compact=True)
    text(draw, (138, 32), "Portfolio MVP", fill="accent_dark", font_key="eyebrow")
    text(draw, (138, 54), "AI 문서검색 챗봇", font_key="cover_title")
    text(draw, (138, 91), "RAG + FastAPI + OpenAI", fill="muted", font_key="body_bold")
    pill(draw, (326, 32), "Server + AI")
    draw_chat_panel(draw, (132, 128, 462, 438), show_large=True)
    OUT.mkdir(exist_ok=True)
    img.save(OUT / "cover-480.png")


def make_chat_detail():
    img = Image.new("RGB", (736, 520), COLORS["bg"])
    draw = ImageDraw.Draw(img)
    draw_sidebar(draw, 170, 520)
    text(draw, (198, 32), "Portfolio MVP", fill="accent_dark", font_key="eyebrow")
    text(draw, (198, 55), "사내 문서 검색 AI 챗봇", font_key="h1")
    pill(draw, (586, 36), "Server + AI")
    draw_upload_panel(draw, (198, 116, 414, 486))
    draw_chat_panel(draw, (430, 116, 706, 486), show_large=False)
    img.save(OUT / "01-rag-chat.png")


def make_agent_detail():
    img = Image.new("RGB", (736, 520), COLORS["bg"])
    draw = ImageDraw.Draw(img)
    draw_sidebar(draw, 170, 520)
    text(draw, (198, 32), "LangGraph-style Workflow", fill="accent_dark", font_key="eyebrow")
    text(draw, (198, 55), "업무 자동화 Agent", font_key="h1")
    pill(draw, (622, 36), "Ready")
    shadow_card(draw, (198, 116, 706, 486))
    workflows = [
        ("문서 요약", "핵심 정책, 수치, 실행 항목 압축"),
        ("메일 답변 초안", "상담 규정 기반 고객 응대 작성"),
        ("액션 아이템 추출", "담당자, 마감일, 할 일 분리"),
        ("외부 API 실행 계획", "Slack, Sheets 연동 계획"),
    ]
    y = 150
    for i, (title, desc) in enumerate(workflows):
        fill = "#eef8f6" if i == 3 else "#fbfcfd"
        outline = COLORS["accent"] if i == 3 else COLORS["line"]
        rounded(draw, (220, y, 398, y + 62), radius=8, fill=fill, outline=outline)
        text(draw, (236, y + 12), title, font_key="body_bold")
        text(draw, (236, y + 36), desc, fill="muted", font_key="small")
        y += 74
    rounded(draw, (420, 150, 684, 432), radius=8, fill="#121820")
    lines = [
        "Workflow: 외부 API 실행 계획",
        "Request: SLA 초과 위험 알림",
        "",
        "Decision:",
        "- Slack 채널 #ops-alert 선택",
        "- Sheets에 상담 로그 기록",
        "- 담당자 승인 후 실행",
        "",
        "Sources:",
        "- 고객 상담 운영 매뉴얼 #1",
    ]
    y = 170
    for line in lines:
        text(draw, (438, y), line, fill="#e7edf3", font_key="mono")
        y += 22
    img.save(OUT / "02-agent-workflow.png")


def make_admin_detail():
    img = Image.new("RGB", (736, 520), COLORS["bg"])
    draw = ImageDraw.Draw(img)
    draw_sidebar(draw, 170, 520)
    text(draw, (198, 32), "Admin Dashboard", fill="accent_dark", font_key="eyebrow")
    text(draw, (198, 55), "운영 현황", font_key="h1")
    metrics = [("문서", "12"), ("청크", "84"), ("질문", "326"), ("평균 신뢰도", "91%")]
    x = 198
    for label, value in metrics:
        shadow_card(draw, (x, 116, x + 118, 190))
        text(draw, (x + 16, 132), label, fill="muted", font_key="small")
        text(draw, (x + 16, 154), value, font_key="h2")
        x += 130
    shadow_card(draw, (198, 214, 444, 486))
    text(draw, (218, 234), "문서 관리", font_key="h3")
    docs = ["고객 상담 운영 매뉴얼.md", "월간 매출 리포트.csv", "업무 자동화 연동 명세.txt"]
    y = 274
    for doc in docs:
        text(draw, (218, y), doc, font_key="body_bold")
        text(draw, (218, y + 24), "text/plain · 3 chunks · 06.04", fill="muted", font_key="small")
        draw.line((218, y + 52, 424, y + 52), fill=COLORS["line"])
        y += 66
    shadow_card(draw, (462, 214, 706, 486))
    text(draw, (482, 234), "질문 로그", font_key="h3")
    logs = ["환불 SLA 기준 알려줘", "메일 초안 만들어줘", "Slack 알림 조건은?"]
    y = 274
    for log in logs:
        text(draw, (482, y), log, font_key="body_bold")
        text(draw, (482, y + 24), "confidence 96% · hits 3", fill="muted", font_key="small")
        draw.line((482, y + 52, 686, y + 52), fill=COLORS["line"])
        y += 66
    img.save(OUT / "03-admin-dashboard.png")


def main():
    OUT.mkdir(exist_ok=True)
    make_cover()
    make_chat_detail()
    make_agent_detail()
    make_admin_detail()
    print(f"generated {OUT}")


if __name__ == "__main__":
    main()
