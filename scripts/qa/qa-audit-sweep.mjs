export async function run({ page, step, esc, closeModals }) {
  const menus = ['gallery', 'actions', 'adjustments', 'selection', 'transform']
  const openMenu = async (i) => {
    await page.locator('.tb-left .tb-btn').nth(i).click()
    await page.waitForTimeout(300)
  }
  const clickText = async (txt) => {
    await page.locator('.popover .menu-item', { hasText: txt }).first().click()
    await page.waitForTimeout(500)
  }
  const reset = async () => {
    await page.reload()
    await page.waitForTimeout(2500)
    await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {})
  }
  await step('01-main', async () => {})
  for (const [i, n] of menus.entries()) await step('02-menu-' + n, async () => openMenu(i)).then(esc)

  // ---- panels
  await step('03-layers', async () => page.locator('.tb-layers').click())
  const openLayers = async () => {
    await reset()
    await page.locator('.tb-layers').click()
    await page.waitForTimeout(300)
  }
  await step('03b-layer-quick', async () => {
    await openLayers()
    await page.locator('.layer-row').first().click()
  })
  await step('03c-layer-blend', async () => {
    await openLayers()
    await page.locator('.layer-row').first().click({ button: 'right' })
    await page.waitForTimeout(300)
    await page.locator('.lp-opt .lp-btn').nth(1).click()
  })
  await step('03d-layer-options', async () => {
    await openLayers()
    await page.locator('.layer-row').first().click({ button: 'right' })
  })
  await step('03e-layer-options-mask', async () => {
    await openLayers()
    await page.locator('.layer-row').first().click({ button: 'right' })
    await page.waitForTimeout(300)
    await page.locator('.popover .pop-body').evaluate((e) => (e.scrollTop = 9999))
  })
  await reset()
  await step('04-color', async () => page.locator('.tb-color').click())
  for (const [i, tab] of ['disc', 'classic', 'harmony', 'value', 'palettes'].entries())
    await step('04-color-' + tab, async () => page.locator('.popover .tabs button, .popover .bw-tabs button, .popover [role=tab]').nth(i).click())
  await reset()
  await step('05-brush-library', async () => {
    await page.locator('.tb-icon').first().click()
  })
  await reset()

  // ---- adjustments
  for (let i = 0; i < 19; i++)
    await step('06-adj-' + String(i).padStart(2, '0'), async () => {
      await openMenu(2)
      const n = await page.locator('.popover .menu-item').count()
      if (i >= n) throw new Error('no item ' + i)
      await page.locator('.popover .menu-item').nth(i).click()
      await page.waitForTimeout(600)
    }).then(async () => {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    })
  await reset()

  // ---- selection + transform menu items (each opens the tool bar)
  for (let i = 0; i < 12; i++)
    await step('07-sel-' + String(i).padStart(2, '0'), async () => {
      await openMenu(3)
      await page.locator('.popover .menu-item').nth(i).click()
      await page.waitForTimeout(400)
    }).then(reset)
  for (let i = 0; i < 12; i++)
    await step('08-xf-' + String(i).padStart(2, '0'), async () => {
      await openMenu(4)
      await page.locator('.popover .menu-item').nth(i).click()
      await page.waitForTimeout(400)
    }).then(reset)

  // ---- actions menu dialogs
  const acts = ['Студия кистей', 'Настройки таймлапса', 'Кадрирование', 'Сведения о холсте', 'Цветовой профиль', 'Кривая нажима', 'Управление жестами', 'Сочетания клавиш', 'Диагностика', 'Шпаргалка', 'Справка', 'Обучение', 'Справочник', 'Что нового', 'О программе', 'Стиль текста', 'QuickShape', 'Правка направляющих', 'Окно референса', 'Меню «Копировать', 'Помощник анимации', 'Помощник страниц', 'Повтор таймлапса', 'Настройки…']
  for (const a of acts)
    await step('09-act-' + a.replace(/[^\wа-я]+/gi, '_'), async () => {
      await openMenu(1)
      await clickText(a)
      await page.waitForTimeout(500)
    }).then(reset)

  // ---- misc
  await step('10-cheatsheet', async () => page.keyboard.press('F1'))
  await reset()
  await step('11-newdoc', async () => page.keyboard.press('Control+n'))
  await reset()
  await step('12-gallery', async () => {
    await openMenu(0)
    await page.locator('.popover .menu-item').first().click()
    await page.waitForTimeout(800)
  })
  const gal = async () => {
    await reset()
    await openMenu(0)
    await page.locator('.popover .menu-item').first().click()
    await page.waitForTimeout(800)
  }
  await step('12b-gallery-ctx', async () => {
    await gal()
    await page.locator('.bw-card').nth(1).click({ button: 'right' })
  })
  await step('12c-gallery-select', async () => {
    await gal()
    await page.locator('.bw-g-btn', { hasText: 'Выбрать' }).first().click()
    await page.locator('.bw-card').nth(1).click()
  })
  await step('12d-gallery-bin', async () => {
    await gal()
    await page.locator('.bw-g-btn', { hasText: 'Корзина' }).first().click()
  })
  await step('12e-gallery-preview', async () => {
    await gal()
    await page.locator('.bw-card').nth(1).click({ button: 'right' })
    await page.locator('.bw-ctx > *').nth(2).click()
    await page.waitForTimeout(600)
  })
  await step('12f-gallery-rename', async () => {
    await gal()
    await page.locator('.bw-card').nth(1).click({ button: 'right' })
    await page.locator('.bw-ctx > *').nth(1).click()
  })
  await step('12g-gallery-trash-confirm', async () => {
    await gal()
    await page.locator('.bw-card').nth(1).click({ button: 'right' })
    await page.locator('.bw-ctx > *').last().click()
  })
  await reset()

  // ---- prefs
  await step('13-prefs', async () => page.keyboard.press('Control+,'))
  const n = await page.locator('.prefs-tabs button').count()
  for (let i = 1; i < n; i++) await step('13-prefs-tab' + i, async () => page.locator('.prefs-tabs button').nth(i).click())
}
