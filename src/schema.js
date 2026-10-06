import { KitError } from './errors.js';

/**
 * 작은 JSON Schema 검사기(type, enum, pattern, 길이·범위, items, properties, required, additionalProperties:false, default, nullable, anyOf).
 * 같은 스키마를 MCP 도구 입력 스키마로 공개하고 CLI·HTTP·MCP 입력과 빗썸 응답 검사에 함께 씁니다. 선언하지 않은 응답 필드는 버립니다.
 */
export function check(schema, value, { code = 'INVALID_QUERY', message = '입력값을 확인하세요.', status = 400 } = {}) {
  const fail = () => { throw new KitError(code, message, status); };
  const walk = (s, v) => {
    if (v === undefined) return 'default' in s ? structuredClone(s.default) : undefined;
    if (v === null && s.nullable) return null;
    if (s.anyOf) {
      for (const option of s.anyOf) { try { return walk(option, v); } catch { /* 다음 후보 */ } }
      return fail();
    }
    if (s.enum && !s.enum.includes(v)) fail();
    switch (s.type) {
      case 'string':
        if (typeof v !== 'string' || v.length < (s.minLength ?? 0) || v.length > (s.maxLength ?? Infinity) || (s.pattern && !new RegExp(s.pattern).test(v))) fail();
        return v;
      case 'integer':
        if (!Number.isInteger(v)) fail();
        // falls through: integer도 number 범위 검사를 거칩니다.
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v) || v < (s.minimum ?? -Infinity) || v > (s.maximum ?? Infinity)) fail();
        return v;
      case 'boolean':
        if (typeof v !== 'boolean') fail();
        return v;
      case 'array': {
        if (!Array.isArray(v) || v.length < (s.minItems ?? 0) || v.length > (s.maxItems ?? Infinity)) fail();
        const items = v.map(item => walk(s.items ?? {}, item));
        if (s.uniqueItems && new Set(items).size !== items.length) fail();
        return items;
      }
      case 'object': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) fail();
        const properties = s.properties ?? {}, out = {};
        if (s.additionalProperties === false && Object.keys(v).some(key => !(key in properties))) fail();
        for (const [key, sub] of Object.entries(properties)) { const item = walk(sub, v[key]); if (item !== undefined) out[key] = item; }
        if ((s.required ?? []).some(key => out[key] === undefined)) fail();
        return out;
      }
      default:
        return v;
    }
  };
  return walk(schema, value);
}

export const DECIMAL = { type: 'string', pattern: '^\\d+(\\.\\d+)?$' };
export const SYMBOL = { type: 'string', pattern: '^[A-Z0-9][A-Z0-9_]{0,29}$' };
export const MARKET = { type: 'string', pattern: '^[A-Z0-9_]+-[A-Z0-9_]+$' };
/** 도구 입력용: 소문자도 받고 서비스에서 대문자로 바꿉니다. */
export const SYMBOLS_INPUT = { type: 'array', maxItems: 100, items: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_]{0,29}$' }, description: '선택: ["BTC","ETH"]처럼 범위를 좁힐 자산 심볼. 생략하면 원화 포함 전체 계좌' };
