// ui module (ru).
const dict: Record<string, string> = {
  'ui.menu.gallery': 'Галерея',

  'ui.menu.actions': 'Действия',

  'ui.menu.adjustments': 'Коррекция',

  'ui.menu.selection': 'Выделение',

  'ui.menu.transform': 'Трансформирование',

  'ui.menu.group.add': 'Добавить',
  'ui.menu.group.video': 'Видео',
  'ui.menu.group.canvas': 'Холст',
  'ui.menu.group.share': 'Поделиться',

  'ui.menu.empty': 'Пока пусто',

  'ui.menu.new': 'Новый холст…',

  'ui.menu.open': 'Открыть .bwk…',

  'ui.menu.save': 'Сохранить .bwk…',

  'ui.menu.exportPng': 'Экспорт PNG (прозрачный)',

  'ui.menu.exportPngBg': 'Экспорт PNG (с фоном)',

  'ui.menu.exportJpg': 'Экспорт JPG',

  'ui.menu.fit': 'Вписать холст в экран',

  'ui.menu.resetRotation': 'Сбросить поворот',

  'ui.stub.rectangle': 'Прямоугольное (скоро)',

  'ui.stub.freehand': 'Произвольное (скоро)',

  'ui.stub.automatic': 'Автоматическое (скоро)',

  'ui.stub.freeform': 'Свободное (скоро)',

  'ui.stub.flipH': 'Отразить по горизонтали (скоро)',

  'ui.stub.flipV': 'Отразить по вертикали (скоро)',

  'ui.panel.color': 'Цвет',

  'ui.panel.colour': 'Цвет',

  'ui.panel.layers': 'Слои',

  'ui.panel.lib.brush': 'Библиотека кистей',
  'ui.panel.lib.smudge': 'Библиотека размазывания',
  'ui.panel.lib.eraser': 'Библиотека ластиков',

  'ui.tool.brush': 'Кисть (B)',

  'ui.tool.smudge': 'Размазывание (S)',

  'ui.tool.eraser': 'Ластик (E)',

  'ui.toast.saved': 'Сохранено',

  'ui.toast.saveFailed': 'Не удалось сохранить: {error}',

  'ui.toast.opened': 'Открыто',

  'ui.toast.openFailed': 'Не удалось открыть: {error}',

  'ui.toast.exported': 'Экспортировано',

  'ui.sidebar.fine': 'точно x{factor}',

  'ui.sidebar.brushSize': 'Размер кисти',

  'ui.sidebar.brushOpacity': 'Непрозрачность кисти',

  'ui.sidebar.modifyTip': 'Изменить (удержание): {action}',

  'ui.sidebar.modifyNone': 'нет',

  'ui.sidebar.undo': 'Отменить (Ctrl+Z)',

  'ui.sidebar.redo': 'Повторить (Ctrl+Shift+Z)',

  'ui.sidebar.grip': 'Перетащите, чтобы переместить панель',

  'ui.unit.px': 'px',

  'ui.unit.in': 'дюйм',

  'ui.unit.cm': 'см',

  'ui.unit.mm': 'мм',

  'ui.newdoc.title': 'Новый холст',

  'ui.newdoc.defaultName': 'Холст без названия',

  'ui.newdoc.preset.screen': 'Размер экрана',
  'ui.newdoc.preset.square': 'Квадрат 2048',
  'ui.newdoc.preset.4k': '4K UHD',
  'ui.newdoc.preset.a4': 'A4, 300 DPI',
  'ui.newdoc.preset.photo': 'Фото 4×6, 300 DPI',
  'ui.newdoc.preset.hd': 'Full HD',

  'ui.newdoc.sizeRange': 'Размер должен быть от 16 до {max} px',

  'ui.newdoc.info': '{w} × {h} px · до {layers} слоёв · {mp} Мп',

  'ui.newdoc.presetDelete': 'Правый щелчок — удалить',

  'ui.newdoc.savePreset': 'Сохранить пресет холста',

  'ui.newdoc.createFailed': 'Не удалось создать холст: {error}',

  'ui.newdoc.width': 'Ширина',

  'ui.newdoc.height': 'Высота',

  'ui.newdoc.units': 'Единицы',

  'ui.newdoc.dpi': 'DPI',

  'ui.newdoc.colour': 'Цвет',

  'ui.newdoc.background': 'Фон',

  'ui.newdoc.transparent': 'Прозрачный',

  'ui.newdoc.saveAsPreset': 'Сохранить как пресет…',

  'ui.newdoc.tl.Max': 'Таймлапс: макс.',
  'ui.newdoc.tl.HD': 'Таймлапс: HD',
  'ui.newdoc.tl.Small': 'Таймлапс: малый',
  'ui.newdoc.infinite': 'Бесконечный холст',
  'ui.newdoc.infiniteHint': 'Без фиксированного размера: двигайтесь и рисуйте в любую сторону. Пиксели хранятся плитками 512 px и создаются там, где вы рисуете.',
  'ui.newdoc.infiniteInfo': 'Бесконечный холст · без границ · до {layers} слоёв',
  'ui.inf.unavailable': 'Пока недоступно на бесконечном холсте',
  'ui.inf.nothingToExport': 'Нечего экспортировать: сначала нарисуйте что-нибудь или создайте рамку',
  'ui.inf.menu.toFixed': 'Преобразовать в фиксированный холст…',
  'ui.inf.menu.toInfinite': 'Преобразовать в бесконечный холст',
  'ui.inf.toFixed.title': 'Преобразование в фиксированный холст',
  'ui.inf.toFixed.note': 'Создаёт НОВЫЙ рисунок с ограниченным холстом; этот бесконечный холст не меняется.',
  'ui.inf.toFixed.source': 'Область',
  'ui.inf.toFixed.frame': 'По рамке',
  'ui.inf.toFixed.content': 'По границам содержимого',
  'ui.inf.toFixed.custom': 'Свой прямоугольник',
  'ui.inf.toFixed.none': 'Для этого варианта нет рамки или рисунка.',
  'ui.inf.toFixed.size': 'Новый холст: {w} × {h} пикс.',
  'ui.inf.toFixed.tooBig': 'Область превышает предел холста {max} пикс.',
  'ui.inf.toFixed.create': 'Создать фиксированный холст',
  'ui.inf.toFixed.suffix': ' (фиксированный)',
  'ui.inf.toInfinite.suffix': ' (бесконечный)',
  'ui.inf.toInfinite.done': 'Создан новый бесконечный холст; фиксированный оригинал не изменён',
  'ui.inf.needFrame': 'Сначала создайте рамку: на бесконечном холсте эта функция работает внутри рамки',
  'ui.inf.mem.title': 'Память плиток',
  'ui.inf.mem.gpu': 'Бюджет видеопамяти (МБ, 0 = авто)',
  'ui.inf.mem.cpu': 'Бюджет сжатого ОЗУ (МБ, 0 = авто)',
  'ui.inf.mem.note': 'Плитки бесконечного холста сверх бюджета GPU сжимаются в ОЗУ, затем переносятся во временный файл на диске; при перемещении к ним они возвращаются автоматически.',
  'ui.inf.hud': 'x {x}  y {y}  ·  {zoom}%',
  'ui.inf.goOrigin': 'К началу координат',
  'ui.inf.fitContent': 'Показать всё содержимое',
  'ui.inf.grid': 'Бесконечный холст: точечная сетка',
  'ui.inf.gridOn': 'Точечная сетка включена',
  'ui.inf.gridOff': 'Точечная сетка выключена',
  'ui.inf.memWarn': 'Этот бесконечный холст занимает {mb} МБ видеопамяти. Подумайте об экспорте или объединении частей рисунка.',
  'ui.inf.memHard': 'Этот бесконечный холст занимает {mb} МБ видеопамяти - это очень много. Сохраните работу и сократите нарисованную область.',
  'ui.inf.exportEmpty': 'Пока ничего не нарисовано - экспортировать нечего',
  'ui.inf.exportScaled': 'Содержимое больше лимита видеокарты; экспортировано в масштабе {pct}%',
  'ui.inf.export.tooBig': 'Эта область — {w} × {h} px, а экспорт со слоями (PSD, PNG / PDF по слоям) ограничен вашей видеокартой до {max} px по стороне. Уменьшите рамку или экспортируйте плоский PNG — он масштабируется автоматически.',
}
export default dict
