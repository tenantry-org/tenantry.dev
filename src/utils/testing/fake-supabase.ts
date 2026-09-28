/**
 * Minimal stand-in for the Supabase query builder in unit tests. Every builder method returns the same
 * chain; `maybeSingle()` resolves to the table's `single` row and awaiting the chain resolves to its
 * `list`. Writes resolve without error. `rpc(name)` resolves to what the matching `rpcs` handler returns.
 */
export interface FakeTable {
  list?: unknown[];
  /** The row `maybeSingle()` gives, or a function of the chain's `eq` filters (column → value). */
  single?: unknown;
  /** The error a write (update, upsert, insert, delete) on this table resolves with. */
  writeError?: { code: string; message: string };
}

/** A builder call, recorded when `fakeSupabase` is given a `calls` array. */
export interface FakeCall {
  table: string;
  method: string;
  args: unknown[];
}

type Result = { data: unknown; error: unknown };

const WRITES = new Set(['update', 'upsert', 'insert', 'delete']);

export function fakeSupabase(
  tables: Record<string, FakeTable>,
  calls?: FakeCall[],
  rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {},
) {
  return {
    async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
      calls?.push({ table: `rpc:${name}`, method: 'rpc', args: [args] });
      return { data: rpcs[name]?.(args) ?? null, error: null };
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let wrote = false;
      // A thenable carrying the builder's methods, so awaiting the chain gives the table's list (or, after
      // a write, the table's write error).
      const chain: Record<string, unknown> = {
        then(resolve: (result: Result) => unknown, reject?: (reason: unknown) => unknown) {
          const writeError = wrote ? (tables[table]?.writeError ?? null) : null;
          const result: Result = writeError
            ? { data: null, error: writeError }
            : { data: tables[table]?.list ?? [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      for (const method of ['select', 'eq', 'gt', 'in', 'order', 'limit', 'update', 'upsert', 'insert', 'delete']) {
        chain[method] = (...args: unknown[]) => {
          calls?.push({ table, method, args });
          if (method === 'eq') filters[args[0] as string] = args[1];
          if (WRITES.has(method)) wrote = true;
          return chain;
        };
      }
      chain.maybeSingle = async (): Promise<Result> => {
        const single = tables[table]?.single;
        return { data: (typeof single === 'function' ? single(filters) : single) ?? null, error: null };
      };
      return chain;
    },
  };
}
