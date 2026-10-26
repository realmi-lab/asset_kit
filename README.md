[English](./README.en.md) | 한국어

# 빗썸 자산 툴킷 · MCP

빗썸 계좌의 잔고·평가손익·자산 비중·일별 자산 변화·주문·입출금 내역을 AI에 연결하는 **MCP 서버**입니다.
AI에게 “내 자산 대시보드 보여줘”라고 하면 대화 안에 대시보드를 그리고(MCP Apps 지원 클라이언트), 화면 설정을 저장해 로컬 대시보드로도 띄웁니다.

- **외부 의존성 0개** — Node.js 22.13 이상 내장 기능만 사용합니다. `npm install`이 필요 없습니다.
- **조회 전용** — 주문·취소·출금 도구가 없습니다. 쓰기는 이 컴퓨터의 대시보드 화면 설정뿐입니다.
- **키는 이 컴퓨터에만** — 키를 도구 입력으로 받지 않고 브라우저나 AI로 보내지 않습니다.

단일 사용자 로컬 조회용 개발 시제품입니다. 빗썸 공식 패키지와 별개이며 npm에는 배포하지 않았습니다.

---

## 구성 요소

| **구성 요소** | **폴더** | **설명** |
| --- | --- | --- |
| **MCP** | [`mcp/`](./mcp) | AI 클라이언트에서 자산·손익·내역 조회와 대시보드 그리기 (도구 15개, [문서](./mcp/README.md)) |
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
- “이번 달 일별 자산 변화을 알려줘.”
- “지난달 원화 입출금 내역을 정리해줘.”
- “BTC·ETH만 묶은 대시보드 만들고 열어줘.”
- “내 자산 대시보드를 여기서 보여줘.” (MCP Apps 지원 클라이언트에서는 대화 안에 화면 표시)

Codex·Cursor·VS Code·Windsurf·Claude Desktop 설정, 기능 모듈별 도구 15개, 실행 옵션(`--modules`, `--read-only`), 대시보드 만들기 순서는 [MCP 문서](./mcp/README.md)를 참고하세요.

**0.5.0 대시보드 그리기:** `dashboard_snapshot` 한 번으로 요약·비중 상위·추이(열 배열, 기본 60점)·선택 시 일별 변화를 받습니다. 데모 계좌 기준 30일 약 2.6KB, 1년 약 3.7KB로, 기존 도구 4개(약 6.5KB)나 1년 추이(약 32KB)보다 작습니다. MCP Apps 클라이언트에서는 결과가 대화 안의 대시보드 화면(`ui://bithumb-asset-kit/dashboard.html`)으로 그려집니다. `dashboard_save_board`의 `open: true`로 저장과 열기를 한 번에 하고, 로컬 주소의 `?board=<id>`로 그 보드를 바로 엽니다. 열려 있는 대시보드는 MCP로 바꾼 보드를 몇 초 안에 반영합니다. [자세히](./mcp/README.md#대화-안에서-대시보드-그리기-050)

**0.4.0 MCP 개선:** 자산 검색·손익 필터·정렬·필드 선택, 강제 새로고침, 보고서 섹션 선택, 진행 알림·취소와 오류 복구 안내를 지원합니다. 내역 조회는 기본 최대 50건·5페이지씩 반환하며 `pagination.nextCursor`로 이어갑니다. 이전 버전처럼 한 응답을 전체 기간으로 해석하지 마세요. [입력 예시와 이어받기 규칙](./mcp/README.md#mcp-조회를-작게-나누기-040)을 확인하세요.

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

- 화면(보드)을 여러 개 만들어 탭으로 전환합니다. 화면마다 위젯 순서·자산 범위·추이 기간(7/30/90일·1년)·자동 갱신을 저장합니다. 주소의 `?board=<id>`로 특정 보드를 바로 열고, MCP나 다른 창에서 바꾼 보드는 몇 초 안에 반영합니다.
- 추이 차트는 마우스·터치 슬라이더·방향키로 시점별 값을 확인합니다. 첫 기록·최근 기록·구간 변화도 함께 표시합니다.
- 일별 자산 변화 달력은 입출금을 포함한 평가금액 변화입니다. 기록이 빠진 날을 건너뛴 변화는 `*`와 기록 간격으로 구분합니다.
- 보유자산 검색, 원화 제외, 수익·손실·미확인 필터, 평가금액·수익률·손익·전일 대비·이름 정렬과 방향을 보드별로 기억합니다. CSV는 현재 필터와 정렬을 적용합니다.
- 거래·입출금은 최근 7일·30일·이번 달 선택, 날짜 검증, 조회 중단, 자산 검색·상태·매수/매도 필터와 CSV를 지원합니다. 내보내기에는 현재 필터에 맞는 조회 결과 전체와 조회 범위 완료 여부가 들어갑니다.
- 금액 숨기기는 자산·비중·추이·내역 금액을 가리고 자산/내역 CSV를 비활성화합니다. 공개 현재가는 그대로 표시합니다.
- 마지막 조회 시각, 갱신 실패 상태, 자동 갱신 중지/재개를 표시합니다. 수동 새로고침은 캐시를 건너뛰고, 화면을 바꾸거나 대화상자를 닫으면 이전 응답을 무시합니다.
- 자산 상세(30일 시세), 요약, 화면 설정 내보내기/가져오기도 지원합니다.
- 화면을 직접 고치려면 `web/`을 수정하고 새로고침합니다. 빌드 과정이 없습니다. 다른 폴더의 화면은 `--web-dir`로 띄웁니다.
- 샘플 HTML은 `npm run sample`로 다시 만듭니다. 합성 데이터만 들어가며 조회 날짜는 샘플 생성 시점에 맞춥니다. 오래된 샘플을 열어도 기본 조회에 예시 내역이 나타납니다.

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

## 조회 최적화

- 동시 포트폴리오·시세·시장 목록 요청을 하나의 조회로 합칩니다. 포트폴리오/내역은 30초, 자산 시세는 60초 동안 재사용합니다.
- 내역 캐시는 최대 8개 조회 조건만 보관하고 원래 조회 시각을 유지합니다. 직접 누르는 새로고침/내역 조회는 새 데이터를 요청합니다.
- 로컬 HTTP API의 `/api/portfolio`, `/api/market`, `/api/records`에 `force=1`을 붙이면 캐시를 건너뜁니다. 이미 진행 중인 동일 요청은 공유합니다.
- 추이 저장은 동시 호출에도 5분 구간당 한 번만 기록합니다. 차트는 첫·마지막 기록을 보존하며 최대 400개 시점으로 줄입니다.

## 계산 기준과 범위

- 수량은 가용 + 주문 중입니다. 금액은 BigInt 십진 계산으로 부동소수점 오차가 없고, 응답은 십진 문자열, 미확인 값은 `null`입니다.
- 평가손익은 현재 보유분의 API 평균 매수가 기준이며 수수료·실현손익을 포함하지 않습니다. 원화 마켓이 없는 코인은 BTC 마켓 가격 × KRW-BTC로 평가합니다.
- 추이·일별 자산 변화는 조회할 때마다(최대 5분에 한 번) 이 컴퓨터에 기록한 평가금액이라 입출금이 포함됩니다. 과거를 소급해 만들지 않습니다.
- 전체 기간 실현손익·세금·스테이킹/대여 상품은 제공하지 않습니다.

## 보안

- 대시보드는 `127.0.0.1`에만 열리며 Host·Origin을 검사합니다. 화면 설정 저장은 같은 출처의 JSON 요청과 전용 헤더가 있어야 합니다.
- 기록·화면 설정·키 파일은 `~/.bithumb-asset-kit`(폴더 0700, 파일 0600)에 있고 `ASSET_KIT_DATA_DIR`로 바꿀 수 있습니다.
- 빗썸 응답 형식이 바뀌면 추정하지 않고 멈춥니다. 429·5xx·네트워크 오류는 새 서명으로 최대 2회 재시도합니다.

---

## 개발

```bash
npm test         # 계산·조회·화면 상태 회귀 테스트, 설치 불필요
npm run sample   # 샘플 HTML 다시 만들기
```

```text
mcp/index.js        MCP 서버(JSON-RPC 2.0 stdio)와 도구 정의
mcp/view.html       MCP Apps 화면(대화 안 대시보드, dashboard_snapshot 결과 표시)
cli/asset-kit.js    CLI
skills/             AI 작업 가이드
src/                계산(portfolio·decimal), 빗썸 연결(bithumb), 기록(history), 화면 설정(boards), 로컬 서버(server)
web/                대시보드 화면(index.html·app.js·styles.css·로고)
examples/           샘플 HTML과 생성 스크립트
test/               자동 테스트
```

검증: 공식 MCP SDK 클라이언트(1.32.2)로 실제 stdio 연결, 15개 도구의 출력 규격, MCP Apps 화면 리소스, 진행·취소·이어받기를 확인했습니다. `npm run verify:mcp-sdk`는 별도 SDK 설치 경로(`MCP_SDK_ROOT`)가 필요합니다. **실제 계좌 API 키 연동은 아직 검증하지 않았습니다.**

## 참고

[빗썸 공식 AI 트레이드 킷](https://github.com/bithumb-official/bithumb-ai-trade-kit)의 MCP·CLI·Skills 제공 방식을 참고했습니다. 공식 문서: [MCP](https://apidocs.bithumb.com/docs/mcp) · [CLI](https://apidocs.bithumb.com/docs/cli) · [Skills](https://apidocs.bithumb.com/docs/skills)

## 라이선스

[MIT](./LICENSE)
