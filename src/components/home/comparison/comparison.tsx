// Checked in October 2026 against each project's own docs and source: Finbuckle.MultiTenant 10 (docs/EFCore.md,
// docs/Options.md, docs/Authentication.md), ABP (docs/en/modules/saas.md, the multi-tenancy and EF Core guides) and
// Tenantry Core 0.6 and Pro 0.6. Check them again when any of them releases a major version.
const PROJECTS = ['Your own query filters', 'Finbuckle.MultiTenant', 'ABP', 'Tenantry'] as const;

const ROWS: { label: string; cells: [string, string, string, string] }[] = [
  {
    label: 'What your DbContext needs',
    cells: [
      'A filter on each entity, and a SaveChanges override',
      'Derive from MultiTenantDbContext, or implement IMultiTenantDbContext and call EnforceMultiTenant() in SaveChanges',
      'Derive from AbpDbContext, in an ABP application',
      'One call, options.UseTenantry()',
    ],
  },
  {
    label: 'Create and migrate tenant databases',
    cells: ['You write it', 'No', 'Yes, in the commercial SaaS module', 'Yes, in Pro'],
  },
  {
    label: 'Per-tenant options and authentication',
    cells: ['You write it', 'Yes, both', 'Per-tenant settings and features', 'Options yes; authentication no'],
  },
  {
    label: 'Licence',
    cells: [
      'Yours',
      'Apache-2.0',
      'A commercial ABP licence for the SaaS module',
      'Core Apache-2.0; Pro a subscription',
    ],
  },
];

/** Tenantry beside the alternatives a .NET team weighs, in the facts each project documents. */
export function ComparisonTable() {
  return (
    <div className={'overflow-x-auto rounded-xl border border-border bg-card'}>
      <table className={'w-full min-w-[720px] text-left text-sm'}>
        <thead>
          <tr className={'border-b border-border'}>
            <th className={'p-4'} />
            {PROJECTS.map((project) => (
              <th
                key={project}
                scope={'col'}
                className={project === 'Tenantry' ? 'p-4 font-semibold text-link' : 'p-4 font-semibold'}
              >
                {project}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label} className={'border-b border-border last:border-0 align-top'}>
              <th scope={'row'} className={'p-4 font-medium'}>
                {row.label}
              </th>
              {row.cells.map((cell, index) => (
                <td key={PROJECTS[index]} className={'p-4 text-muted-foreground'}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
