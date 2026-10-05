import { describe, expect, it } from 'vitest';
import { dotnetVersions, releaseFacts, sampleCount } from './newest-release.mjs';

describe('newest release', () => {
  it('reads the .NET versions a nuspec targets, oldest first, each once', () => {
    const nuspec =
      '<group targetFramework="net10.0" /><group targetFramework="net8.0"><dependency id="A" /></group>' +
      '<group targetFramework="net9.0" /><group targetFramework="net10.0" />';
    expect(dotnetVersions(nuspec)).toEqual(['8', '9', '10']);
    expect(() => dotnetVersions('<metadata />')).toThrow('names no .NET target framework');
  });

  it('counts only the sample folders, and refuses a release with none', () => {
    expect(
      sampleCount('core', ['Directory.Build.props', 'Tenantry.Samples.Aot', 'Tenantry.Samples.Quickstart', 'shared']),
    ).toBe(2);
    expect(sampleCount('pro', ['Tenantry.Pro.Samples.AuditLogging', 'Tenantry.Samples.Aot'])).toBe(1);
    expect(() => sampleCount('core', ['examples'])).toThrow('samples/ has no Tenantry.Samples.* folder.');
    expect(() => sampleCount('pro', [])).toThrow('samples/ has no Tenantry.Pro.Samples.* folder.');
  });

  it('gives the facts of a release, or the reason it cannot', () => {
    const nuspec = '<group targetFramework="net8.0" /><group targetFramework="net10.0" />';
    expect(releaseFacts('core', ['Tenantry.Samples.Aot'], nuspec)).toEqual({ dotnet: ['8', '10'], samples: 1 });
    expect(releaseFacts('pro', ['Tenantry.Pro.Samples.AuditLogging'])).toEqual({ samples: 1 });
    expect(() => releaseFacts('pro', ['Tenantry.Samples.Aot'])).toThrow(
      'samples/ has no Tenantry.Pro.Samples.* folder.',
    );
  });
});
