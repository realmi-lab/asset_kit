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

시세 도구(`market_get_candles`)는 인증 없이 사용할 수 있습니다. 잔고·손익·주문·입출금 도구는 API Key가 필요합니다. [빗썸 API 관리](https://www.bithumb.com/react/api-support/management-api) 페이지에서 **조회 권한만** 있는 키를 발급하고 허용 IP를 설정하세요.

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

**잔고·손익** — 보유 자산과 평가손익을 조회합니다.

- “내 빗썸 잔고와 평가손익 보여줘”
- “수익률 높은 순서로 코인별 손익 정리해줘”

**비중·추이** — 자산 구성과 평가금액 흐름을 봅니다.

- “자산 비중 알려줘”
- “최근 90일 자산 추이 보여줘”

**일별 자산 변화** — 날짜별 평가금액 변화를 달력처럼 봅니다.

- “이번 달 일별 자산 변화 알려줘”
- “BTC만 지난 7일 일별 자산 변화 보여줘”

**원화 시세** — 공개 시세를 조회합니다(키 불필요).

- “ETH 현재가와 30일 일봉 보여줘”

**주문·입출금** — 기간을 정해 내역을 조회합니다. 주문·출금 실행은 하지 않습니다.

- “지난달 원화 입출금 내역 정리해줘”
- “9월 종료 주문 보여줘”
- “지금 대기 주문 있어?”

**종합 보고서** — 잔고와 최근 내역을 한 번에 정리합니다.

- “내 잔고와 최근 주문·입출금을 종합해서 보여줘”

**화면 설정** — 대시보드를 만들고 엽니다.

- “BTC·ETH만 묶은 대시보드 만들고 열어줘”
- “그 화면 기간을 1년으로 바꾸고 거래·입출금도 넣어줘”

## 대시보드 만들기

“BTC·ETH만 묶은 대시보드 만들고 열어줘”라고 요청하면 AI가 아래 순서로 도구를 호출합니다.

**1. 연결 확인** — `system_diagnose`로 모드와 키 설정을 확인합니다.

**2. 화면 저장** — `dashboard_save_board`

```json
{
  "name": "BTC·ETH 장기 보유",
  "symbols": ["BTC", "ETH"],
  "widgets": ["summary", "trend", "allocation", "holdings"],
  "days": 90
}
```

응답으로 화면의 `id`와 `revision`을 돌려줍니다.

```json
{ "id": "34eb9587-…", "revision": 1, "name": "BTC·ETH 장기 보유", "symbols": ["BTC", "ETH"], "widgets": ["summary", "trend", "allocation", "holdings"], "days": 90, "refreshSeconds": 60 }
```

**3. 화면 띄우기** — `dashboard_open`(인수 없음). MCP 서버 안에서 로컬 대시보드를 띄우고 주소를 돌려줍니다.

```json
{ "url": "http://127.0.0.1:4319", "mode": "demo", "boards": [{ "name": "내 자산" }, { "name": "BTC·ETH 장기 보유", "symbols": ["BTC", "ETH"] }] }
```

AI가 알려준 주소를 브라우저로 열면 저장한 화면이 위쪽 탭에 나타납니다. 기본 ‘내 자산’(원화 포함 전체) 화면은 항상 함께 있습니다.

**4. 고치기** — `dashboard_list_boards`로 `id`와 `revision`을 확인한 뒤 바꿀 값만 보냅니다. 보내지 않은 값은 그대로 유지됩니다.

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

화면 구성 자체를 새로 만들려면 `dashboard_get_template`으로 HTML·CSS·JS를 받아 고친 뒤 `node cli/asset-kit.js dashboard --web-dir <폴더>`로 띄웁니다.

## 기능 모듈

MCP 서버는 다음 기능 모듈로 도구를 제공합니다. 활성화된 모듈에 속한 도구만 클라이언트의 도구 패널에 표시됩니다. 주문·취소·출금 도구는 없습니다. 거래가 필요하면 [빗썸 공식 MCP](https://apidocs.bithumb.com/docs/mcp)를 사용하세요.

### Portfolio

잔고·평가손익·비중·추이·일별 자산 변화과 종합 보고서를 조회합니다. `symbols`로 일부 자산만 묶어 볼 수 있습니다.

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
| `market_get_candles` | 원화 마켓 현재가와 일봉 종가(1~200일) |

### Account

주문·입출금 내역을 조회합니다. 실행 기능은 없습니다.

| 도구 | 설명 |
| --- | --- |
| `account_get_records` | 주문·입출금 한 종류를 기간 전체 조회(최대 366일, 한국 시간). `kind`: `orders`, `pending`, `deposits`, `withdrawals`, `krw_deposits`, `krw_withdrawals` |
| `account_get_orders` | 대기·종료 주문 한 페이지(종료 주문은 최대 7일 구간) |
| `account_get_transfers` | 원화·코인 입금·출금 한 페이지 |

### Dashboard

대시보드 화면 설정을 이 컴퓨터에 저장하고 로컬 대시보드를 띄웁니다.

| 도구 | 설명 |
| --- | --- |
| `dashboard_list_boards` | 화면 설정 목록 |
| `dashboard_save_board` | 화면 설정 생성·수정 |
| `dashboard_open` | 로컬 대시보드 실행, 주소 반환 |
| `dashboard_get_template` | 화면 HTML·CSS·JS와 API 계약 |

### System

설정 진단 정보를 제공합니다. 항상 활성화됩니다.

| 도구 | 설명 |
| --- | --- |
| `system_diagnose` | 설정 진단(모드·모듈·인증·API 연결·저장 위치) |

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

### 추이나 일별 자산 변화이 비어 있을 때

평가금액 기록은 자산을 조회할 때마다(최대 5분에 한 번) 이 컴퓨터에 쌓입니다. 과거를 소급해 만들지 않으므로 두 번 이상 기록된 뒤부터 표시됩니다.

## 환경 변수

| 변수 | 설명 | 기본값 |
| --- | --- | --- |
| `BITHUMB_ACCESS_KEY` | 조회용 Access Key. 설정하면 `config init` 저장 파일보다 우선 | — |
| `BITHUMB_SECRET_KEY` | 조회용 Secret Key | — |
| `ASSET_KIT_DATA_DIR` | 평가금액 기록·화면 설정·키 파일 저장 위치(폴더 0700, 파일 0600) | `~/.bithumb-asset-kit` |

## 더 알아보기

- [CLI](../cli/asset-kit.js) — 터미널에서 `node cli/asset-kit.js --help`로 같은 기능을 실행합니다.
- [Skills](../skills/bithumb-asset-dashboard/SKILL.md) — AI 에이전트가 조회부터 대시보드 만들기까지 순서대로 처리하도록 안내합니다.
- [시작하기](../README.md) — 전체 구성과 대시보드 사용법을 안내합니다.
