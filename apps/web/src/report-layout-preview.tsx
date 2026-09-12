import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { ReportWorkspace } from './features/research/report-workspace'
import { ResearchTimeline } from './features/research/research-timeline'
import './styles/index.css'
const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
const companies = Array.from({length: 12}, (_, i) => ({id: `company-${i}`, name: ['示例储能科技有限公司','示例智能电网技术有限公司','示例新能源研究院'][i % 3] + (i > 2 ? ` · ${i + 1}` : ''), country:'CN', identity:'user_confirmed', patentCount: 36-i, ruleScore: 82-i, explanation:'该主体的相关专利集中在储能设备与充放电控制方向，涉及电池状态估计、能量管理及安全保护。依据专利标题和 IPC 分类推断，与本次研究方向具有相关性。实际产品能力仍需结合公开业务资料进一步核实。', citationIds:['CN10001','CN10002'], trend:{2023:5,2024:12,2025:19}, latestYear:2025}))
client.setQueryData(['research','preview','result'], {releaseId:'示例研究快照', patentCount:156,companies,missing:[],emptyReason:null,unverifiedCount:3,conflictCount:0})
for (const c of companies) {
 client.setQueryData(['research','preview','company',c.id], {...c,legalName:c.name,aliases:[],identifiers:[],businessInfo:{所属行业:'新能源与储能'}, source:{url:null,sha256:null},relations:[],confirmations:[],evidence:[]})
 client.setQueryData(['research','preview','patents',c.id,1], {items:[{id:'CN10001',title:'一种储能系统及其能量管理方法',year:2025,dateKind:'publication',abstract:'通过动态调整充放电策略提升储能系统运行效率。',cpcs:['H02J'],domains:[],source:{url:null,sha256:null}}], total:1,page:1,pageSize:20})
}
for (const id of ['CN10001','CN10002']) client.setQueryData(['research','preview','patent',id], {items:[{id,title:'一种储能系统及其能量管理方法',year:2025,dateKind:'publication',abstract:'通过动态调整充放电策略提升储能系统运行效率。',claims:'储能系统权利要求示例。',description:'说明书示例。',parties:[],cpcs:['H02J'],domains:[],source:{url:null,sha256:null}}],total:1,page:1,pageSize:20})
function Preview() {return <QueryClientProvider client={client}><div className='flex h-dvh flex-col gap-4 bg-background p-4 text-foreground sm:p-6'><nav className='grid shrink-0 grid-cols-4 gap-2'>{['研究计划','专利检索','企业发现与核验','研究报告'].map((x,i)=><div key={x} className={`rounded-lg px-3 py-2.5 text-center text-xs sm:text-sm ${i === 3 ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-muted-foreground'}`}>{i+1}. {x}</div>)}</nav><header className='shrink-0'><h1 className='text-2xl font-semibold'>研究报告</h1><p className='mt-2 text-sm text-muted-foreground'>示例数据 · 查看企业分析与引用依据</p></header><ReportWorkspace runId='preview' controls={<p className='text-sm'>当前研究 <span className='ml-2 rounded bg-muted px-2 py-1'>已完成</span></p>} records={<ResearchTimeline events={[]} active={false} />} /></div></QueryClientProvider>}
const route = createRootRoute({component:Preview})
const router = createRouter({routeTree:route})
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />)
