// core module (ru). Same keys as en/core.ts.
const dict: Record<string, string> = {
  'core.action.tool.prev': 'Предыдущий инструмент',
  'core.action.tool.eyedropper': 'Пипетка (удержание)',
  'core.action.tool.eraserHold': 'Ластик (удержание)',

  'core.action.nav.pan': 'Перемещение (удержание + перетаскивание)',
  'core.action.nav.rotate': 'Поворот (удержание + перетаскивание)',
  'core.action.nav.zoom': 'Масштаб (удержание + перетаскивание)',

  'core.action.view.zoomIn': 'Увеличить',
  'core.action.view.zoomOut': 'Уменьшить',
  'core.action.view.fit': 'Вписать холст в экран',
  'core.action.view.zoom100': 'Масштаб 100%',
  'core.action.view.mirror': 'Отразить холст (зеркальный вид)',
  'core.action.view.resetRotation': 'Сбросить поворот',

  'core.action.brush.sizeUp': 'Увеличить размер кисти',
  'core.action.brush.sizeDown': 'Уменьшить размер кисти',
  'core.action.brush.opacityUp': 'Увеличить непрозрачность',
  'core.action.brush.opacityDown': 'Уменьшить непрозрачность',

  'core.action.edit.undo': 'Отменить',
  'core.action.edit.redo': 'Повторить',

  'core.action.layer.new': 'Новый слой',
  'core.action.layer.delete': 'Удалить слой',
  'core.action.layer.duplicate': 'Дублировать слой',
  'core.action.layer.clear': 'Очистить слой',

  'core.action.ui.layers': 'Панель слоёв',
  'core.action.ui.color': 'Панель цвета',
  'core.action.ui.brushLibrary': 'Библиотека кистей',
  'core.action.ui.hideUI': 'Скрыть / показать интерфейс',
  'core.action.ui.fullscreen': 'Во весь экран',
  'core.action.ui.theme': 'Переключить светлую / тёмную тему',

  'core.action.tool.brush': 'Кисть',
  'core.action.tool.smudge': 'Размазывание',
  'core.action.tool.eraser': 'Ластик',

  'core.action.edit.cut': 'Вырезать',
  'core.action.edit.copy': 'Копировать',
  'core.action.edit.paste': 'Вставить',
  'core.action.edit.pasteMenu': 'Меню копирования и вставки',

  'core.action.select.all': 'Выделить всё',
  'core.action.select.deselect': 'Снять выделение',
  'core.action.select.invert': 'Инвертировать выделение',

  'core.action.transform': 'Трансформирование',
  'core.action.transform.flipH': 'Отразить по горизонтали',
  'core.action.transform.flipV': 'Отразить по вертикали',

  'core.action.layer.merge': 'Объединить с нижним слоем',

  'core.action.file.save': 'Сохранить',
  'core.action.file.open': 'Открыть',
  'core.action.file.new': 'Новый холст',

  'core.action.unavailable': '«{name}» недоступно',

  'core.app.startFailed': 'Не удалось запустить WinCreative:',

  'core.toast.lastLayer': 'Нельзя удалить последний слой',

  'core.toast.layerLocked': 'Слой заблокирован',

  'core.toast.layerCleared': 'Слой очищен',

  'core.category.File': 'Файл',

  'core.category.Color': 'Цвет',

  'core.category.Interface': 'Интерфейс',

  'core.category.View': 'Вид',

  'core.category.Tools': 'Инструменты',

  'core.category.Navigation': 'Навигация',

  'core.category.Brush': 'Кисть',

  'core.category.Edit': 'Правка',

  'core.category.Layers': 'Слои',

  'core.category.Selection': 'Выделение',

  'core.category.Menus': 'Меню',

  'core.common.ok': 'OK',

  'core.common.cancel': 'Отмена',

  'core.common.done': 'Готово',

  'core.common.close': 'Закрыть',

  'core.common.save': 'Сохранить',

  'core.common.create': 'Создать',

  'core.common.delete': 'Удалить',

  'core.common.apply': 'Применить',

  'core.common.reset': 'Сбросить',

  'core.common.add': 'Добавить',

  'core.common.remove': 'Удалить',

  'core.common.rename': 'Переименовать',

  'core.common.duplicate': 'Дублировать',

  'core.common.yes': 'Да',

  'core.common.no': 'Нет',

  'core.common.open': 'Открыть',

  'core.common.import': 'Импорт',

  'core.common.export': 'Экспорт',

  'core.common.none': 'Нет',

  'core.common.on': 'Вкл.',

  'core.common.off': 'Выкл.',

  'core.common.back': 'Назад',

  'core.common.next': 'Далее',

  'core.common.confirm': 'Подтвердить',

  'core.common.name': 'Название',

  'core.common.untitled': 'Без названия',

  'core.common.error': 'Ошибка',

  'core.common.loading': 'Загрузка…',

  'core.common.copy': 'Копировать',

  'core.common.paste': 'Вставить',

  'core.common.select': 'Выбрать',

  'core.common.more': 'Ещё',

  'core.common.opacity': 'Непрозрачность',

  'core.common.size': 'Размер',

  'core.tool.layerHidden': 'Слой скрыт',

  'core.tool.selectInGroup': 'Выберите слой внутри группы, чтобы рисовать',

  'core.doc.background': 'Фон',

  'core.doc.layerProperties': 'Свойства слоя',

  'core.color.srgb': 'sRGB IEC61966-2.1',

  'core.color.p3': 'Display P3',

  'core.color.adobe': 'Adobe RGB (1998)',
  'core.history.new_document': 'Новый документ',
  'core.history.open_document': 'Открытие документа',
  'core.history.import_psd': 'Импорт PSD',
  'core.history.import_image': 'Импорт изображения',
  'core.history.import_procreate': 'Импорт Procreate',
  'core.history.crop_and_resize': 'Кадрирование и изменение размера',
  'core.history.add_layer': 'Добавление слоя',
  'core.history.add_mask': 'Добавление маски',
  'core.history.delete_mask': 'Удаление маски',
  'core.history.delete_layer': 'Удаление слоя',
  'core.history.delete_group': 'Удаление группы',
  'core.history.delete_layers': 'Удаление слоёв',
  'core.history.duplicate_layer': 'Дублирование слоя',
  'core.history.duplicate_group': 'Дублирование группы',
  'core.history.duplicate': 'Дублирование',
  'core.history.clear_layer': 'Очистка слоя',
  'core.history.reorder_layer': 'Перемещение слоя',
  'core.history.group_layers': 'Группировка слоёв',
  'core.history.ungroup': 'Разгруппировка',
  'core.history.set_reference': 'Назначение референса',
  'core.history.clear_reference': 'Снятие референса',
  'core.history.add_frame': 'Добавление кадра',
  'core.history.add_page': 'Добавление страницы',
  'core.history.insert_image': 'Вставка изображения',
  'core.history.insert_psd': 'Вставка PSD',
  'core.history.flip': 'Отражение',
  'core.history.flip_canvas_horizontal': 'Отражение холста по горизонтали',
  'core.history.flip_canvas_vertical': 'Отражение холста по вертикали',
  'core.history.clear_mask': 'Очистка маски',
  'core.history.reveal_all': 'Показать всё',
  'core.history.cut_paste': 'Вырезание и вставка',
  'core.history.copy_paste': 'Копирование и вставка',
  'core.history.flatten': 'Сведение слоёв',
  'core.history.merge_group': 'Объединение группы',
  'core.history.merge_layers': 'Объединение слоёв',
  'core.history.merge_down': 'Объединение с нижним',
  'core.history.combine_down': 'Объединение с нижним',
  'core.history.apply_mask': 'Применение маски',
  'core.history.fill_mask': 'Заливка маски',
  'core.history.fill_layer': 'Заливка слоя',
  'core.history.invert_mask': 'Инверсия маски',
  'core.history.invert_colors': 'Инверсия цветов',
  'core.history.convert_profile': 'Преобразование профиля',
  'core.history.convert_colour_profile': 'Преобразование цветового профиля',
  'core.history.psd_adjustment_layers': 'Корректирующие слои PSD',
  'core.history.cut': 'Вырезание',
  'core.history.paste': 'Вставка',
  'core.history.transform': 'Трансформирование',
  'core.history.transform_selection': 'Трансформирование выделения',
  'core.history.brush_stroke': 'Мазок кистью',
  'core.history.smudge': 'Размазывание',
  'core.history.erase': 'Стирание',
  'core.history.selection': 'Выделение',
  'core.history.deselect': 'Снятие выделения',
  'core.history.select_all': 'Выделить всё',
  'core.history.invert_selection': 'Инвертирование выделения',
  'core.history.load_selection': 'Загрузка выделения',
  'core.history.clear_selection': 'Очистка выделения',
  'core.history.select_layer': 'Выбор слоя',
  'core.history.select_layer_contents': 'Выделение содержимого слоя',
  'core.history.color_fill': 'Заливка цветом',
  'core.history.invert': 'Инверсия',
  'core.history.desaturate': 'Обесцвечивание',
  'core.history.brighten_15': 'Яркость +15%',
  'core.history.background': 'Фон',
  'core.history.layer_properties': 'Свойства слоя',
  'core.doc.layer': 'Слой',
  'core.doc.layerN': 'Слой {n}',
  'core.doc.group': 'Группа',
  'core.doc.copySuffix': ' копия',
  'core.doc.cutSuffix': ' вырезано',
  'core.doc.frameN': 'Кадр {n}',
  'core.doc.pageN': 'Страница {n}',
  'core.doc.pastedImage': 'Вставленное изображение',
  'core.doc.pastedLayer': 'Вставленный слой',
  'core.blendGroup.Normal': 'Обычные',
  'core.blendGroup.Darken': 'Затемнение',
  'core.blendGroup.Lighten': 'Осветление',
  'core.blendGroup.Contrast': 'Контраст',
  'core.blendGroup.Comparative': 'Сравнение',
  'core.blendGroup.Component': 'Компоненты',
  'core.blend.normal': 'Обычный',
  'core.blend.multiply': 'Умножение',
  'core.blend.screen': 'Экран',
  'core.blend.overlay': 'Перекрытие',
  'core.blend.softLight': 'Мягкий свет',
  'core.blend.hardLight': 'Жёсткий свет',
  'core.blend.colorDodge': 'Осветление основы',
  'core.blend.colorBurn': 'Затемнение основы',
  'core.blend.darken': 'Замена тёмным',
  'core.blend.lighten': 'Замена светлым',
  'core.blend.difference': 'Разница',
  'core.blend.exclusion': 'Исключение',
  'core.blend.add': 'Добавление',
  'core.blend.hue': 'Цветовой тон',
  'core.blend.saturation': 'Насыщенность',
  'core.blend.color': 'Цветность',
  'core.blend.luminosity': 'Яркость',
  'core.blend.linearBurn': 'Линейный затемнитель',
  'core.blend.darkerColor': 'Темнее',
  'core.blend.lighterColor': 'Светлее',
  'core.blend.vividLight': 'Яркий свет',
  'core.blend.linearLight': 'Линейный свет',
  'core.blend.pinLight': 'Точечный свет',
  'core.blend.hardMix': 'Жёсткое смешение',
  'core.blend.subtract': 'Вычитание',
  'core.blend.divide': 'Разделить',
  'core.history.feather_selection': 'Растушёвка выделения',
  'core.toast.viewFlipped': 'Вид холста отражён',
  'core.toast.viewRestored': 'Вид холста восстановлен',
  'core.hover.opacity': 'Непрозрачность {n}%',
  'core.hover.size': 'Размер {n}',
  'core.doc.image': 'Изображение',
  'core.filter.png': 'Изображение PNG',
  'core.filter.jpeg': 'Изображение JPEG',
  'core.filter.invert': 'Инверсия',
  'core.filter.desaturate': 'Обесцвечивание',
  'core.filter.brightness': 'Яркость +15%',
  'core.history.select_color_area': 'Выделение области по цвету',
  'core.history.select_rectangle': 'Прямоугольное выделение',
  'core.history.select_ellipse': 'Эллиптическое выделение',
  'core.history.select_freehand': 'Произвольное выделение',
}
export default dict
