# GitHub Repository Setup

추천 저장소 이름:

```txt
workrag-agent-console
```

## GitHub CLI로 생성

현재 환경의 GitHub CLI 인증이 만료되어 있으면 먼저 로그인합니다.

```bash
gh auth login -h github.com
```

이 폴더만 새 저장소로 올리고 싶다면, 상위 `/work` 저장소와 섞이지 않도록 새 폴더에서 진행하는 방식을 권장합니다.

```bash
cd /mnt/c/Users/yoo/Desktop/work
cp -r wishcat workrag-agent-console
cd workrag-agent-console
rm -rf .git backend/.venv backend/data backend/__pycache__ scripts/__pycache__
git init
git add .
git commit -m "Initial WorkRAG portfolio MVP"
gh repo create workrag-agent-console --public --source=. --remote=origin --push
```

## GitHub 웹에서 생성

1. GitHub에서 `workrag-agent-console` 저장소를 만듭니다.
2. 아래 명령을 실행합니다.

```bash
cd /mnt/c/Users/yoo/Desktop/work/wishcat
git init
git add .
git commit -m "Initial WorkRAG portfolio MVP"
git branch -M main
git remote add origin https://github.com/YOUR_ID/workrag-agent-console.git
git push -u origin main
```

현재 `wishcat` 폴더는 상위 `/mnt/c/Users/yoo/Desktop/work` Git 저장소 안에 있으므로, 충돌이 나면 첫 번째 방식처럼 복사본에서 새 저장소를 만드는 편이 안전합니다.
