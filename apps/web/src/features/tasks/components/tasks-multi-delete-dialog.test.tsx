import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { createTableMock } from '@/test-utils/tanstack-table'
import { TasksMultiDeleteDialog } from './tasks-multi-delete-dialog'

vi.mock('@/lib/utils', async (orig) => ({
  ...(await orig()),
  sleep: vi.fn(() => Promise.resolve()),
}))

describe('TasksMultiDeleteDialog 任务批量删除对话框', () => {
  beforeEach(() => vi.clearAllMocks())

  it('渲染包含正确标题、描述、输入框和按钮的对话框', async () => {
    const { table } = createTableMock()

    const { getByRole, getByText } = await render(
      <TasksMultiDeleteDialog open onOpenChange={vi.fn()} table={table} />
    )

    const title = getByRole('heading', {
      level: 2,
      name: /Delete 2 tasks/i,
    })
    const desc = getByText(
      'Are you sure you want to delete the selected tasks?'
    )
    const confirmDeleteInput = getByRole('textbox', {
      name: /Confirm by typing "DELETE"/i,
    })
    const cancelButton = getByRole('button', { name: '取消' })
    const deleteButton = getByRole('button', { name: /Delete/i })

    await expect.element(title).toBeInTheDocument()
    await expect.element(desc).toBeInTheDocument()
    await expect.element(confirmDeleteInput).toBeInTheDocument()
    await expect.element(cancelButton).toBeInTheDocument()
    await expect.element(deleteButton).toBeInTheDocument()
    await expect.element(deleteButton).toBeDisabled()
  })

  it('在确认删除输入框填写正确前保持删除按钮禁用', async () => {
    const { table } = createTableMock()
    const { getByRole } = await render(
      <TasksMultiDeleteDialog open onOpenChange={vi.fn()} table={table} />
    )

    const confirmDeleteInput = getByRole('textbox', {
      name: /Confirm by typing "DELETE"/i,
    })
    const deleteButton = getByRole('button', { name: /Delete/i })

    await expect.element(deleteButton).toBeDisabled()

    await userEvent.fill(confirmDeleteInput, 'wrong-input')
    await expect.element(deleteButton).toBeDisabled()

    await userEvent.fill(confirmDeleteInput, 'DELETE')
    await expect.element(deleteButton).toBeEnabled()
  })

  it('在点击取消按钮时关闭对话框', async () => {
    const onOpenChange = vi.fn()
    const { table } = createTableMock()
    const { getByRole } = await render(
      <TasksMultiDeleteDialog open onOpenChange={onOpenChange} table={table} />
    )

    const cancelButton = getByRole('button', { name: '取消' })
    await userEvent.click(cancelButton)

    expect(onOpenChange).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('在关闭并重新打开对话框时重置确认删除输入框', async () => {
    const { table } = createTableMock()

    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type='button' onClick={() => setOpen(true)}>
            Reopen
          </button>
          {open ? (
            <TasksMultiDeleteDialog
              open={open}
              onOpenChange={setOpen}
              table={table}
            />
          ) : null}
        </>
      )
    }

    const { getByRole } = await render(<Harness />)

    const confirmDeleteInput = getByRole('textbox', {
      name: /Confirm by typing "DELETE"/i,
    })
    await userEvent.fill(confirmDeleteInput, 'DELETE')
    await expect.element(confirmDeleteInput).toHaveValue('DELETE')

    const cancelButton = getByRole('button', { name: '取消' })
    await userEvent.click(cancelButton)

    const reopenButton = getByRole('button', { name: /Reopen/i })
    await userEvent.click(reopenButton)
    await expect.element(confirmDeleteInput).toHaveValue('')
  })

  it('在删除成功时显示已提交的数据', async () => {
    const { table, resetRowSelection } = createTableMock()
    const onOpenChange = vi.fn()
    const { getByRole } = await render(
      <TasksMultiDeleteDialog open onOpenChange={onOpenChange} table={table} />
    )

    const confirmDeleteInput = getByRole('textbox', {
      name: /Confirm by typing "DELETE"/i,
    })
    const deleteButton = getByRole('button', { name: /Delete/i })

    await expect.element(deleteButton).toBeDisabled()

    await userEvent.fill(confirmDeleteInput, 'DELETE')
    await expect.element(deleteButton).toBeEnabled()

    await userEvent.click(deleteButton)

    expect(onOpenChange).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)

    await vi.waitFor(() => expect(resetRowSelection).toHaveBeenCalledOnce())
  })

  it('在确认删除输入框中按下 Enter 键时成功删除', async () => {
    const { table, resetRowSelection } = createTableMock()
    const onOpenChange = vi.fn()
    const { getByRole } = await render(
      <TasksMultiDeleteDialog open onOpenChange={onOpenChange} table={table} />
    )

    const confirmDeleteInput = getByRole('textbox', {
      name: /Confirm by typing "DELETE"/i,
    })
    const deleteButton = getByRole('button', { name: /Delete/i })

    await expect.element(deleteButton).toBeDisabled()

    await userEvent.fill(confirmDeleteInput, 'DELETE')
    await expect.element(deleteButton).toBeEnabled()

    await userEvent.keyboard('{Enter}')
    expect(onOpenChange).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)

    await vi.waitFor(() => expect(resetRowSelection).toHaveBeenCalledOnce())
  })
})
