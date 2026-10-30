// 금액·수량용 십진수. BigInt로 더하기·빼기·곱하기를 정확히 하고, 나눗셈과 자릿수 지정만 반올림(0.5는 0에서 먼 쪽)합니다.
const PATTERN = /^([+-])?(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i;
const pow10 = n => 10n ** BigInt(n);
const roundDiv = (numerator, denominator) => {
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const negative = numerator < 0n, abs = negative ? -numerator : numerator;
  let quotient = abs / denominator;
  if ((abs % denominator) * 2n >= denominator) quotient++;
  return negative ? -quotient : quotient;
};

export class Dec {
  constructor(units, scale) { this.units = units; this.scale = scale; } // 값 = units / 10^scale
  static from(value) {
    if (value instanceof Dec) return value;
    const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value ?? '').trim();
    const match = PATTERN.exec(text);
    if (!match) throw new TypeError(`십진수가 아닙니다: ${text}`);
    const [, sign, integer, fraction = '', exponent = '0'] = match;
    let units = BigInt(integer + fraction), scale = fraction.length - Number(exponent);
    if (scale < 0) { units *= pow10(-scale); scale = 0; }
    return new Dec(sign === '-' ? -units : units, scale);
  }
  #align(other) {
    const b = Dec.from(other), scale = Math.max(this.scale, b.scale);
    return [this.units * pow10(scale - this.scale), b.units * pow10(scale - b.scale), scale];
  }
  plus(other) { const [a, b, scale] = this.#align(other); return new Dec(a + b, scale); }
  minus(other) { const [a, b, scale] = this.#align(other); return new Dec(a - b, scale); }
  times(other) { const b = Dec.from(other); return new Dec(this.units * b.units, this.scale + b.scale); }
  /** this ÷ other, 소수 `places`자리까지 반올림. */
  div(other, places) {
    const b = Dec.from(other);
    if (b.units === 0n) throw new RangeError('0으로 나눌 수 없습니다.');
    return new Dec(roundDiv(this.units * pow10(b.scale + places), b.units * pow10(this.scale)), places);
  }
  cmp(other) { const [a, b] = this.#align(other); return a > b ? 1 : a < b ? -1 : 0; }
  gt(other) { return this.cmp(other) > 0; }
  isZero() { return this.units === 0n; }
  /** places 자리 고정 표기. 생략하면 뒤쪽 0 없이 정확한 값을 표기합니다. */
  toFixed(places) {
    let { units, scale } = this;
    if (places === undefined) while (scale > 0 && units % 10n === 0n) { units /= 10n; scale--; }
    else if (places < scale) { units = roundDiv(units, pow10(scale - places)); scale = places; }
    else if (places > scale) { units *= pow10(places - scale); scale = places; }
    const negative = units < 0n, digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
    const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
    return negative && /[1-9]/.test(text) ? `-${text}` : text;
  }
  toNumber() { return Number(this.toFixed()); }
}
export const dec = value => Dec.from(value);
