export type ParsedRecoveryValue = Record<string, unknown> | unknown[];

export type RecoveryValueParseResult =
  | { kind: 'absent' }
  | { kind: 'parsed'; value: unknown }
  | { kind: 'unparsed'; value: string };

export function parseRecoveryValue(value: string | null): RecoveryValueParseResult {
  if (typeof value !== 'string') return { kind: 'absent' };
  const text = value.trim();
  if (text === 'nil') return { kind: 'unparsed', value: 'nil' };

  const structured = (text.startsWith('{') && text.endsWith('}'))
    || (text.startsWith('[') && text.endsWith(']'));
  if (structured) {
    try {
      return { kind: 'parsed', value: new PythonLikeValueParser(text).parse() };
    } catch {
      return { kind: 'unparsed', value };
    }
  }

  if (/^(true|false)$/i.test(text)) return { kind: 'parsed', value: text.toLowerCase() === 'true' };
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return { kind: 'parsed', value: parseJsonNumber(text) };
  return { kind: 'unparsed', value };
}

export function parseStructuredRecoveryValue(value: string | null): ParsedRecoveryValue | null {
  const result = parseRecoveryValue(value);
  if (result.kind !== 'parsed') return null;
  return isJsonContainer(result.value) ? result.value : null;
}

export function isJsonContainer(value: unknown): value is ParsedRecoveryValue {
  return typeof value === 'object' && value !== null;
}

class PythonLikeValueParser {
  private index = 0;

  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  parse(): unknown {
    const value = this.parseValue();
    this.skipWhitespace();
    if (!this.isAtEnd()) throw new Error('Unexpected trailing text');
    return value;
  }

  private parseValue(): unknown {
    this.skipWhitespace();
    const char = this.peek();
    if (char === '{') return this.parseObject();
    if (char === '[') return this.parseArray();
    if (char === '"' || char === "'") return this.parseString();
    return this.parseAtom();
  }

  private parseObject(): Record<string, unknown> {
    this.expect('{');
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    while (true) {
      this.skipWhitespace();
      if (this.peek() === '}') {
        this.index += 1;
        return result;
      }
      const key = String(this.parseValue());
      this.skipWhitespace();
      this.expect(':');
      Object.defineProperty(result, key, {
        value: this.parseValue(),
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.index += 1;
        continue;
      }
      if (this.peek() === '}') continue;
      throw new Error('Expected object separator');
    }
  }

  private parseArray(): unknown[] {
    this.expect('[');
    const result: unknown[] = [];
    while (true) {
      this.skipWhitespace();
      if (this.peek() === ']') {
        this.index += 1;
        return result;
      }
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.peek() === ',') {
        this.index += 1;
        continue;
      }
      if (this.peek() === ']') continue;
      throw new Error('Expected array separator');
    }
  }

  private parseString(): string {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") throw new Error('Expected string');
    this.index += 1;
    let result = '';
    while (!this.isAtEnd()) {
      const char = this.text[this.index++];
      if (char === quote) return result;
      if (char === '\\' && !this.isAtEnd()) {
        const next = this.text[this.index++];
        if (next === quote || next === '\\') result += next;
        else result += `\\${next}`;
      } else {
        result += char;
      }
    }
    throw new Error('Unclosed string');
  }

  private parseAtom(): unknown {
    const start = this.index;
    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char === ',' || char === '}' || char === ']') break;
      this.index += 1;
    }
    const raw = this.text.slice(start, this.index).trim();
    if (!raw) throw new Error('Expected atom');
    if (/^true$/i.test(raw)) return true;
    if (/^false$/i.test(raw)) return false;
    if (raw === 'nil') return 'nil';
    if (raw === 'null' || raw === 'None') return null;
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return parseJsonNumber(raw);
    return raw;
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd() && /\s/.test(this.peek())) this.index += 1;
  }

  private expect(char: string): void {
    if (this.peek() !== char) throw new Error(`Expected ${char}`);
    this.index += 1;
  }

  private peek(): string {
    return this.text[this.index] ?? '';
  }

  private isAtEnd(): boolean {
    return this.index >= this.text.length;
  }
}

function parseJsonNumber(raw: string): number | string {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return raw;
  return raw.includes('.') || Number.isSafeInteger(parsed) ? parsed : raw;
}
