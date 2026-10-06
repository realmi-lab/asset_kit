[English](./README.en.md) | 한국어

# 빗썸 자산 대시보드 킷

빗썸 계좌의 잔고·평가손익·자산 비중·일별 손익·주문·입출금 내역을 AI에 연결하는 **MCP 서버**입니다.
AI에게 “내 자산으로 대시보드를 만들어줘”라고 하면 화면 설정을 저장하고 로컬 대시보드를 띄웁니다.

- **외부 의존성 0개** — Node.js 22.13 이상 내장 기능만 사용합니다. `npm install`이 필요 없습니다.
- **조회 전용** — 주문·취소·출금 도구가 없습니다. 쓰기는 이 컴퓨터의 대시보드 화면 설정뿐입니다.
- **키는 이 컴퓨터에만** — 키를 도구 입력으로 받지 않고 브라우저나 AI로 보내지 않습니다.

단일 사용자 로컬 조회용 개발 시제품입니다. 빗썸 공식 패키지와 별개이며 npm에는 배포하지 않았습니다.

---

## 구성 요소

| **구성 요소** | **폴더** | **설명** |
| --- | --- | --- |
| **MCP** | [`mcp/`](./mcp) | AI 클라이언트에서 자산·손익·내역 조회와 대시보드 만들기 (도구 14개, [문서](./mcp/README.md)) |
| **CLI** | [`cli/`](./cli) | 터미널 조회, 키 설정, 진단, 대시보드 실행 |
| **Skills** | [`skills/`](./skills) | AI 작업 흐름 가이드 |

공통 계산·빗썸 연결은 [`src/`](./src), 대시보드 화면은 [`web/`](./web)에 있습니다. 서버 없이 바로 열리는 샘플은 [`examples/sample-dashboard.html`](./examples/sample-dashboard.html)입니다.

---

## 시작하기

Node.js **22.13 이상**이 필요합니다. 외부 패키지가 없어 `npm install` 없이 바로 실행됩니다.

```bash
git clone https://github.com/realmi-lab/asset_kit.git
cd asset_kit
npm run demo
```

[내 자산 대시보드 열기](http://127.0.0.1:4319) — 데모는 키 없이 실행되며 잔고·시세·추이가 모두 합성 예시입니다. 실제 계좌 연결은 아래 **인증**을 참고하세요.

---

## MCP

[`mcp/`](./mcp)의 서버를 MCP 클라이언트에 등록합니다. 외부 패키지가 없어 설치 과정이 없습니다. 경로는 저장소를 내려받은 **실제 절대 경로**로 바꾸세요.

**Claude Code** (프로젝트 루트의 `.mcp.json`, 또는 전역 설정은 `~/.claude.json`):

```json
{
  "mcpServers": {
    "bithumb-assets": {
      "command": "node",
      "args": ["/absolute/path/to/asset_kit/mcp/index.js"]
    }
  }
}
```

키 없이 먼저 체험하려면 `args` 끝에 `"--demo"`를 추가합니다.

**사용 예시**

- “내 빗썸 잔고와 평가손익을 보여줘.”
- “이번 달 일별 손익을 알려줘.”
- “지난달 원화 입출금 내역을 정리해줘.”
- “BTC·ETH만 묶은 대시보드 만들고 열어줘.”

Codex·Cursor·VS Code·Windsurf·Claude Desktop 설정, 기능 모듈별 도구 14개, 실행 옵션(`--modules`, `--read-only`), 대시보드 만들기 순서는 [MCP 문서](./mcp/README.md)를 참고하세요.

---

## 인증

1. [빗썸 API 관리](https://www.bithumb.com/react/api-support/management-api)에서 **조회 권한**과 허용 IP를 설정합니다.
2. 이 폴더에서 실행합니다. 입력한 키는 화면에 보이지 않고 `~/.bithumb-asset-kit/credentials.json`(권한 0600)에만 저장됩니다.

```bash
node cli/asset-kit.js config init
node cli/asset-kit.js doctor
```

환경 변수 `BITHUMB_ACCESS_KEY`, `BITHUMB_SECRET_KEY`가 있으면 그 값을 먼저 씁니다. `.env` 파일은 `--env-file .env`로 지정합니다. 키를 AI 채팅에 입력하지 마세요. MCP로 조회한 계좌 데이터는 연결한 AI 서비스에서 처리될 수 있습니다.

---

## 대시보드

```bash
npm run demo   # 합성 데이터 → http://127.0.0.1:4319
npm start      # 실제 계좌
```

- 화면(보드)을 여러 개 만들어 탭으로 전환합니다. 화면마다 위젯 순서·자산 범위·추이 기간(7/30/90일·1년)·자동 갱신을 저장합니다.
- 자산 추이 ↔ 일별 손익 달력, 자산 상세(30일 시세), 요약 보기, 금액 숨기기, CSV·설정 내보내기/가져오기를 제공합니다.
- 거래·입출금은 종류와 기간을 고르면 페이지를 이어 조회합니다.
- 화면을 직접 고치려면 `web/`을 수정하고 새로고침합니다. 빌드 과정이 없습니다. 다른 폴더의 화면은 `--web-dir`로 띄웁니다.
- 샘플 HTML은 `npm run sample`로 다시 만듭니다. 합성 데이터만 들어갑니다.

---

## CLI

```bash
node cli/asset-kit.js portfolio --demo
node cli/asset-kit.js explain --symbols BTC,ETH
node cli/asset-kit.js history --days 30 --daily
node cli/asset-kit.js market --symbol BTC
node cli/asset-kit.js records --kind orders --from 2026-09-01 --to 2026-09-30
node cli/asset-kit.js boards create --name "장기 보유" --symbols BTC,ETH
node cli/asset-kit.js skill install --path ./my-project
```

전체 명령은 `node cli/asset-kit.js --help`입니다. 데이터 명령은 JSON을 출력하고, 오류는 stderr JSON과 종료 코드 1입니다.

---

## Skills

[`skills/bithumb-asset-dashboard`](./skills/bithumb-asset-dashboard/SKILL.md): 연결 확인 → 조회 → 범위 확인 → 대시보드 저장·열기 순서를 안내합니다. `asset-kit skill install --path <프로젝트>`는 `.claude/skills/`에, `--target agents`는 `.agents/skills/`에 설치합니다.

---

## 계산 기준과 범위

- 수량은 가용 + 주문 중입니다. 금액은 BigInt 십진 계산으로 부동소수점 오차가 없고, 응답은 십진 문자열, 미확인 값은 `null`입니다.
- 평가손익은 현재 보유분의 API 평균 매수가 기준이며 수수료·실현손익을 포함하지 않습니다. 원화 마켓이 없는 코인은 BTC 마켓 가격 × KRW-BTC로 평가합니다.
- 추이·일별 손익은 조회할 때마다(최대 5분에 한 번) 이 컴퓨터에 기록한 평가금액이라 입출금이 포함됩니다. 과거를 소급해 만들지 않습니다.
- 전체 기간 실현손익·세금·스테이킹/대여 상품은 제공하지 않습니다.

## 보안

- 대시보드는 `127.0.0.1`에만 열리며 Host·Origin을 검사합니다. 화면 설정 저장은 같은 출처의 JSON 요청과 전용 헤더가 있어야 합니다.
- 기록·화면 설정·키 파일은 `~/.bithumb-asset-kit`(폴더 0700, 파일 0600)에 있고 `ASSET_KIT_DATA_DIR`로 바꿀 수 있습니다.
- 빗썸 응답 형식이 바뀌면 추정하지 않고 멈춥니다. 429·5xx·네트워크 오류는 새 서명으로 최대 2회 재시도합니다.

---

## 개발

```bash
npm test         # 테스트 30개, 설치 불필요
npm run sample   # 샘플 HTML 다시 만들기
```

```text
mcp/index.js        MCP 서버(JSON-RPC 2.0 stdio)와 도구 정의
cli/asset-kit.js    CLI
skills/             AI 작업 가이드
src/                계산(portfolio·decimal), 빗썸 연결(bithumb), 기록(history), 화면 설정(boards), 로컬 서버(server)
web/                대시보드 화면(index.html·app.js·styles.css·로고)
examples/           샘플 HTML과 생성 스크립트
test/               자동 테스트
```

검증: 공식 MCP SDK 클라이언트(1.32.1)로 프로토콜 협상과 도구 호출 호환성을 확인했습니다. **실제 계좌 API 키 연동은 아직 검증하지 않았습니다.**

## 참고

[빗썸 공식 AI 트레이드 킷](https://github.com/bithumb-official/bithumb-ai-trade-kit)의 MCP·CLI·Skills 제공 방식을 참고했습니다. 공식 문서: [MCP](https://apidocs.bithumb.com/docs/mcp) · [CLI](https://apidocs.bithumb.com/docs/cli) · [Skills](https://apidocs.bithumb.com/docs/skills)

## 라이선스

[MIT](./LICENSE)
