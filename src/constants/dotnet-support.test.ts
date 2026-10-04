import { describe, expect, it } from 'vitest';
import { dotnetSupport } from './dotnet-support';

describe('.NET support', () => {
  it('names the current versions, and the legacy ones with their end date', () => {
    expect(dotnetSupport(['8', '9', '10'])).toBe('.NET 10, and .NET 8 and 9 until 10 November 2027');
    expect(dotnetSupport(['8', '9', '10', '11'])).toBe('.NET 10 and 11, and .NET 8 and 9 until 10 November 2027');
    expect(dotnetSupport(['10', '11', '12'])).toBe('.NET 10, 11 and 12');
  });
});
