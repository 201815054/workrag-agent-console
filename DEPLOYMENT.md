# Deployment

이 프로젝트는 FastAPI 서버가 프론트엔드 정적 파일까지 함께 제공합니다. Render에 한 개의 Web Service로 올리면 `/`에서 앱 화면이 열리고 `/api/*`에서 백엔드 API가 동작합니다.

## Render 배포

1. GitHub에 이 폴더를 새 저장소로 올립니다.
2. Render에서 `New` -> `Blueprint`를 선택하고 저장소를 연결합니다.
3. `render.yaml` 설정을 확인합니다.
4. OpenAI API를 쓰려면 환경변수 `OPENAI_API_KEY`를 Render 대시보드에서 등록합니다. 비용 없는 데모는 등록하지 않아도 됩니다.
5. 배포가 끝나면 Render URL을 위시켓 결과물 URL에 등록합니다.

## 수동 Web Service 설정

- Environment: `Python`
- Build Command: `pip install -r backend/requirements.txt`
- Start Command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
- Environment Variables:
  - `PYTHON_VERSION=3.11.9`
  - `OPENAI_API_KEY` 선택
  - `OPENAI_MODEL=gpt-4o-mini`

## 로컬 실행

```bash
export OPENAI_API_KEY="your_api_key"
./run_backend.sh
```

서버 실행 후 `http://127.0.0.1:8000`으로 접속하면 배포 환경과 같은 방식으로 프론트와 API를 함께 확인할 수 있습니다.
