// adjustments module (ru). Same keys as en/adjustments.ts.
const dict: Record<string, string> = {
  'adjustments.ui.layerLocked': 'Слой заблокирован',

  'adjustments.ui.layerHidden': 'Слой скрыт',

  'adjustments.ui.limit.frame': 'Только в пределах рамки',
  'adjustments.ui.limit.view': 'Только видимая область',
  'adjustments.ui.limit.viewAll': 'Просмотр: рабочая область, применение: весь слой',
  'adjustments.ui.limit.tip': 'На бесконечном холсте тяжёлые фильтры работают в рамке, а без рамки — в видимой области',
  'adjustments.ui.nothingToApply': 'Нечего применять',

  'adjustments.ui.layer': 'Слой',

  'adjustments.ui.pencil': 'Карандаш',

  'adjustments.ui.undo': 'Отменить',

  'adjustments.ui.reset': 'Сбросить',

  'adjustments.ui.preview': 'Превью',

  'adjustments.ui.previewTip': 'Переключить вид до/после',

  'adjustments.ui.cancel': 'Отмена',

  'adjustments.ui.apply': 'Применить',

  'adjustments.ui.dragTip': 'Тащите влево-вправо на холсте, чтобы отрегулировать',

  'adjustments.ui.paintBrushTip': 'Рисуйте эффект текущей кистью; ластик удаляет',

  'adjustments.ui.editInPanel': 'Редактировать в панели',

  'adjustments.ui.paintToClone': 'Рисовать клон',

  'adjustments.ui.setSourceTip': 'Alt+щелчок: установить источник',

  'adjustments.ui.paintWithBrush': 'Рисовать кистью',

  'adjustments.ui.liquifyHint': 'Тащите на холсте. Скручивание, сжатие, вздутие, кристаллизация и восстановление работают при удержании. Сброс очищает все искажения.',

  'adjustments.ui.placePoint': 'Разместить точку на холсте',

  'adjustments.ui.center': 'Центр',

  'adjustments.ui.pointTip': 'Совет: Alt+перетаскивание на холсте также перемещает точку.',

  'adjustments.ui.pencilHint': 'Карандаш: эффект появляется там, где вы рисуете текущей кистью (нажим учитывается). Ластик удаляет эффект.',

  'adjustments.ui.dragSliderHint': 'Тащите влево-вправо на холсте, чтобы изменить выделенный ползунок.',

  'adjustments.curves.title': 'Кривая',

  'adjustments.curves.resetChannel': 'Сбросить канал',

  'adjustments.curves.resetAll': 'Сбросить всё',

  'adjustments.curves.hint': 'Щелчок добавляет точку, перетаскивание её перемещает, двойной щелчок удаляет.',

  'adjustments.curves.gamma': 'Гамма',

  'adjustments.curves.red': 'Красный',

  'adjustments.curves.green': 'Зелёный',

  'adjustments.curves.blue': 'Синий',

  'adjustments.gradient.title': 'Градиент',

  'adjustments.gradient.stop': 'Остановка',

  'adjustments.gradient.delete': 'Удалить',

  'adjustments.gradient.reverse': 'Обратить',

  'adjustments.gradient.hint': 'Щелчок по полосе добавляет остановку, перетаскивание перемещает их.',

  'adjustments.gradient.library': 'Библиотека',

  'adjustments.clone.setSource': 'Установить источник',

  'adjustments.clone.resetSource': 'Сбросить источник',

  'adjustments.clone.hint': 'Alt+щелчок устанавливает точку источника. Рисуйте любой кистью, чтобы копировать из источника; ластик восстанавливает оригинал.',

  'adjustments.clone.aligned': 'Связанный (источник следует)',

  'adjustments.clone.sourceNotSet': 'Сначала установите источник клона: Alt+щелчок на холсте',

  'adjustments.adj.color': 'Цвет',

  'adjustments.adj.octaves': 'Октавы',

  'adjustments.liquify.tool': 'Инструмент',

  'adjustments.liquify.push': 'Сдвиг',

  'adjustments.liquify.twirlRight': 'Скручивание вправо',

  'adjustments.liquify.twirlLeft': 'Скручивание влево',

  'adjustments.liquify.pinch': 'Сжатие',

  'adjustments.liquify.expand': 'Вздутие',

  'adjustments.liquify.crystals': 'Кристаллизация',

  'adjustments.liquify.edge': 'Край',

  'adjustments.liquify.reconstruct': 'Восстановление',
  'adjustments.name.hsb': 'Цветовой тон, насыщенность, яркость',
  'adjustments.name.colorBalance': 'Цветовой баланс',
  'adjustments.name.curves': 'Кривые',
  'adjustments.name.gradientMap': 'Карта градиента',
  'adjustments.name.recolor': 'Перекрашивание',
  'adjustments.name.gaussian': 'Размытие по Гауссу',
  'adjustments.name.motion': 'Размытие в движении',
  'adjustments.name.perspective': 'Размытие в перспективе',
  'adjustments.name.noise': 'Шум',
  'adjustments.name.sharpen': 'Резкость',
  'adjustments.name.bloom': 'Свечение (Bloom)',
  'adjustments.name.glitch': 'Глитч',
  'adjustments.name.halftone': 'Полутона',
  'adjustments.name.chromatic': 'Хроматическая аберрация',
  'adjustments.name.liquify': 'Пластика',
  'adjustments.name.clone': 'Клонирование',
  'adjustments.lbl.hue': 'Тон',
  'adjustments.lbl.saturation': 'Насыщенность',
  'adjustments.lbl.brightness': 'Яркость',
  'adjustments.lbl.range': 'Диапазон',
  'adjustments.lbl.shadows': 'Тени',
  'adjustments.lbl.midtones': 'Средние тона',
  'adjustments.lbl.highlights': 'Света',
  'adjustments.lbl.cyanRed': 'Голубой – красный',
  'adjustments.lbl.magentaGreen': 'Пурпурный – зелёный',
  'adjustments.lbl.yellowBlue': 'Жёлтый – синий',
  'adjustments.lbl.preserveLuminosity': 'Сохранять яркость',
  'adjustments.lbl.intensity': 'Интенсивность',
  'adjustments.lbl.color': 'Цвет',
  'adjustments.lbl.radius': 'Радиус',
  'adjustments.lbl.amount': 'Величина',
  'adjustments.lbl.direction': 'Направление',
  'adjustments.lbl.backwardOnly': 'Только назад',
  'adjustments.lbl.type': 'Тип',
  'adjustments.lbl.positional': 'Позиционное',
  'adjustments.lbl.directional': 'Направленное',
  'adjustments.lbl.focalPoint': 'Точка фокуса',
  'adjustments.lbl.clouds': 'Облака',
  'adjustments.lbl.billows': 'Клубы',
  'adjustments.lbl.ridges': 'Гребни',
  'adjustments.lbl.grain': 'Зерно',
  'adjustments.lbl.scale': 'Масштаб',
  'adjustments.lbl.octaves': 'Октавы',
  'adjustments.lbl.turbulence': 'Турбулентность',
  'adjustments.lbl.monochrome': 'Монохром',
  'adjustments.lbl.seed': 'Начальное значение',
  'adjustments.lbl.transition': 'Переход',
  'adjustments.lbl.size': 'Размер',
  'adjustments.lbl.opacity': 'Непрозрачность',
  'adjustments.lbl.burn': 'Выжигание',
  'adjustments.lbl.artifact': 'Артефакт',
  'adjustments.lbl.wave': 'Волна',
  'adjustments.lbl.displace': 'Смещение',
  'adjustments.lbl.signal': 'Сигнал',
  'adjustments.lbl.tear': 'Разрыв',
  'adjustments.lbl.diverge': 'Расхождение',
  'adjustments.lbl.distance': 'Расстояние',
  'adjustments.lbl.offset': 'Смещение',
  'adjustments.lbl.pattern': 'Узор',
  'adjustments.lbl.fullColor': 'Полноцветный',
  'adjustments.lbl.screenPrint': 'Трафаретная печать',
  'adjustments.lbl.newspaper': 'Газетный',
  'adjustments.lbl.dot': 'Точка',
  'adjustments.lbl.line': 'Линия',
  'adjustments.lbl.cross': 'Крест',
  'adjustments.lbl.screenAngle': 'Угол растра',
  'adjustments.lbl.perspective': 'Перспектива',
  'adjustments.lbl.tool': 'Инструмент',
  'adjustments.lbl.pressure': 'Нажим',
  'adjustments.lbl.distortion': 'Искажение',
  'adjustments.lbl.momentum': 'Инерция',
  'adjustments.lbl.alignedSourceFollows': 'Выровнено (источник следует за кистью)',
  'adjustments.lbl.push': 'Сдвиг',
  'adjustments.lbl.twirlRight': 'Скручивание вправо',
  'adjustments.lbl.twirlLeft': 'Скручивание влево',
  'adjustments.lbl.pinch': 'Сжатие',
  'adjustments.lbl.expand': 'Вздутие',
  'adjustments.lbl.crystals': 'Кристаллы',
  'adjustments.lbl.edge': 'Край',
  'adjustments.lbl.reconstruct': 'Восстановить',
  'adjustments.lbl.blackWhite': 'Чёрно-белый',
  'adjustments.lbl.sepia': 'Сепия',
  'adjustments.lbl.sunset': 'Закат',
  'adjustments.lbl.ocean': 'Океан',
  'adjustments.lbl.fire': 'Огонь',
  'adjustments.lbl.neon': 'Неон',
  'adjustments.lbl.forest': 'Лес',
  'adjustments.lbl.rainbow': 'Радуга',
  'adjustments.lbl.duotoneTealOrange': 'Бирюза и оранжевый',
  'adjustments.lbl.cyanotype': 'Цианотипия',
  'adjustments.lbl.roseGold': 'Розовое золото',
  'adjustments.lbl.toxic': 'Токсичный',
}
export default dict
