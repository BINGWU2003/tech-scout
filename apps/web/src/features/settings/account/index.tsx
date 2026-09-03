import { ContentSection } from '../components/content-section'
import { AccountForm } from './account-form'

export function SettingsAccount() {
  return (
    <ContentSection title='修改密码' desc='修改后会撤销其他设备上的登录。'>
      <AccountForm />
    </ContentSection>
  )
}
