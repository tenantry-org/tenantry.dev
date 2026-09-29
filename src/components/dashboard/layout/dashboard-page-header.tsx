interface Props {
  pageTitle: string;
}

export function DashboardPageHeader({ pageTitle }: Props) {
  return (
    <div className={'mb-8 border-b border-border pb-6'}>
      <h1 className={'text-2xl font-bold tracking-tight md:text-3xl'}>{pageTitle}</h1>
    </div>
  );
}
