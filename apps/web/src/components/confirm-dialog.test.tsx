import type { SubmitEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { ConfirmDialog } from './confirm-dialog'

describe('ConfirmDialog 确认对话框', () => {
  it('渲染标题、描述和默认按钮', async () => {
    const { getByRole, getByText } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Delete item'
        desc='This action cannot be undone.'
        handleConfirm={vi.fn()}
      />
    )

    await expect
      .element(getByRole('heading', { name: 'Delete item' }))
      .toBeInTheDocument()
    await expect
      .element(getByText('This action cannot be undone.'))
      .toBeInTheDocument()
    await expect
      .element(getByRole('button', { name: '取消' }))
      .toBeInTheDocument()
    await expect
      .element(getByRole('button', { name: 'Continue' }))
      .toBeInTheDocument()
  })

  it('在点击确认按钮时调用 handleConfirm', async () => {
    const handleConfirm = vi.fn()
    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Sign out'
        desc='Are you sure?'
        confirmText='Sign out'
        handleConfirm={handleConfirm}
      />
    )

    await userEvent.click(getByRole('button', { name: 'Sign out' }))
    expect(handleConfirm).toHaveBeenCalledOnce()
  })

  it('在 disabled 为 true 时禁用确认按钮', async () => {
    const handleConfirm = vi.fn()
    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Danger'
        desc='...'
        disabled
        handleConfirm={handleConfirm}
      />
    )

    const confirm = getByRole('button', { name: 'Continue' })
    await expect.element(confirm).toBeDisabled()
    expect(handleConfirm).not.toHaveBeenCalled()
  })

  it('在 isLoading 为 true 时禁用取消和确认按钮', async () => {
    const handleConfirm = vi.fn()
    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Loading'
        desc='...'
        isLoading
        handleConfirm={handleConfirm}
      />
    )

    await expect.element(getByRole('button', { name: '取消' })).toBeDisabled()
    await expect
      .element(getByRole('button', { name: 'Continue' }))
      .toBeDisabled()
  })

  it('支持自定义按钮文本', async () => {
    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Delete'
        desc='...'
        cancelBtnText='No'
        confirmText='Yes'
        handleConfirm={vi.fn()}
      />
    )

    await expect
      .element(getByRole('button', { name: 'No' }))
      .toBeInTheDocument()
    await expect
      .element(getByRole('button', { name: 'Yes' }))
      .toBeInTheDocument()
  })

  it('在设置 `form` 时将确认按钮渲染为关联 desc 表单的提交按钮', async () => {
    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Delete tasks'
        form='tasks-multi-delete-form'
        desc={
          <form id='tasks-multi-delete-form' className='space-y-4'>
            <p>Type DELETE to confirm.</p>
          </form>
        }
        confirmText='Delete'
        destructive
      />
    )

    const deleteBtn = getByRole('button', { name: 'Delete' })
    await expect.element(deleteBtn).toHaveAttribute('type', 'submit')
    await expect
      .element(deleteBtn)
      .toHaveAttribute('form', 'tasks-multi-delete-form')
  })

  it('在点击确认按钮时提交 desc 表单（提供 form 属性且无 handleConfirm）', async () => {
    const handleFormSubmit = vi.fn((e: SubmitEvent<HTMLFormElement>) => {
      e.preventDefault()
    })

    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Delete'
        form='users-delete-form'
        desc={
          <form
            id='users-delete-form'
            onSubmit={handleFormSubmit}
            className='space-y-4'
          >
            <p>Confirm deletion.</p>
          </form>
        }
        confirmText='Delete'
        destructive
      />
    )

    await userEvent.click(getByRole('button', { name: 'Delete' }))

    expect(handleFormSubmit).toHaveBeenCalledOnce()
  })

  it('在按下 Enter 键时提交表单', async () => {
    const handleFormSubmit = vi.fn((e: SubmitEvent<HTMLFormElement>) => {
      e.preventDefault()
    })

    const { getByPlaceholder } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Delete'
        form='users-delete-form'
        desc={
          <form
            id='users-delete-form'
            onSubmit={handleFormSubmit}
            className='space-y-4'
          >
            <input type='text' name='username' placeholder='username' />
          </form>
        }
        confirmText='Delete'
        destructive
      />
    )

    await userEvent.fill(getByPlaceholder('username'), 'test')
    await userEvent.keyboard('{Enter}')
    expect(handleFormSubmit).toHaveBeenCalledOnce()
  })

  it('在确认按钮禁用时不提交表单（输入的确认内容不匹配）', async () => {
    const handleFormSubmit = vi.fn((e: SubmitEvent<HTMLFormElement>) => {
      e.preventDefault()
    })

    const { getByRole } = await render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title='Delete'
        form='users-delete-form'
        disabled
        desc={
          <form id='users-delete-form' onSubmit={handleFormSubmit}>
            <p>Enter username to enable Delete.</p>
          </form>
        }
        confirmText='Delete'
        destructive
      />
    )

    const deleteBtn = getByRole('button', { name: 'Delete' })
    await expect.element(deleteBtn).toBeDisabled()
    expect(handleFormSubmit).not.toHaveBeenCalled()
  })
})
