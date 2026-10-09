// selectxform module (ru). Same keys as en/selectxform.ts.
const dict: Record<string, string> = {
  'selectxform.action.selectPaintLayer': 'Выберите слой для рисования',

  'selectxform.action.layerLocked': 'Слой заблокирован',

  'selectxform.action.makeSelection': 'Сначала создайте выделение',

  'selectxform.action.layerEmpty': 'Слой пуст',

  'selectxform.bar.layer': 'Слой',

  'selectxform.bar.canvasReference': 'Холст (референс)',

  'selectxform.bar.source': 'Источник',

  'selectxform.bar.threshold': 'коснитесь области, тащите влево-вправо для порога',

  'selectxform.bar.selectionName': 'Название выделения',

  'selectxform.bar.noSavedSelections': 'Нет сохранённых выделений',

  'selectxform.bar.automatic': 'Автоматическое',

  'selectxform.bar.freehand': 'Произвольное',

  'selectxform.bar.rectangle': 'Прямоугольное',

  'selectxform.bar.ellipse': 'Эллиптическое',

  'selectxform.bar.square': 'Квадрат',

  'selectxform.bar.circle': 'Круг',

  'selectxform.bar.add': 'Добавить',

  'selectxform.bar.addToSelection': 'Добавить к выделению',

  'selectxform.bar.remove': 'Вычесть',

  'selectxform.bar.subtractFromSelection': 'Вычесть из выделения',

  'selectxform.bar.invert': 'Инвертировать',

  'selectxform.bar.copyPaste': 'Копировать и вставить',

  'selectxform.bar.copyPasteTip': 'Дублировать выделение на новый слой',

  'selectxform.bar.cutPaste': 'Вырезать и вставить',

  'selectxform.bar.feather': 'Растушёвка',

  'selectxform.bar.saveLoad': 'Сохранить и загрузить',

  'selectxform.bar.colorFill': 'Заливка цветом',

  'selectxform.bar.clear': 'Очистить',

  'selectxform.bar.all': 'Всё',

  'selectxform.bar.layerContents': 'Слой',

  'selectxform.bar.layerContentsTip': 'Выделить содержимое активного слоя',

  'selectxform.bar.deselect': 'Снять выделение',

  'selectxform.bar.mask': 'Маска',

  'selectxform.bar.close': 'Закрыть',

  'selectxform.bar.closeTip': 'Закрыть многоугольник (Enter)',

  'selectxform.bar.cancel': 'Отмена',

  'selectxform.bar.closeToolsTip': 'Закрыть инструменты выделения',

  'selectxform.bar.featherApply': 'Применить',

  'selectxform.bar.featherCancel': 'Отмена',

  'selectxform.bar.featherRange': 'Растушёвка',

  'selectxform.bar.selectionSave': 'Сохранить',

  'selectxform.bar.selectionLoad': 'Загрузить',

  'selectxform.bar.selectionAdd': 'Добавить к выделению',

  'selectxform.bar.selectionSubtract': 'Вычесть из выделения',

  'selectxform.bar.selectionDelete': '@clear',

  'selectxform.bar.nothing': 'Ничего не выделено',

  'selectxform.xform.freeform': 'Свободное',

  'selectxform.xform.uniform': 'Пропорциональное',

  'selectxform.xform.distort': 'Искажение',

  'selectxform.xform.warp': 'Деформация',

  'selectxform.xform.bend': 'Изгиб',

  'selectxform.xform.flipH': 'Отразить Г',

  'selectxform.xform.flipV': 'Отразить В',

  'selectxform.xform.rotate45': 'Повернуть 45°',

  'selectxform.xform.fitToScreen': 'Вписать в экран',

  'selectxform.xform.reset': 'Сбросить',

  'selectxform.xform.nearest': 'Ближайший сосед',

  'selectxform.xform.bilinear': 'Билинейная',

  'selectxform.xform.bicubic': 'Бикубическая',

  'selectxform.xform.interpolation': 'Интерполяция',

  'selectxform.xform.magnetics': 'Магнит',

  'selectxform.xform.magneticsTip': 'Привязка к краям холста, центру и шагам поворота',

  'selectxform.xform.guides': 'Направляющие',

  'selectxform.xform.guidesTip': 'Также привязка к направляющим: линиям сетки, осям симметрии, точкам схода',

  'selectxform.xform.distance': 'Расстояние',

  'selectxform.xform.velocity': 'Скорость',

  'selectxform.xform.advancedMesh': 'Расширенная сетка',

  'selectxform.xform.columns': 'Столбцы',

  'selectxform.xform.rows': 'Строки',

  'selectxform.xform.allLayers': 'Все слои',

  'selectxform.xform.cancel': 'Отмена',

  'selectxform.xform.done': 'Готово',

  'selectxform.xform.layerHidden': 'Слой скрыт',

  'selectxform.xform.nothingToTransform': 'Нечего трансформировать',
  'selectxform.menu.selWand': 'Автоматическое',
  'selectxform.menu.selFree': 'Произвольное',
  'selectxform.menu.selRect': 'Прямоугольное',
  'selectxform.menu.selEllipse': 'Эллиптическое',
  'selectxform.menu.selAdd': 'Добавить (объединение)',
  'selectxform.menu.selRemove': 'Вычесть (вычитание)',
  'selectxform.menu.selInvert': 'Инвертировать',
  'selectxform.menu.selFeather': 'Растушёвка…',
  'selectxform.menu.selCopy': 'Копировать и вставить',
  'selectxform.menu.selCut': 'Вырезать и вставить',
  'selectxform.menu.selSaveload': 'Сохранить и загрузить…',
  'selectxform.menu.selClear': 'Очистить',
  'selectxform.menu.selAll': 'Выделить всё',
  'selectxform.menu.selLayer': 'Выделить содержимое слоя',
  'selectxform.menu.selNone': 'Снять выделение',
  'selectxform.menu.tfFree': 'Свободное',
  'selectxform.menu.tfUniform': 'Пропорциональное',
  'selectxform.menu.tfDistort': 'Искажение',
  'selectxform.menu.tfWarp': 'Деформация',
  'selectxform.menu.tfBend': 'Деформация: изгиб (кривая)',
  'selectxform.menu.tfMesh': 'Расширенная сетка',
  'selectxform.menu.tfFlipH': 'Отразить по горизонтали',
  'selectxform.menu.tfFlipV': 'Отразить по вертикали',
  'selectxform.menu.tfRot45': 'Повернуть на 45°',
  'selectxform.menu.tfFit': 'Вписать в экран',
  'selectxform.menu.tfReset': 'Сбросить',
  'selectxform.menu.tfMagnetics': 'Магнит / привязка вкл./выкл.',
  'selectxform.menu.tfDone': 'Готово (Enter)',
  'selectxform.menu.tfCancel': 'Отмена (Esc)',
  'selectxform.interp.nearest': 'Ближайший сосед',
  'selectxform.interp.bilinear': 'Билинейная',
  'selectxform.interp.bicubic': 'Бикубическая',
  'selectxform.threshold': 'Допуск {n}%',
  'selectxform.bar.savedName': 'Выделение {n}',
  'selectxform.bar.savedDefault': 'Выделение',
  'selectxform.bar.layersSel_one': '{count} слой, выделение',
  'selectxform.bar.layersSel_few': '{count} слоя, выделение',
  'selectxform.bar.layersSel_many': '{count} слоёв, выделение',
  'selectxform.bar.layersSel_other': '{count} слоя, выделение',
  'selectxform.bar.layersOnly_one': '{count} слой',
  'selectxform.bar.layersOnly_few': '{count} слоя',
  'selectxform.bar.layersOnly_many': '{count} слоёв',
  'selectxform.bar.layersOnly_other': '{count} слоя',

  'selectxform.limitedWindow': 'Выделение ограничено {n} px',
  'selectxform.limitedWork': 'Выделение ограничено рамкой / видимой областью',
  'selectxform.xform.tooBig': 'Область трансформации слишком велика для этого GPU',
}
export default dict
