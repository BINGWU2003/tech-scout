import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { showSubmittedData } from '@/lib/show-submitted-data'
import { TasksImportDialog } from './tasks-import-dialog'

vi.mock('@/lib/show-submitted-data', () => ({ showSubmittedData: vi.fn() }))

describe('TasksImportDialog 任务导入对话框', () => {
  beforeEach(() => vi.clearAllMocks())

  it('渲染包含正确标题、描述、文件输入框和按钮的对话框', async () => {
    const onOpenChange = vi.fn()
    const { getByRole, getByText, getByLabelText } = await render(
      <TasksImportDialog open onOpenChange={onOpenChange} />
    )

    const title = getByRole('heading', {
      level: 2,
      name: /Import Tasks/i,
    })
    const desc = getByText('Import tasks quickly from a CSV file')
    const fileInput = getByLabelText('File')
    const closeButtons = getByRole('dialog')
      .getByRole('button', { name: 'Close' })
      .all()

    const importButton = getByRole('button', { name: /^Import$/i })

    await expect.element(title).toBeInTheDocument()
    await expect.element(desc).toBeInTheDocument()
    await expect.element(fileInput).toBeInTheDocument()
    expect(closeButtons).toHaveLength(2)
    await expect.element(importButton).toBeInTheDocument()
  })

  it('在未选择文件时提交并显示校验提示', async () => {
    const onOpenChange = vi.fn()
    const { getByRole, getByText } = await render(
      <TasksImportDialog open onOpenChange={onOpenChange} />
    )

    const importButton = getByRole('button', { name: /^Import$/i })
    await userEvent.click(importButton)

    await expect.element(getByText('Please upload a file.')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(showSubmittedData).not.toHaveBeenCalled()
  })

  it('在导入 CSV 文件时调用 showSubmittedData 并关闭对话框', async () => {
    const onOpenChange = vi.fn()
    const { getByRole, getByLabelText } = await render(
      <TasksImportDialog open onOpenChange={onOpenChange} />
    )

    const csv = new File(['a,b'], 'tasks.csv', { type: 'text/csv' })
    await userEvent.upload(getByLabelText('File'), csv)

    const importButton = getByRole('button', { name: /^Import$/i })
    await userEvent.click(importButton)

    expect(showSubmittedData).toHaveBeenCalledOnce()
    expect(showSubmittedData).toHaveBeenCalledWith(
      {
        name: 'tasks.csv',
        size: csv.size,
        type: 'text/csv',
      },
      'You have imported the following file:'
    )
    expect(onOpenChange).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('在点击关闭按钮时关闭对话框', async () => {
    const onOpenChange = vi.fn()

    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type='button' onClick={() => setOpen(true)}>
            Reopen
          </button>
          <TasksImportDialog
            open={open}
            onOpenChange={(val) => {
              onOpenChange(val)
              setOpen(val)
            }}
          />
        </>
      )
    }

    const { getByRole } = await render(<Harness />)

    const closeButtonX = getByRole('dialog')
      .getByRole('button', {
        name: /Close/i,
      })
      .nth(0)
    await userEvent.click(closeButtonX)

    expect(onOpenChange).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(showSubmittedData).not.toHaveBeenCalled()

    await userEvent.click(getByRole('button', { name: /Reopen/i }))
    const closeButton = getByRole('dialog')
      .getByRole('button', {
        name: /Close/i,
      })
      .nth(1)
    await userEvent.click(closeButton)

    expect(onOpenChange).toHaveBeenCalledTimes(2)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(showSubmittedData).not.toHaveBeenCalled()
  })
})
