import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KitError } from './errors.js';
import { dataDir } from './config.js';
import { check, SYMBOLS_INPUT } from './schema.js';

export const WIDGETS = ['summary', 'trend', 'insights', 'allocation', 'heatmap', 'performance', 'holdings', 'market', 'warnings', 'activity'];
// 새 보드의 기본 구성입니다. 나머지 위젯은 화면 편집이나 dashboard_save_board로 고릅니다.
export const DEFAULT_WIDGETS = ['summary', 'trend', 'insights', 'allocation', 'holdings', 'activity'];
export const PERIODS = [7, 30, 90, 365];
export const REFRESH_SECONDS = [0, 30, 60, 300];
const MAX_BOARDS = 50;

/** 대시보드 화면 설정(보드) 필드. 웹 API·CLI·MCP가 같은 규칙을 씁니다. */
export const BOARD_FIELDS = {
  name: { type: 'string', minLength: 1, maxLength: 48, description: '화면 이름' },
  symbols: { ...SYMBOLS_INPUT, default: [], description: '표시할 자산. 빈 배열이면 원화 포함 전체' },
  widgets: { type: 'array', minItems: 1, maxItems: WIDGETS.length, uniqueItems: true, items: { type: 'string', enum: WIDGETS }, default: [...DEFAULT_WIDGETS], description: '배열 순서가 화면 순서' },
  days: { type: 'integer', enum: PERIODS, default: 30, description: '추이 기간(일)' },
  refreshSeconds: { type: 'integer', enum: REFRESH_SECONDS, default: 60, description: '자동 갱신(초), 0은 수동' },
};

export function validateBoard(input) {
  const { name, symbols, widgets, days, refreshSeconds } = input ?? {};
  const board = check({ type: 'object', required: ['name'], properties: BOARD_FIELDS }, {
    name: typeof name === 'string' ? name.trim() : name,
    symbols: Array.isArray(symbols) ? symbols.map(symbol => typeof symbol === 'string' ? symbol.trim().toUpperCase() : symbol) : symbols,
    widgets, days, refreshSeconds,
  }, { code: 'INVALID_BOARD', message: '대시보드 설정을 확인하세요. 이름 1~48자, 지원하는 위젯 1개 이상(중복 없음), 자산 심볼 최대 100개, 기간 7/30/90/365일, 갱신 0/30/60/300초입니다.' });
  return { ...board, symbols: [...new Set(board.symbols)] };
}

/** Saved dashboard layouts per account, in one JSON file written atomically with owner-only permissions. */
export class BoardStore {
  #queue = Promise.resolve();
  constructor({ directory = dataDir(), accountId = 'demo', mode = 'live' } = {}) {
    this.file = join(directory, mode, mode === 'demo' ? 'demo' : accountId, 'boards.json');
  }
  // Serializes read-modify-write cycles within this process; revisions catch edits from other processes.
  #exclusive(task) {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => {});
    return run;
  }
  async #read() {
    let text;
    try { text = await readFile(this.file, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new KitError('BOARDS_READ_FAILED', '대시보드 설정 파일을 읽지 못했습니다.', 500);
    }
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data.boards)) throw new Error('shape');
      return data.boards;
    } catch { throw new KitError('BOARDS_INVALID', '대시보드 설정 파일이 손상되었습니다. 파일을 확인하거나 이름을 바꾼 뒤 다시 실행하세요.', 500); }
  }
  async #write(boards) {
    const directory = join(this.file, '..'), temp = `${this.file}.${randomUUID()}`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temp, `${JSON.stringify({ schemaVersion: 1, boards }, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, this.file);
      await chmod(this.file, 0o600);
    } catch { throw new KitError('BOARDS_WRITE_FAILED', '대시보드 설정을 저장하지 못했습니다.', 500); }
    return boards;
  }
  #entry(input) { return { id: randomUUID(), revision: 1, ...validateBoard(input), updatedAt: new Date().toISOString() }; }

  // 처음이면 기본 '내 자산' 화면을 앞에 둡니다. 화면에서 열든 MCP로 먼저 저장하든 결과가 같습니다.
  async #boards() {
    const boards = await this.#read();
    return boards.length ? { boards, fresh: false } : { boards: [this.#entry({ name: '내 자산' })], fresh: true };
  }
  list() {
    return this.#exclusive(async () => {
      const { boards, fresh } = await this.#boards();
      return fresh ? this.#write(boards) : boards;
    });
  }
  create(input) {
    return this.#exclusive(async () => {
      const { boards } = await this.#boards();
      if (boards.length >= MAX_BOARDS) throw new KitError('BOARD_LIMIT', `대시보드는 최대 ${MAX_BOARDS}개까지 저장할 수 있습니다.`, 400);
      const board = this.#entry(input);
      await this.#write([...boards, board]);
      return board;
    });
  }
  update(id, input, revision) {
    return this.#exclusive(async () => {
      const boards = await this.#read();
      const index = boards.findIndex(board => board.id === id);
      if (index < 0) throw new KitError('BOARD_NOT_FOUND', '대시보드를 찾을 수 없습니다. 목록을 다시 불러오세요.', 404);
      if (boards[index].revision !== revision) throw new KitError('CONFLICT', '다른 창에서 설정이 바뀌었습니다. 다시 불러온 뒤 저장하세요.', 409);
      const board = { ...boards[index], ...validateBoard(input), revision: revision + 1, updatedAt: new Date().toISOString() };
      boards[index] = board;
      await this.#write(boards);
      return board;
    });
  }
  remove(id, revision) {
    return this.#exclusive(async () => {
      const boards = await this.#read();
      const board = boards.find(item => item.id === id);
      if (!board) throw new KitError('BOARD_NOT_FOUND', '대시보드를 찾을 수 없습니다. 목록을 다시 불러오세요.', 404);
      if (boards.length <= 1) throw new KitError('LAST_BOARD', '대시보드는 최소 한 개가 필요합니다.', 400);
      if (board.revision !== revision) throw new KitError('CONFLICT', '다른 창에서 설정이 바뀌었습니다. 다시 불러온 뒤 삭제하세요.', 409);
      await this.#write(boards.filter(item => item.id !== id));
      return { deleted: id };
    });
  }
  /** Validates every item first, then appends all of them as new boards in one write. */
  importMany(list) {
    return this.#exclusive(async () => {
      if (!Array.isArray(list) || !list.length || list.length > MAX_BOARDS) throw new KitError('INVALID_BOARD', `1~${MAX_BOARDS}개의 대시보드 설정 배열이 필요합니다.`, 400);
      const created = list.map(item => this.#entry(item));
      const { boards } = await this.#boards();
      if (boards.length + created.length > MAX_BOARDS) throw new KitError('BOARD_LIMIT', `대시보드는 최대 ${MAX_BOARDS}개까지 저장할 수 있습니다.`, 400);
      await this.#write([...boards, ...created]);
      return created;
    });
  }
}
