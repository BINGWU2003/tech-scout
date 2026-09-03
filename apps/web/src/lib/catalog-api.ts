import {
  catalogCandidateDetailResponseSchema,
  catalogCompanyDetailResponseSchema,
  catalogCompanyListSchema,
  catalogDomainDetailResponseSchema,
  catalogDomainListSchema,
  catalogEvidenceListSchema,
  catalogPatentDetailResponseSchema,
  catalogPatentListSchema,
  catalogReleaseSchema,
  catalogSourceResponseSchema,
  type CatalogCompanyListQuery,
  type CatalogCompanyPatentListQuery,
  type CatalogPageQuery,
  type CatalogPatentListQuery,
} from '@tech-scout/contracts'
import { apiRequest } from './api-client'

type QueryValue = boolean | number | string | undefined

function queryString<T extends object>(query: T): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query) as [string, QueryValue][]) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
}

export const catalogApi = {
  currentRelease: () =>
    apiRequest('catalog/releases/current', catalogReleaseSchema),
  domains: () => apiRequest('catalog/domains', catalogDomainListSchema),
  domain: (domainId: string) =>
    apiRequest(
      `catalog/domains/${encodeURIComponent(domainId)}`,
      catalogDomainDetailResponseSchema
    ),
  domainPatents: (domainId: string, query: CatalogPatentListQuery) =>
    apiRequest(
      `catalog/domains/${encodeURIComponent(domainId)}/patents${queryString(query)}`,
      catalogPatentListSchema
    ),
  domainCompanies: (domainId: string, query: CatalogCompanyListQuery) =>
    apiRequest(
      `catalog/domains/${encodeURIComponent(domainId)}/companies${queryString(query)}`,
      catalogCompanyListSchema
    ),
  companies: (query: CatalogCompanyListQuery) =>
    apiRequest(
      `catalog/companies${queryString(query)}`,
      catalogCompanyListSchema
    ),
  company: (companyId: string) =>
    apiRequest(
      `catalog/companies/${encodeURIComponent(companyId)}`,
      catalogCompanyDetailResponseSchema
    ),
  companyPatents: (companyId: string, query: CatalogCompanyPatentListQuery) =>
    apiRequest(
      `catalog/companies/${encodeURIComponent(companyId)}/patents${queryString(query)}`,
      catalogPatentListSchema
    ),
  patent: (patentId: string) =>
    apiRequest(
      `catalog/patents/${encodeURIComponent(patentId)}`,
      catalogPatentDetailResponseSchema
    ),
  candidate: (candidateId: string) =>
    apiRequest(
      `catalog/candidates/${encodeURIComponent(candidateId)}`,
      catalogCandidateDetailResponseSchema
    ),
  candidateEvidence: (candidateId: string, query: CatalogPageQuery) =>
    apiRequest(
      `catalog/candidates/${encodeURIComponent(candidateId)}/evidence${queryString(query)}`,
      catalogEvidenceListSchema
    ),
  source: (locator: string) =>
    apiRequest(
      `catalog/sources/${encodeURIComponent(locator)}`,
      catalogSourceResponseSchema
    ),
}
