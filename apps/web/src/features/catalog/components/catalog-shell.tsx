import { Link } from '@tanstack/react-router'
import { ArrowLeft, Database } from 'lucide-react'
import { type ReactNode } from 'react'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'

type CatalogShellProps = {
  title: string
  description?: string
  releaseId?: string
  backHref?: string
  children: ReactNode
}

export function CatalogShell({
  title,
  description,
  releaseId,
  backHref = '/catalog',
  children,
}: CatalogShellProps) {
  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <Link
              className='mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground'
              to={backHref}
            >
              <ArrowLeft className='size-4' />
              返回
            </Link>
            <h2 className='text-2xl font-bold tracking-tight'>{title}</h2>
            {description ? (
              <p className='text-muted-foreground'>{description}</p>
            ) : null}
          </div>
          {releaseId ? (
            <Badge variant='outline' className='gap-1'>
              <Database className='size-3.5' />
              {releaseId}
            </Badge>
          ) : null}
        </div>
        {children}
      </Main>
    </>
  )
}

export function CatalogDomainTabs({
  domainId,
  active,
}: {
  domainId: string
  active: 'companies' | 'patents'
}) {
  return (
    <nav
      className='flex w-fit gap-1 rounded-lg bg-muted p-1'
      aria-label='领域目录'
    >
      {(['companies', 'patents'] as const).map((item) => (
        <Link
          key={item}
          to={`/catalog/domains/$domainId/${item}`}
          params={{ domainId }}
          aria-current={active === item ? 'page' : undefined}
          className={
            active === item
              ? 'rounded-md bg-background px-3 py-1.5 text-sm font-medium shadow-sm'
              : 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
          }
        >
          {item === 'companies' ? '公司' : '专利'}
        </Link>
      ))}
    </nav>
  )
}
