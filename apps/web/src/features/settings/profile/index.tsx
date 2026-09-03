import { ContentSection } from '../components/content-section'
import { ProfileForm } from './profile-form'

export function SettingsProfile() {
  return (
    <ContentSection
      title='账号信息'
      desc='查看当前账号的用户名、邮箱、角色和状态。'
    >
      <ProfileForm />
    </ContentSection>
  )
}
