[프로젝트 홈](../README.md) / MCP

# MCP

MCP 클라이언트에서 내 빗썸 자산 도구를 자연어로 호출하고, 나만의 자산 대시보드를 그립니다.

## MCP란?

MCP(Model Context Protocol)는 AI 클라이언트에 외부 도구를 연결하는 표준 방식입니다. Claude Desktop, Claude Code, Cursor, VS Code, Codex 같은 클라이언트에 빗썸 자산 MCP를 등록하면 잔고·평가손익·자산 비중·일별 자산 변화·주문·입출금 내역 조회와 대시보드 만들기를 자연어로 처리할 수 있습니다.

클라이언트 설정 파일에 항목만 추가하면 MCP 서버가 사용자 컴퓨터에서 자동으로 실행됩니다. **외부 패키지가 없어 설치 과정이 없고**, 주문·취소·출금 도구가 없는 **조회 전용** 서버입니다.

## 클라이언트 등록

AI 에이전트로 설정하거나 직접 설정할 수 있습니다. 이미 사용 중인 MCP 클라이언트(Claude Code, Cursor 등)가 에이전트 기능을 지원한다면 AI 에이전트로 설정이 가장 빠릅니다.

### AI 에이전트로 설정

에이전트에 다음 프롬프트를 입력하세요.

> `https://github.com/realmi-lab/asset_kit/blob/main/mcp/README.md`를 읽고, 빗썸 자산 MCP를 설치·설정해줘

에이전트는 아래 순서로 진행합니다.

1. `node -v`로 Node.js 22.13 이상인지 확인합니다.
2. 저장소가 없으면 `git clone https://github.com/realmi-lab/asset_kit.git`으로 내려받고, 그 폴더의 절대 경로에서 `node <절대 경로>/mcp/index.js --version`이 실행되는지 확인합니다. 설치할 패키지는 없습니다.
3. 사용 중인 클라이언트의 설정 파일에 아래 [설정 파일에 직접 추가하기](#설정-파일에-직접-추가하기)의 항목을 추가합니다. 기존 항목은 그대로 둡니다.
4. 클라이언트를 다시 시작한 뒤 `system_diagnose`를 호출해 연결을 확인합니다.

키가 필요한 도구를 쓰려면 [인증 설정](#인증-설정)을 마친 뒤 [정상 동작 확인](#정상-동작-확인)으로 이동하세요. 에이전트가 처리에 실패하면 설정 파일에 직접 추가합니다.

### 설정 파일에 직접 추가하기

Node.js 22.13 이상이 필요합니다. `node -v`로 확인하고, 없다면 [nodejs.org](https://nodejs.org)에서 설치하세요. 저장소를 내려받은 뒤(`git clone https://github.com/realmi-lab/asset_kit.git`) 아래 `/absolute/path/to/asset_kit`을 그 폴더의 실제 절대 경로로 바꿉니다.

클라이언트마다 설정 파일 위치와 형식이 다릅니다. 사용하는 클라이언트의 설정 파일에 아래 내용을 추가하세요.

**Claude Code** — 프로젝트 단위는 프로젝트 루트의 `.mcp.json`, 모든 프로젝트에 적용하려면 `~/.claude.json`에 추가합니다.

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

터미널에서 한 번에 등록할 수도 있습니다.

```bash
claude mcp add bithumb-assets -- node /absolute/path/to/asset_kit/mcp/index.js
```

**Codex** — `~/.codex/config.toml`

```toml
[mcp_servers.bithumb-assets]
command = "node"
args = ["/absolute/path/to/asset_kit/mcp/index.js"]
```

**Cursor** — 모든 프로젝트는 `~/.cursor/mcp.json`, 프로젝트 단위는 `.cursor/mcp.json`

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

**VS Code** — 작업 공간의 `.vscode/mcp.json`

```json
{
  "servers": {
    "bithumb-assets": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/asset_kit/mcp/index.js"]
    }
  }
}
```

**Windsurf** — `~/.codeium/windsurf/mcp_config.json`

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

**Claude Desktop** — macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`

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

키 없이 먼저 체험하려면 `args`에 `"--demo"`를 추가합니다. 모든 숫자가 합성 데이터로 바뀝니다.

설정을 저장한 뒤 클라이언트를 다시 시작하면 도구 목록에 빗썸 자산 도구가 표시됩니다.

## 인증 설정

시세 도구(`market_get_candles`, `market_get_tickers`·`market_get_warnings`의 `scope: all`)는 인증 없이 사용할 수 있습니다. 잔고·손익·주문·입출금 도구는 API Key가 필요합니다. [빗썸 API 관리](https://www.bithumb.com/react/api-support/management-api) 페이지에서 **조회 권한만** 있는 키를 발급하고 허용 IP를 설정하세요.

이 폴더에서 아래 명령을 한 번 실행하면 됩니다. 입력한 키는 화면에 보이지 않고 이 컴퓨터의 `~/.bithumb-asset-kit/credentials.json`(본인만 읽기 가능한 0600 권한)에만 저장됩니다. 설정 파일에 키를 넣을 필요가 없습니다.

```bash
node cli/asset-kit.js config init
node cli/asset-kit.js doctor
```

환경 변수를 쓰려면 `~/.zshrc` 등에 등록합니다. 환경 변수가 있으면 저장 파일보다 먼저 사용합니다.

```bash
export BITHUMB_ACCESS_KEY="발급받은_액세스_키"
export BITHUMB_SECRET_KEY="발급받은_시크릿_키"
```

키를 AI 채팅에 입력하지 마세요. MCP 도구는 키를 입력으로 받지 않으며, 키는 빗썸 API 요청 서명에만 쓰입니다. 조회한 계좌 데이터는 연결한 AI 서비스에서 처리될 수 있습니다.

## 정상 동작 확인

설정을 마쳤다면 아래 순서대로 연결 상태를 확인해보세요.

### 도구 목록 확인

클라이언트의 도구 패널에 `portfolio_get_summary`, `dashboard_open` 같은 도구가 보이면 정상적으로 연결된 상태입니다. 도구가 보이지 않는다면 아래 [문제 해결](#문제-해결) 항목을 참고하세요.

### 인증 없이 동작 확인

아래처럼 자연어로 요청해봅니다.

- “BTC 원화 시세 최근 30일 보여줘”
- “활성화된 모듈 뭐 있어?”

### 전체 상태 확인

`system_diagnose`를 호출하면 데모/실제 모드, 활성화된 모듈, 키 설정 여부와 출처(키 값은 표시하지 않음), 공개 시세·계좌 API 연결, 로컬 저장 위치를 한 번에 확인할 수 있습니다.

### 인증 동작 확인

API Key까지 정상 설정됐다면 아래 요청도 확인해봅니다.

- “내 자산 요약해줘”

## 사용 예시

MCP 도구는 자연어로 자유롭게 호출할 수 있습니다. 다음은 자주 쓰는 요청 패턴입니다.

**대화 속 대시보드** — 한 번 호출로 요약·비중·추이를 그립니다. MCP Apps 지원 클라이언트에서는 대화 안에 화면이 표시됩니다.

- “내 자산 대시보드 보여줘”
- “장기 보유 화면을 1년 추이로 보여줘”
- “일별 자산 변화까지 넣어서 이번 달 대시보드 그려줘”

**잔고·손익** — 보유 자산과 평가손익을 조회합니다.

- “내 빗썸 잔고와 평가손익 보여줘”
- “수익률 높은 순서로 코인별 손익 정리해줘”

**비중·추이** — 자산 구성과 평가금액 흐름을 봅니다.

- “자산 비중 알려줘”
- “최근 90일 자산 추이 보여줘”

**일별 자산 변화** — 날짜별 평가금액 변화를 달력처럼 봅니다.

- “이번 달 일별 자산 변화 알려줘”
- “BTC만 지난 7일 일별 자산 변화 보여줘”

**원화 시세·시장 흐름** — 공개 시세를 조회합니다(키 불필요).

- “ETH 현재가와 30일 일봉 보여줘”
- “BTC 1시간봉 24개를 시가·고가·저가까지 보여줘”
- “오늘 원화 마켓에서 많이 오른 코인 10개”
- “내 코인 중에 경보나 거래 유의 걸린 거 있어?”

**주문·입출금** — 기간을 정해 내역을 조회합니다. 주문·출금 실행은 하지 않습니다.

- “지난달 원화 입출금 내역 정리해줘”
- “9월 종료 주문 보여줘”
- “지금 대기 주문 있어?”

**종합 보고서** — 잔고와 최근 내역을 한 번에 정리합니다.

- “내 잔고와 최근 주문·입출금을 종합해서 보여줘”

**화면 설정** — 로컬 대시보드 화면을 만들고 엽니다. 저장과 열기는 한 번에 처리되고, 열려 있는 화면에도 바로 반영됩니다.

- “BTC·ETH만 묶은 대시보드 만들고 열어줘”
- “그 화면 기간을 1년으로 바꾸고 거래·입출금도 넣어줘”
- “XRP·SOL만 30초마다 갱신되는 화면을 하나 더 만들어줘”

## MCP 조회를 작게 나누기 (0.4.0)

기존 14개 도구 이름을 유지하며 필터, 필드 선택, 이어받기와 진행·취소를 추가했습니다. **`account_get_records`는 0.4.0부터 한 번에 전체 내역을 반환하지 않습니다.** 기본 최대 50건·거래소 5페이지를 읽고 `pagination.nextCursor`로 계속 조회합니다. HTTP 대시보드와 CLI `records`의 기존 수집 방식은 그대로입니다.

### 필요한 자산과 필드만 조회

먼저 `portfolio_get_summary`로 요약합니다. 세부 내역이 필요하면 `portfolio_get_holdings`의 `search`, `excludeCash`, `performance`(all/gain/loss/unknown), `sort`(value/profit/pnl/change/quantity/name), `direction`, `limit`, `offset`, `fields`를 사용합니다.

```json
{
  "symbols": ["BTC", "ETH", "XRP"],
  "performance": "gain",
  "sort": "pnl",
  "direction": "desc",
  "limit": 5,
  "fields": ["name", "valueKrw", "profitKrw", "profitRatePct"],
  "force": true
}
```

- `symbol`, `valuationStatus`, `staleQuote`와 응답의 `mode`, `asOf`, `scope`, `warnings`는 필드를 줄여도 유지합니다.
- `pagination.total`은 검색·필터 결과 수, `nextOffset`은 다음 위치입니다. 오프셋은 같은 `asOf`의 결과 안에서 사용하세요. 새 시세로 순서가 바뀌면 처음부터 조회합니다.
- 비중의 분모는 `symbols` 범위 전체입니다. 검색·손익 필터·페이지 제한으로 비중을 다시 계산하지 않습니다.
- 요약·보유 내역·비중·시세·보고서에 `force: true`를 주면 캐시를 건너뜁니다. 이미 진행 중인 공유 조회는 합쳐질 수 있습니다.
- `portfolio_get_history`의 `maxPoints`(2~400)는 첫·끝 기록을 보존하며 추이 응답을 줄입니다. `daily: true`에는 함께 쓰지 않습니다.
- `portfolio_get_report`의 `sections`로 필요한 내역만 호출합니다. 예: `{"sections":["krwDeposits"]}`. 빈 배열이면 내역 API 호출을 생략합니다. `symbols`는 이 보고서의 포트폴리오에만 적용되며, 내역 섹션은 계좌 전체의 첫 30건입니다.

### 기간 내역 이어받기

첫 `account_get_records` 호출:

```json
{"kind":"orders","from":"2026-10-01","to":"2026-10-26","symbols":["BTC"],"side":"bid","states":["done"],"pageSize":50,"scanPages":5,"fields":["volume","executed_funds","paid_fee"]}
```

`pagination.nextCursor`가 있으면 다음 호출에 그 값을 그대로 넣습니다.

```json
{"kind":"orders","cursor":"이전 응답의 nextCursor","fields":["volume","executed_funds","paid_fee"]}
```

- 첫 조회 기본값은 `pageSize=50`(최대 200), `scanPages=5`(최대 20)입니다. 필터에 맞는 행이 없어 `rows=[]`여도 `nextCursor`가 있으면 조회가 끝난 것이 아닙니다.
- 날짜·자산·상태·매수/매도·페이지 조건은 이어받는 동안 고정합니다. 생략하면 원래 값을 사용합니다. `fields`는 응답 표시용이므로 바꿀 수 있고 매 호출에 다시 지정합니다.
- `coverage.complete`는 이어받기 전체가 끝났는지 뜻합니다. `rows`와 `totals`는 **이번 응답에 반환한 행만** 포함합니다. 통화별 합계를 실현손익이나 전체 기간 합계로 해석하지 마세요.
- 주문은 생성 시각, 입출금은 완료 시각(없으면 생성 시각)으로 기간을 판정합니다. 입출금의 완료 시각순 정렬은 보장하지 않습니다. 거래소 내역이 도중에 바뀔 수 있어 원자적 스냅샷도 아닙니다.
- 토큰은 현재 MCP 프로세스에서만 유효하고 시작 후 10분간 유지됩니다. 최대 32개의 토큰을 보관하며 오래된 토큰은 먼저 해제합니다. 만료·재시작·해제 후에는 `CURSOR_EXPIRED`와 재조회 안내를 반환합니다.
- 한 조회는 최대 1,000개의 거래소 페이지·10,000개의 일치하는 고유 내역까지 처리합니다. `QUERY_LIMIT`이면 날짜나 자산 범위를 나누세요. 제한을 전체 조회 성공으로 표시하지 않습니다.
- 같은 첫 조회는 30초 캐시·동시 요청 병합을 사용합니다. 새 조회는 `cursor` 없이 `force:true`로 시작합니다. 성공한 cursor를 재호출하면 같은 페이지를 돌려주며, 오류·취소는 이어받기 위치를 전진시키지 않습니다.
- `order_id`/`uuid`, `at`, `market`/`currency`, `state`는 `fields`를 줄여도 유지합니다. `unknownTimestampRows`가 0보다 크면 날짜를 판정하지 못한 행이 있어 조회 완료로 표시하지 않습니다.

### 진행·취소와 오류 복구

클라이언트가 `tools/call`의 `_meta.progressToken`을 보내면 `notifications/progress`를 반환합니다. 수치는 단조 증가하는 진행 단계이며 전체 비율이 아닙니다. 내역을 조회할 때는 실제 읽은 페이지 수를 메시지에 표시합니다.

`notifications/cancelled`의 `requestId`로 진행 중인 호출을 취소합니다. 취소된 요청의 최종 응답은 보내지 않고 이후 진행 알림도 멈춥니다. 주문·입출금 요청은 HTTP 요청/재시도까지 중단합니다. 공유 중인 자산·시세 조회는 다른 호출에 필요할 수 있어 내부 계산이 완료될 수 있습니다. 같은 첫 내역 조회를 여러 호출이 공유하는 경우 마지막 구독자가 취소해야 공급자 요청도 중단됩니다.

도구 오류는 `isError:true`이며 텍스트 JSON에 `code`, `message`, `retryable`, `recovery`가 들어갑니다. 입력 오류에는 값 대신 `path`(예: `$.limit`)를 알려줍니다. 모든 도구는 `outputSchema`를 공개하고 성공 응답의 `structuredContent`와 텍스트 JSON에 같은 데이터를 반환합니다.

구현 기준: [MCP 도구 응답 규격](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [진행 알림](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress), [취소 알림](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation).

### 템플릿은 목록부터 확인

`dashboard_get_template({"manifest":true})`는 파일 경로·크기와 API 계약만 반환합니다. 필요한 파일은 `{"paths":["index.html"]}`처럼 요청합니다. 옵션 없는 기존 호출은 호환성을 위해 전체 텍스트를 반환합니다. 계좌 질문에 답할 때 템플릿을 가져올 필요는 없습니다.

## 대화 안에서 대시보드 그리기 (0.5.0)

“내 자산 대시보드 보여줘”처럼 화면을 그려 달라고 하면 AI는 `dashboard_snapshot`을 **한 번** 호출합니다. 요약·비중·추이·보유 상위 자산이 한 응답에 들어 있어, 요약·비중·추이 도구를 따로 부를 필요가 없습니다.

```json
{ "boardId": "34eb9587-…", "days": 90, "top": 5, "points": 60, "daily": false }
```

모든 입력은 선택입니다. `boardId`를 주면 그 보드의 자산 범위·기간을 기본값으로 쓰고, `symbols`·`days`를 함께 주면 그 값이 우선합니다.

```json
{
  "mode": "demo", "asOf": "2026-10-26T07:52:58.497Z", "scope": [],
  "summary": { "totalValueKrw": "28074000", "profitKrw": "2594000", "profitRatePct": "11.4374", "valuationComplete": true, "…": "…" },
  "holdings": [{ "symbol": "BTC", "name": "비트코인", "valueKrw": "13550000", "allocationPct": "48.2653", "profitKrw": "2050000", "…": "…" }],
  "others": { "count": 2, "valueKrw": "4704000", "allocationPct": "16.7557", "unpriced": 0 },
  "trend": { "days": 30, "at": ["2026-09-27T…", "…"], "valueKrw": ["24857503", "…"], "firstKrw": "24857503", "lastKrw": "28074000", "changeKrw": "3216497", "omitted": 0, "sampled": false }
}
```

- `holdings`는 평가금액 상위 `top`개(기본 5), 나머지는 `others` 한 조각입니다. 상위 자산과 `others`의 금액 합은 `summary.totalValueKrw`와 정확히 같습니다.
- `trend`는 같은 위치끼리 짝인 열 배열입니다. 기간 안의 모든 기록에서 가격 미확인 시점을 먼저 빼고(`omitted`에 개수) 기본 60점으로 줄이므로, 첫·마지막 기록과 `changeKrw`가 정확합니다. 나머지가 모두 가격 미확인이면 `others`의 금액·비중은 `null`입니다.
- `daily: true`이면 일별 자산 변화(`day`·`changeKrw`·`changePct`·`gapDays` 열 배열)를 함께 반환합니다.

데모 계좌 기준 응답 크기(UTF-8)는 다음과 같습니다. 실제 계좌의 30일 추이는 5분 기록이 쌓여 최대 400점(약 35KB)까지 커지므로 차이가 더 큽니다.

| 그리는 방법 | 호출 수 | 응답 크기 |
| --- | --- | --- |
| summary + allocation + holdings + history(30일) | 4 | 약 7.2KB |
| `dashboard_snapshot`(30일) | 1 | 약 2.9KB |
| `portfolio_get_history`(365일) | 1 | 약 32KB |
| `dashboard_snapshot`(365일) | 1 | 약 4.1KB |

**MCP Apps를 지원하는 클라이언트**(Claude, ChatGPT, VS Code 등)에서는 `dashboard_snapshot` 결과가 대화 안에 대시보드 화면으로 그려집니다. 도구 정의의 `_meta.ui.resourceUri`가 가리키는 `ui://bithumb-asset-kit/dashboard.html` 리소스(`text/html;profile=mcp-app`)를 클라이언트가 읽어 표시합니다. 화면에서 기간(7·30·90일·1년)을 바꾸거나 새로고침하면 같은 도구를 다시 호출하고, ‘로컬 대시보드 열기’는 `dashboard_open`으로 이 보드가 선택된 로컬 주소를 엽니다. `--read-only`처럼 `dashboard_open`이 꺼져 있으면 이 버튼은 숨겨지고, 클라이언트가 링크 열기를 거부하면 주소를 대신 보여 줍니다. 화면은 외부 파일·네트워크를 쓰지 않고 클라이언트와 메시지로만 통신하며, 금액 숨기기와 거래 유의 자산 ‘유의’ 표시를 지원합니다. 지원하지 않는 클라이언트는 같은 데이터를 JSON으로 받습니다.

## 대시보드 만들기

“BTC·ETH만 묶은 대시보드 만들고 열어줘”라고 요청하면 AI가 아래 순서로 도구를 호출합니다.

**1. 연결 확인** — `system_diagnose`로 모드와 키 설정을 확인합니다.

**2. 저장하고 띄우기** — `dashboard_save_board`에 `open: true`를 붙이면 저장과 화면 띄우기를 한 번에 합니다.

```json
{
  "name": "BTC·ETH 장기 보유",
  "symbols": ["BTC", "ETH"],
  "widgets": ["summary", "trend", "allocation", "holdings"],
  "days": 90,
  "open": true
}
```

응답으로 화면의 `id`·`revision`과, 이 보드가 선택된 로컬 주소 `url`을 돌려줍니다.

```json
{ "id": "34eb9587-…", "revision": 1, "name": "BTC·ETH 장기 보유", "symbols": ["BTC", "ETH"], "widgets": ["summary", "trend", "allocation", "holdings"], "days": 90, "refreshSeconds": 60, "url": "http://127.0.0.1:4319/?board=34eb9587-…" }
```

AI가 알려준 주소를 브라우저로 열면 저장한 보드 탭이 선택된 상태로 나타납니다. 기본 ‘내 자산’(원화 포함 전체) 화면은 항상 함께 있습니다. 이미 떠 있는 화면만 다시 열 때는 `dashboard_open`을 쓰고, `boardId`를 주면 그 보드가 선택된 주소를 받습니다.

**3. 고치기** — `dashboard_list_boards`로 `id`와 `revision`을 확인한 뒤 바꿀 값만 보냅니다. 보내지 않은 값은 그대로 유지됩니다. 브라우저에 이미 열려 있는 대시보드는 몇 초 안에(다른 탭에서 돌아오면 바로) 바뀐 보드를 반영합니다.

```json
{ "id": "34eb9587-…", "revision": 1, "days": 365, "widgets": ["summary", "trend", "allocation", "holdings", "activity"] }
```

화면 설정 항목은 다음과 같습니다.

| 항목 | 값 | 기본값 |
| --- | --- | --- |
| `name` | 화면 이름(1~48자) | 필수 |
| `symbols` | 표시할 자산. 빈 배열이면 원화 포함 전체 | `[]` |
| `widgets` | `summary`(자산 요약), `trend`(자산 추이·일별 자산 변화), `allocation`(자산 비중), `holdings`(보유 내역·자산별 30일 시세), `activity`(거래·입출금). 배열 순서가 화면 순서 | 5개 모두 |
| `days` | 추이 기간 7, 30, 90, 365 | 30 |
| `refreshSeconds` | 자동 갱신 0(수동), 30, 60, 300 | 60 |

화면 구성 자체를 새로 만들려면 `dashboard_get_template`에 `manifest:true`로 목록을 확인한 뒤 `paths`로 필요한 HTML·CSS·JS를 받아 고칩니다. `node cli/asset-kit.js dashboard --web-dir <폴더>`로 띄웁니다.

## 기능 모듈

MCP 서버는 다음 기능 모듈로 도구를 제공합니다. 활성화된 모듈에 속한 도구만 클라이언트의 도구 패널에 표시됩니다. 주문·취소·출금 도구는 없습니다. 거래가 필요하면 [빗썸 공식 MCP](https://apidocs.bithumb.com/docs/mcp)를 사용하세요.

### Portfolio

잔고·평가손익·비중·추이·일별 자산 변화와 종합 보고서를 조회합니다. `symbols`로 일부 자산만 묶어 볼 수 있습니다.

| 도구 | 설명 |
| --- | --- |
| `portfolio_get_summary` | 총 평가금액·보유분 평가손익·비중 상위 자산·데이터 누락 여부 |
| `portfolio_get_holdings` | 자산별 가용·주문 중 수량, 평균 매수가, 현재가, 평가금액, 손익 |
| `portfolio_get_allocation` | 원화 포함 자산 비중 |
| `portfolio_get_history` | 기록된 평가금액 추이(최대 400개 지점). `daily: true`이면 일별 자산 변화 |
| `portfolio_get_report` | 잔고 + 대기·최근 주문, 원화·코인 입출금 첫 페이지 종합 |

### Market: 인증 불필요

공개 시세 데이터를 조회합니다.

| 도구 | 설명 |
| --- | --- |
| `market_get_candles` | 원화 마켓 현재가와 캔들 1~200개. `interval`: `1m`·`3m`·`5m`·`10m`·`15m`·`30m`·`1h`·`4h`·`day`·`week`·`month`. 기본은 종가만, `ohlc: true`면 시가·고가·저가·거래량, `to`로 더 과거 구간 |
| `market_get_tickers` | 보유 자산(`scope: holdings`, 키 필요) 또는 원화 마켓 전체(`all`)의 현재가·전일 대비·24시간 거래대금. `sort`: `value24h`·`change`·`price`·`name` |
| `market_get_warnings` | 빗썸 경보제(가격 급등락·거래량 급등·글로벌 시세 차이 등, 주의·경고·위험)와 거래 유의 종목. 보유 자산만 또는 전체 |

### Account

주문·입출금 내역을 조회합니다. 실행 기능은 없습니다.

| 도구 | 설명 |
| --- | --- |
| `account_get_records` | 기간 내역을 제한된 크기로 조회하고 `pagination.nextCursor`로 이어받기(최대 366일, 한국 시간). `kind`: `orders`, `pending`, `deposits`, `withdrawals`, `krw_deposits`, `krw_withdrawals` |
| `account_get_orders` | 대기·종료 주문 한 페이지(종료 주문은 최대 7일 구간) |
| `account_get_transfers` | 원화·코인 입금·출금 한 페이지 |

### Dashboard

대시보드를 그릴 데이터를 한 번에 조회하고, 화면 설정을 이 컴퓨터에 저장하고, 로컬 대시보드를 띄웁니다.

| 도구 | 설명 |
| --- | --- |
| `dashboard_snapshot` | 요약·비중 상위·추이(열 배열)·선택 시 일별 변화를 한 번에. MCP Apps 클라이언트에서는 대화 안에 화면 표시 |
| `dashboard_list_boards` | 화면 설정 목록 |
| `dashboard_save_board` | 화면 설정 생성·수정. `open: true`이면 저장 후 화면을 띄우고 보드 주소 반환 |
| `dashboard_open` | 로컬 대시보드 실행, 주소 반환. `boardId`로 처음 선택할 보드 지정 |
| `dashboard_get_template` | 화면 HTML·CSS·JS와 API 계약 |

### System

설정 진단 정보를 제공합니다. 항상 활성화됩니다.

| 도구 | 설명 |
| --- | --- |
| `system_diagnose` | 설정 진단(모드·모듈·인증·API 키 만료일·API 연결·저장 위치). 키 만료 14일 이내면 `warnings`에 안내 |

## 실행 옵션

옵션은 클라이언트 설정 파일의 `args` 배열에 추가해서 사용합니다.

```json
{
  "command": "node",
  "args": ["/absolute/path/to/asset_kit/mcp/index.js", "--modules", "portfolio,market", "--read-only"]
}
```

| 옵션 | 설명 | 기본값 |
| --- | --- | --- |
| `--modules <list>` | 사용할 모듈 목록(`portfolio`, `market`, `account`, `dashboard` 쉼표 구분 또는 `all`). `system`은 항상 포함 | `all` |
| `--read-only` | 화면 설정 저장·화면 띄우기 도구도 끄는 완전 조회 모드 | `false` |
| `--demo` | 합성 데이터 사용(키 불필요) | `false` |
| `--env-file <path>` | 키를 `.env` 파일에서 읽기 | — |
| `--verbose` | 도구 호출 기록을 stderr에 출력 | `false` |
| `--help` | 도움말 출력 | — |
| `--version` | 버전 출력 | — |

### 모듈 단위 노출

시세 조회만 활성화:

```json
"args": ["/absolute/path/to/asset_kit/mcp/index.js", "--modules", "market"]
```

자산과 내역 조회만 활성화하고 화면 저장도 차단:

```json
"args": ["/absolute/path/to/asset_kit/mcp/index.js", "--modules", "portfolio,account", "--read-only"]
```

합성 데이터로 전체 기능 체험:

```json
"args": ["/absolute/path/to/asset_kit/mcp/index.js", "--demo"]
```

## 문제 해결

### 상세 로깅

`args`에 `--verbose`를 추가하면 도구 이름, 결과 코드, 소요 시간, 입력값이 stderr로 표시됩니다. 키는 기록되지 않습니다.

### 도구가 클라이언트에 보이지 않을 때

1. 설정 파일 저장 후 클라이언트를 완전히 재시작합니다.
2. 터미널에서 `node /absolute/path/to/asset_kit/mcp/index.js --version`으로 실행되는지 확인합니다.
3. Claude Desktop 같은 앱이 `node`를 찾지 못하면 `which node` 결과의 절대 경로를 `command`에 넣습니다.
4. `node cli/asset-kit.js doctor`로 인증·네트워크 상태를 점검합니다.
5. 클라이언트 로그에서 MCP 서버 시작 오류를 확인합니다.

### 대시보드 주소가 열리지 않을 때

`dashboard_open`으로 띄운 화면은 MCP 서버가 실행 중일 때만 열립니다. 클라이언트를 닫으면 함께 종료됩니다. 계속 띄워 두려면 이 폴더에서 `npm start`(실제 계좌) 또는 `npm run demo`를 실행합니다.

### 추이나 일별 자산 변화가 비어 있을 때

평가금액 기록은 자산을 조회할 때마다(최대 5분에 한 번) 이 컴퓨터에 쌓입니다. 과거를 소급해 만들지 않으므로 두 번 이상 기록된 뒤부터 표시됩니다.

## 환경 변수

| 변수 | 설명 | 기본값 |
| --- | --- | --- |
| `BITHUMB_ACCESS_KEY` | 조회용 Access Key. 설정하면 `config init` 저장 파일보다 우선 | — |
| `BITHUMB_SECRET_KEY` | 조회용 Secret Key | — |
| `ASSET_KIT_DATA_DIR` | 평가금액 기록·화면 설정·키 파일 저장 위치(폴더 0700, 파일 0600) | `~/.bithumb-asset-kit` |

## 공식 SDK로 검증하기

일반 테스트는 `npm test`이며 외부 패키지가 필요 없습니다. 공식 MCP SDK 호환성 테스트만 별도 임시 폴더에 SDK를 설치해 실행합니다. 테스트는 합성 데이터와 임시 저장 폴더를 사용합니다.

```bash
npm install --prefix /tmp/asset-kit-sdk-check --no-save --ignore-scripts @modelcontextprotocol/sdk@1.32.2
MCP_SDK_ROOT=/tmp/asset-kit-sdk-check/node_modules/@modelcontextprotocol/sdk npm run verify:mcp-sdk
```

검증 스크립트: [`scripts/verify-mcp-sdk.mjs`](../scripts/verify-mcp-sdk.mjs). 실제 stdio 프로세스 연결, 17개 도구의 출력 스키마, MCP Apps 화면 리소스, 필드 선택·강제 갱신, 진행 알림, 이어받기 재호출, SDK의 AbortSignal을 통한 공급자 취소와 취소 후 ping을 확인합니다. 실제 계좌 키 연동 검증과는 별개입니다.

## 더 알아보기

- [CLI](../cli/asset-kit.js) — 터미널에서 `node cli/asset-kit.js --help`로 같은 기능을 실행합니다.
- [Skills](../skills/bithumb-asset-dashboard/SKILL.md) — AI 에이전트가 조회부터 대시보드 만들기까지 순서대로 처리하도록 안내합니다.
- [시작하기](../README.md) — 전체 구성과 대시보드 사용법을 안내합니다.
