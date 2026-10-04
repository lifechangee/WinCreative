// gallery module (ru).
const dict: Record<string, string> = {
  // Panel title
  'gallery.panel.title': 'Галерея',

  // Main bar
  'gallery.bar.search': 'Поиск',
  'gallery.bar.sort': 'Сортировка: ',
  'gallery.sort.manual': 'Вручную',
  'gallery.sort.newest': 'Новые первыми',
  'gallery.sort.oldest': 'Старые первыми',
  'gallery.sort.name': 'По названию',

  // Import/Export actions
  'gallery.action.import': 'Импортировать изображение / файл…',

  // Toast messages
  'gallery.toast.saved': 'Сохранено',
  'gallery.toast.exported': 'Экспортировано',
  'gallery.toast.imported': 'Импортировано',
  'gallery.toast.duplicated': 'Продублировано',
  'gallery.toast.renamed': 'Переименовано',

  // Dialog titles and labels
  'gallery.dialog.rename': 'Переименовать',
  'gallery.dialog.share': 'Поделиться «{name}»',
  'gallery.dialog.delete': 'Удалить рисунок',
  'gallery.dialog.renameStack': 'Переименовать стопку',

  // Dialog buttons
  'gallery.dialog.cancel': 'Отмена',
  'gallery.dialog.close': 'Закрыть',
  'gallery.dialog.open': 'Открыть',
  'gallery.dialog.restore': 'Восстановить',
  'gallery.dialog.deleteForever': 'Удалить навсегда',

  // Trash and recovery
  'gallery.trash.empty': 'Корзина пуста',
  'gallery.trash.deleted': 'Удалено: {date}',

  // Card actions
  'gallery.card.preview': 'Просмотр',
  'gallery.card.share': 'Поделиться…',
  'gallery.card.duplicate': 'Дублировать',
  'gallery.card.removeFromStack': 'Убрать из стопки',
  'gallery.card.delete': 'Удалить',
  'gallery.card.ungroup': 'Разгруппировать',
  'gallery.card.rename': 'Переименовать…',
  'gallery.card.clickToRename': 'Нажмите, чтобы переименовать',

  // Stack/context menu
  'gallery.menu.open': 'Открыть',
  'gallery.menu.rename': 'Переименовать…',
  'gallery.menu.preview': 'Просмотр',
  'gallery.menu.share': 'Поделиться…',
  'gallery.menu.duplicate': 'Дублировать',
  'gallery.menu.removeFromStack': 'Убрать из стопки',
  'gallery.menu.delete': 'Удалить',
  'gallery.menu.ungroup': 'Разгруппировать',

  // Share format dialog
  'gallery.share.format': 'Поделиться «{name}»',
  'gallery.share.bwk': 'WinCreative (.bwk)',
  'gallery.share.png': 'PNG',
  'gallery.share.jpg': 'JPG',

  // Errors
  'gallery.error.openFailed': 'Не удалось открыть: ',
  'gallery.error.importFailed': 'Не удалось импортировать: ',
  'gallery.error.shareFailed': 'Не удалось поделиться: ',
  'gallery.error.duplicateFailed': 'Не удалось продублировать: ',
  'gallery.error.filesMissing': 'Файл рисунка отсутствует',

  // Recovered strokes
  'gallery.trash.confirmOne': 'Переместить «{name}» в корзину? Позже рисунок можно восстановить.',
  'gallery.trash.confirmMany_one': 'Переместить в корзину {count} рисунок?',
  'gallery.trash.confirmMany_few': 'Переместить в корзину {count} рисунка?',
  'gallery.trash.confirmMany_many': 'Переместить в корзину {count} рисунков?',
  'gallery.trash.confirmMany_other': 'Переместить в корзину {count} рисунка?',
  'gallery.filter.doc': 'Документ WinCreative',
  'gallery.filter.everything': 'Всё, что умеет импортировать WinCreative',
  'gallery.filter.images': 'Рисунки и изображения',
  'gallery.filter.resources': 'Кисти, шрифты, палитры',
  'gallery.filter.all': 'Все файлы',
  'gallery.stack.default': 'Стопка',
  'gallery.info.size': 'Размер',
  'gallery.info.layers': 'Слои',
  'gallery.info.profile': 'Цветовой профиль',
  'gallery.info.created': 'Создан',
  'gallery.info.modified': 'Изменён',
  'gallery.card.metaItem_one': '{w} × {h} · {count} слой',
  'gallery.card.metaItem_few': '{w} × {h} · {count} слоя',
  'gallery.card.metaItem_many': '{w} × {h} · {count} слоёв',
  'gallery.card.metaItem_other': '{w} × {h} · {count} слоя',
  'gallery.card.metaStack_one': 'Стопка · {count} рисунок',
  'gallery.card.metaStack_few': 'Стопка · {count} рисунка',
  'gallery.card.metaStack_many': 'Стопка · {count} рисунков',
  'gallery.card.metaStack_other': 'Стопка · {count} рисунка',
  'gallery.trash.title': 'Корзина',
  'gallery.trash.emptyBtn': 'Очистить корзину ({n})',
  'gallery.trash.bin': 'Корзина',
  'gallery.trash.binCount': 'Корзина ({n})',
  'gallery.bar.new': 'Новый',
  'gallery.bar.selected_one': 'Выбран {count}',
  'gallery.bar.selected_few': 'Выбрано {count}',
  'gallery.bar.selected_many': 'Выбрано {count}',
  'gallery.bar.selected_other': 'Выбрано {count}',
  'gallery.bar.stack': 'В стопку',
  'gallery.empty.noMatch': 'Ничего не найдено',
  'gallery.empty.none': 'Рисунков пока нет. Нажмите «+ Новый», чтобы начать рисовать, или импортируйте файл.',
  'gallery.trash.purgeOne': 'Удалить «{name}» навсегда? Это действие нельзя отменить.',
  'gallery.trash.emptyTitle': 'Очистить корзину',
  'gallery.trash.emptyOk': 'Очистить',
  'gallery.trash.purgeMany_one': 'Удалить навсегда {count} рисунок? Это действие нельзя отменить.',
  'gallery.trash.purgeMany_few': 'Удалить навсегда {count} рисунка? Это действие нельзя отменить.',
  'gallery.trash.purgeMany_many': 'Удалить навсегда {count} рисунков? Это действие нельзя отменить.',
  'gallery.trash.purgeMany_other': 'Удалить навсегда {count} рисунка? Это действие нельзя отменить.',
  'gallery.sample.sunset': 'Пример: Закат',
  'gallery.sample.color': 'Пример: Этюд цвета',
  'gallery.sample.grid': 'Пример: Сетка для эскизов',
  'gallery.error.reopenFailed': 'Не удалось открыть заново: ',
  'gallery.recovered_few': 'Восстановлено {count} несохранённых мазка',
  'gallery.recovered_many': 'Восстановлено {count} несохранённых мазков',
  'gallery.imported': 'Импортировано',
  'gallery.recovered_one': 'Восстановлен {count} несохранённый мазок',
  'gallery.recovered_other': 'Восстановлено {count} несохранённых мазка',
}
export default dict
