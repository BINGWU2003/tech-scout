import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { LoadingRegion } from './loading'
import '@/styles/index.css'

it.each([390, 1280])(
  '在 %i px 视口中居中覆盖局部区域，保留布局并阻止旧内容获得焦点',
  async (width) => {
    await page.viewport(width, 900)
    const view = (busy: boolean) => (
      <div className='p-4'>
        <button data-testid='navigation'>导航</button>
        <LoadingRegion busy={busy} className='h-80 w-full rounded-lg border'>
          <button data-testid='old-action'>打开旧记录</button>
        </LoadingRegion>
      </div>
    )
    const screen = await render(view(false))
    const oldAction = screen
      .getByTestId('old-action')
      .element() as HTMLButtonElement
    const region = oldAction.parentElement!.parentElement!
    const before = region.getBoundingClientRect()
    await screen.rerender(view(true))
    const indicator = screen
      .getByRole('status')
      .element()
      .getBoundingClientRect()
    const after = region.getBoundingClientRect()
    expect(after.height).toBe(before.height)
    expect(
      Math.abs(indicator.x + indicator.width / 2 - (after.x + after.width / 2))
    ).toBeLessThan(2)
    expect(
      Math.abs(
        indicator.y + indicator.height / 2 - (after.y + after.height / 2)
      )
    ).toBeLessThan(2)
    await userEvent.click(screen.getByTestId('navigation'))
    oldAction.focus()
    expect(document.activeElement).not.toBe(oldAction)
    expect(oldAction.closest('[inert]')).not.toBeNull()
    await page.screenshot({
      path: `__screenshots__/loading-centered-${width}.png`,
    })
    await screen.rerender(view(false))
    oldAction.focus()
    expect(document.activeElement).toBe(oldAction)
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
  }
)
