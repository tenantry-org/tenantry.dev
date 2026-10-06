/**
 * Minimal stand-in for the Supabase query builder in unit tests. Every builder method returns the same
 * chain; `maybeSingle()` resolves to the table's `single` row and awaiting the chain resolves to its
 * `list`, cut to the chain's `range` if it has one and to at most MAX_ROWS rows, as the API cuts it, with the
 * whole list's length as `count` if `select` or `delete` asked for one. Reads resolve with the table's
 * `readError`, and writes with its `writeError`, if any. `rpc(name)` resolves to what the matching `rpcs`
 * handler returns, or with the error it throws, as a failed database function does.
 */
export interface FakeTable {
  list?: unknown[];
  /** The row `maybeSingle()` gives, or a function of the chain's `eq` filters (column → value). */
  single?: unknown;
  /** The error a read (awaiting a select, or `maybeSingle()`) of this table resolves with. */
  readError?: { code: string; message: string };
  /** The error a write (update, upsert, insert, delete) on this table resolves with. */
  writeError?: { code: string; message: string };
  /** The most rows a request returns, when lower than MAX_ROWS, as a hosted project's limit may be. */
  maxRows?: number;
}

/** A builder call, recorded when `fakeSupabase` is given a `calls` array. */
export interface FakeCall {
  table: string;
  method: string;
  args: unknown[];
}

type Result = { data: unknown; error: unknown; count?: number | null };

const WRITES = new Set(['update', 'upsert', 'insert', 'delete']);

/** The API's max_rows (supabase/config.toml): a request returns at most this many rows, without an error. */
export const MAX_ROWS = 1000;

export function fakeSupabase(
  tables: Record<string, FakeTable>,
  calls?: FakeCall[],
  rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {},
) {
  return {
    async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
      calls?.push({ table: `rpc:${name}`, method: 'rpc', args: [args] });
      try {
        return { data: rpcs[name]?.(args) ?? null, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let wrote = false;
      let range: [number, number] | null = null;
      let counted = false;
      // A promise carrying the builder's methods, so awaiting the chain gives the table's list (or its read
      // error, or after a write its write error). It settles in a later microtask, after the synchronous chain of
      // builder calls has recorded any write.
      const settled: Promise<Result> = Promise.resolve().then(() => {
        const error = (wrote ? tables[table]?.writeError : tables[table]?.readError) ?? null;
        if (error) return { data: null, error };
        const list = tables[table]?.list ?? [];
        return {
          data: (range ? list.slice(range[0], range[1] + 1) : list).slice(0, tables[table]?.maxRows ?? MAX_ROWS),
          error: null,
          count: counted ? list.length : null,
        };
      });
      const chain = settled as Promise<Result> & Record<string, unknown>;
      for (const method of [
        'select',
        'eq',
        'neq',
        'is',
        'gt',
        'lt',
        'in',
        'order',
        'limit',
        'range',
        'update',
        'upsert',
        'insert',
        'delete',
      ]) {
        chain[method] = (...args: unknown[]) => {
          calls?.push({ table, method, args });
          if (method === 'eq') filters[args[0] as string] = args[1];
          if (method === 'range') range = [args[0] as number, args[1] as number];
          if (method === 'select') counted = (args[1] as { count?: string } | undefined)?.count !== undefined;
          if (method === 'delete') counted = (args[0] as { count?: string } | undefined)?.count !== undefined;
          if (WRITES.has(method)) wrote = true;
          return chain;
        };
      }
      chain.maybeSingle = async (): Promise<Result> => {
        const readError = tables[table]?.readError;
        if (readError) return { data: null, error: readError };
        const single = tables[table]?.single;
        return { data: (typeof single === 'function' ? single(filters) : single) ?? null, error: null };
      };
      return chain;
    },
  };
}
